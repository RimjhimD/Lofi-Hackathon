// Run with: node --test src/recipes/auth/auth.test.mjs
//
// Covers the pure logic (email validation, rate-limit detection) and the
// local backend's session round trip. Does not touch the Supabase branch -
// that needs a real project and is exercised by hand, not by this file.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// auth.js talks to `localStorage` and `window` when the local backend is
// active. Neither exists under plain `node --test` (no jsdom in this repo -
// see the "Zero new required dependencies" rule in ../README.md), so this
// file provides the smallest stubs that make the real code paths run.
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
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  location: { origin: 'http://localhost' },
}

// Imported after the stubs are in place, and dynamically so a top-level
// `import` (hoisted before the stubs run) can't race them.
const { auth, backend, isValidEmail, isRateLimitError } = await import('./auth.js')

test('backend defaults to local with no Supabase env vars', () => {
  assert.equal(backend, 'local')
})

test('isValidEmail accepts plausible addresses', () => {
  assert.equal(isValidEmail('a@b.com'), true)
  assert.equal(isValidEmail('  first.last+tag@sub.example.co  '), true)
})

test('isValidEmail rejects obvious typos and junk', () => {
  assert.equal(isValidEmail(''), false)
  assert.equal(isValidEmail('not-an-email'), false)
  assert.equal(isValidEmail('missing-domain@'), false)
  assert.equal(isValidEmail('@missing-local.com'), false)
  assert.equal(isValidEmail('spaces in@it.com'), false)
  assert.equal(isValidEmail(null), false)
  assert.equal(isValidEmail(undefined), false)
})

test('isRateLimitError recognises a 429 status', () => {
  assert.equal(isRateLimitError({ status: 429, message: 'nope' }), true)
})

test('isRateLimitError recognises a rate-limit message without a status', () => {
  assert.equal(isRateLimitError({ message: 'email rate limit exceeded' }), true)
})

test('isRateLimitError is false for unrelated errors and empty input', () => {
  assert.equal(isRateLimitError({ status: 500, message: 'server error' }), false)
  assert.equal(isRateLimitError(null), false)
  assert.equal(isRateLimitError(undefined), false)
})

test('local backend: signed out until signIn() is called', async () => {
  const before = await auth.currentUser()
  assert.equal(before.error, null)
  assert.equal(before.data.user, null)
})

test('local backend: signIn() with no email creates an instant demo session', async () => {
  const { data, error } = await auth.signIn()
  assert.equal(error, null)
  assert.equal(data.session.user.isDemo, true)
  assert.equal(data.session.user.email, 'demo@localhost')

  const { data: current } = await auth.currentUser()
  assert.equal(current.user.id, 'demo-user')

  await auth.signOut()
})

test('local backend: signIn(email) labels the session with that address', async () => {
  const { data, error } = await auth.signIn('judge@example.com')
  assert.equal(error, null)
  assert.equal(data.session.user.email, 'judge@example.com')
  assert.equal(data.session.user.isDemo, true) // still the local fake session

  await auth.signOut()
})

test('local backend: signOut clears the session', async () => {
  await auth.signIn('judge@example.com')
  await auth.signOut()
  const { data } = await auth.currentUser()
  assert.equal(data.user, null)
})

test('local backend: subscribe fires immediately, then on every change', async () => {
  await auth.signOut() // known-clean starting state
  const seen = []
  const unsubscribe = auth.subscribe((user) => seen.push(user?.email ?? null))

  assert.equal(seen.length, 1)
  assert.equal(seen[0], null) // fired immediately with "signed out"

  await auth.signIn('watcher@example.com')
  assert.equal(seen.length, 2)
  assert.equal(seen[1], 'watcher@example.com')

  await auth.signOut()
  assert.equal(seen.length, 3)
  assert.equal(seen[2], null)

  unsubscribe()
  await auth.signIn('after-unsubscribe@example.com')
  assert.equal(seen.length, 3) // no more callbacks after unsubscribe

  await auth.signOut()
})
