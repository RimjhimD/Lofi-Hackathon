// Run with: node --test src/recipes/realtime/live.test.mjs
//
// Covers the pure logic named in the brief - the stale-presence sweep,
// event de-duplication, and reconnect backoff timing - plus a real
// subscribe/publish round trip on the tier plain `node --test` actually
// runs: Node 22 ships a global BroadcastChannel, so with no
// VITE_SUPABASE_URL set `backend` resolves to 'broadcast' here, same as a
// browser with no Supabase keys configured. The Supabase tier itself needs
// a real project and is exercised by hand - same rule as ../auth/auth.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// live.js's poll tier reads `localStorage` directly (see its module doc,
// "reads the same key db.js writes"); presence.js's local tier does too.
// Neither exists under plain `node --test`, so stub the smallest thing that
// makes those code paths run - identical trick to ../auth/auth.test.mjs.
class MemoryStorage {
  #map = new Map()
  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null
  }
  setItem(key, value) {
    this.#map.set(key, String(value))
  }
  removeItem(key) {
    this.#map.delete(key)
  }
}
globalThis.localStorage = new MemoryStorage()

const { live, backend, nextBackoffDelay, eventKey, createDeduper, diffRows } = await import('./live.js')
const { presence, sweepStale } = await import('./presence.js')

// --- reconnect backoff timing ------------------------------------------------

test('nextBackoffDelay doubles each attempt starting from baseMs', () => {
  assert.equal(nextBackoffDelay(1, { baseMs: 1000, maxMs: 30000 }), 1000)
  assert.equal(nextBackoffDelay(2, { baseMs: 1000, maxMs: 30000 }), 2000)
  assert.equal(nextBackoffDelay(3, { baseMs: 1000, maxMs: 30000 }), 4000)
  assert.equal(nextBackoffDelay(4, { baseMs: 1000, maxMs: 30000 }), 8000)
})

test('nextBackoffDelay caps at maxMs instead of growing forever', () => {
  assert.equal(nextBackoffDelay(10, { baseMs: 1000, maxMs: 30000 }), 30000)
  assert.equal(nextBackoffDelay(20, { baseMs: 1000, maxMs: 5000 }), 5000)
})

test('nextBackoffDelay treats attempt < 1 as attempt 1', () => {
  assert.equal(nextBackoffDelay(0, { baseMs: 1000, maxMs: 30000 }), 1000)
  assert.equal(nextBackoffDelay(-5, { baseMs: 1000, maxMs: 30000 }), 1000)
})

// --- event de-duplication ----------------------------------------------------

test('eventKey is identical for the same row content, same event type', () => {
  const a = { table: 'items', eventType: 'UPDATE', row: { id: '1', title: 'x', done: false }, old: { id: '1' } }
  const b = { table: 'items', eventType: 'UPDATE', row: { id: '1', title: 'x', done: false }, old: { id: '1' } }
  assert.equal(eventKey(a), eventKey(b))
})

test('eventKey differs when the row content actually changed', () => {
  const a = { table: 'items', eventType: 'UPDATE', row: { id: '1', title: 'x', done: false } }
  const b = { table: 'items', eventType: 'UPDATE', row: { id: '1', title: 'x', done: true } }
  assert.notEqual(eventKey(a), eventKey(b))
})

test('createDeduper flags the exact same change arriving twice, once', () => {
  const dedupe = createDeduper(5000)
  const event = { table: 'items', eventType: 'INSERT', row: { id: '1', title: 'x' } }
  const key = eventKey(event)

  // First arrival - e.g. the Supabase postgres_changes push.
  assert.equal(dedupe.isDuplicate(key), false)
  // Second arrival of the *same* change - e.g. a resync after a reconnect
  // redelivering it, or a stray poll tick catching the same row a
  // BroadcastChannel message already announced. Must not double-apply.
  assert.equal(dedupe.isDuplicate(key), true)
})

test('createDeduper does not flag a genuinely different change to the same row', () => {
  const dedupe = createDeduper(5000)
  const first = eventKey({ table: 'items', eventType: 'UPDATE', row: { id: '1', done: false } })
  const second = eventKey({ table: 'items', eventType: 'UPDATE', row: { id: '1', done: true } })
  assert.equal(dedupe.isDuplicate(first), false)
  assert.equal(dedupe.isDuplicate(second), false)
})

test('createDeduper forgets a key once its window has passed', () => {
  const dedupe = createDeduper(100)
  const key = 'items:INSERT:1:{}'
  assert.equal(dedupe.isDuplicate(key, 1000), false)
  assert.equal(dedupe.isDuplicate(key, 1050), true) // still inside the 100ms window
  assert.equal(dedupe.isDuplicate(key, 1200), false) // window has expired, treated as new
})

// --- diffRows (the poll tier's change-detection logic) -----------------------

test('diffRows reports an INSERT for a row that is new', () => {
  const events = diffRows([], [{ id: '1', title: 'a' }])
  assert.deepEqual(events, [{ eventType: 'INSERT', row: { id: '1', title: 'a' }, old: null }])
})

test('diffRows reports an UPDATE only when the row content changed', () => {
  const before = [{ id: '1', title: 'a' }]
  const sameContent = diffRows(before, [{ id: '1', title: 'a' }])
  assert.deepEqual(sameContent, [])

  const changed = diffRows(before, [{ id: '1', title: 'b' }])
  assert.deepEqual(changed, [{ eventType: 'UPDATE', row: { id: '1', title: 'b' }, old: { id: '1', title: 'a' } }])
})

test('diffRows reports a DELETE for a row that disappeared', () => {
  const events = diffRows([{ id: '1', title: 'a' }], [])
  assert.deepEqual(events, [{ eventType: 'DELETE', row: null, old: { id: '1', title: 'a' } }])
})

// --- stale-presence sweep -----------------------------------------------------

test('sweepStale keeps an entry seen within staleMs', () => {
  const now = 100000
  const entries = [{ id: 'a', lastSeen: now - 5000 }]
  assert.deepEqual(sweepStale(entries, now, 20000), entries)
})

test('sweepStale drops an entry whose heartbeat has gone quiet', () => {
  const now = 100000
  const entries = [{ id: 'a', lastSeen: now - 25000 }]
  assert.deepEqual(sweepStale(entries, now, 20000), [])
})

test('sweepStale is a mixed keep/drop filter, order preserved', () => {
  const now = 100000
  const entries = [
    { id: 'fresh', lastSeen: now - 1000 },
    { id: 'stale', lastSeen: now - 99999 },
    { id: 'also-fresh', lastSeen: now },
  ]
  assert.deepEqual(sweepStale(entries, now, 20000), [
    { id: 'fresh', lastSeen: now - 1000 },
    { id: 'also-fresh', lastSeen: now },
  ])
})

// --- backend selection ---------------------------------------------------------

test('backend is "broadcast" with no Supabase env vars and a global BroadcastChannel (Node 22, or any modern browser)', () => {
  assert.equal(backend, 'broadcast')
})

// --- broadcast tier: real subscribe/publish round trip ------------------------
// Exercises the actual code path a two-tab, no-Supabase demo runs on, not a
// mock of it - Node's BroadcastChannel joins by name exactly like a browser's.
//
// Every subscription below is torn down in `finally`. Leaving a
// BroadcastChannel open (e.g. because an assertion threw before an
// unsubscribe() call) keeps the event loop alive and `node --test` hangs
// instead of exiting cleanly - worth getting right here, not just in the app.

/** Resolves with the events seen so far once `count` have arrived, or rejects after `timeoutMs`. */
function waitForEvents(count, timeoutMs = 1000) {
  const seen = []
  let resolveDone, rejectDone
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  const timer = setTimeout(
    () => rejectDone(new Error(`timed out waiting for ${count} event(s), saw ${seen.length}`)),
    timeoutMs
  )
  return {
    handler(event) {
      seen.push(event)
      if (seen.length >= count) {
        clearTimeout(timer)
        resolveDone(seen)
      }
    },
    done,
  }
}

test('broadcast tier: publish delivers a change to a subscriber', async () => {
  const table = `test-items-${Math.random().toString(36).slice(2)}` // isolate from other tests
  const { handler, done } = waitForEvents(1)
  const unsubscribe = live.subscribe(table, handler)

  try {
    live.publish(table, { eventType: 'INSERT', row: { id: '1', title: 'new row' }, old: null })
    const seen = await done

    assert.equal(seen.length, 1)
    assert.equal(seen[0].eventType, 'INSERT')
    assert.equal(seen[0].row.id, '1')
    assert.equal(seen[0].table, table)
  } finally {
    unsubscribe()
  }
})

test('broadcast tier: a subscriber never receives its own publish twice', async () => {
  const table = `test-items-${Math.random().toString(36).slice(2)}`
  const seen = []
  const unsubscribe = live.subscribe(table, (event) => seen.push(event))

  try {
    live.publish(table, { eventType: 'INSERT', row: { id: '1' }, old: null }) // identical change,
    live.publish(table, { eventType: 'INSERT', row: { id: '1' }, old: null }) // published twice

    // A sentinel publish that only arrives once both earlier publishes have
    // already been delivered - BroadcastChannel preserves delivery order to
    // one listener, so waiting for this proves the count above is final.
    const { handler, done } = waitForEvents(1)
    const unsubscribeSentinel = live.subscribe(table, handler)
    try {
      live.publish(table, { eventType: 'INSERT', row: { id: 'sentinel' }, old: null })
      await done
    } finally {
      unsubscribeSentinel()
    }

    // BroadcastChannel itself doesn't dedupe; this asserts the dedupe layer
    // inside subscribeBroadcast does. If this ever fails after a refactor,
    // it means the same change is about to double-apply on a judge's screen.
    assert.equal(seen.filter((e) => e.row?.id === '1').length, 1)
  } finally {
    unsubscribe()
  }
})

test('broadcast tier: connection status is "live" while subscribed, "offline" after unsubscribe', () => {
  const table = `test-items-${Math.random().toString(36).slice(2)}`
  assert.equal(live.status(table), 'offline')
  const unsubscribe = live.subscribe(table, () => {})
  try {
    assert.equal(live.status(table), 'live')
  } finally {
    unsubscribe()
  }
  assert.equal(live.status(table), 'offline')
})

// --- presence: local tier join/leave/sweep round trip -------------------------
// heartbeatMs/sweepIntervalMs are set far beyond the test's lifetime so the
// only interval left running when the test ends is the one `leave()` (in
// `finally`) clears - nothing lingers to keep `node --test` from exiting.

test('presence.join: onChange fires immediately with self, then updates on leave', () => {
  const screen = `test-screen-${Math.random().toString(36).slice(2)}`
  const opts = { heartbeatMs: 100000, sweepIntervalMs: 100000 }
  const handle = presence.join(screen, { id: 'u1', name: 'Ann' }, opts)
  try {
    const seen = []
    const unsubscribe = handle.onChange((list) => seen.push(list.map((p) => p.id)))
    unsubscribe()

    assert.deepEqual(seen[0], ['u1'])
  } finally {
    handle.leave()
  }

  // leave() writes the roster synchronously; a fresh join reads it back.
  const handle2 = presence.join(screen, { id: 'u2', name: 'Bo' }, opts)
  try {
    const seen2 = []
    handle2.onChange((list) => seen2.push(list.map((p) => p.id)))
    assert.deepEqual(seen2[0], ['u2']) // u1 is gone, cleanly
  } finally {
    handle2.leave()
  }
})
