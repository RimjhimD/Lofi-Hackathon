# realtime

Live updates — queues, collaboration, notifications, "someone else just
changed this." A judge opening the app on their phone while you change
something on yours, and watching it update with no refresh, is one of the
strongest sixty-second demo moments available. This recipe is what makes
that moment work across two real devices when Supabase is configured, and
still work with zero setup when it isn't.

## What's here

| File | What |
|---|---|
| `live.js` | Three-tier live-updates adapter. Mirrors `src/lib/db.js`: Supabase env vars set → real `postgres_changes` subscription; no env vars → `BroadcastChannel` across tabs in the same browser; neither → interval polling. Same `subscribe`/`publish`/`status` calls either way. |
| `presence.js` | "Who else is on this screen right now." `join`/`leave`, a live present-users list, and a stale-entry sweep so a browser closed without a clean `leave()` disappears instead of lingering forever. |
| `LiveList.jsx` | A list that patches itself from live events instead of re-rendering: connection-status pill (live / reconnecting / offline), an "N others viewing" indicator, and a highlight ring on rows that just changed. Subscription setup/teardown lives in `useEffect` cleanup. |
| `live.test.mjs` | `node --test src/recipes/realtime/live.test.mjs` — reconnect backoff, event de-duplication, the poll tier's diff logic, and the presence sweep. Passing as shipped, and a real subscribe/publish round trip runs too: Node 22 has a global `BroadcastChannel`, so the tier the test exercises is the same one a no-Supabase demo runs on. |

## Copy it in

```bash
cp -r src/recipes/realtime src/lib/realtime
```

```jsx
import { useEffect, useState } from 'react'
import { db } from '../lib/db.js'
import { live } from '../lib/realtime/live.js'
import LiveList from '../lib/realtime/LiveList.jsx'

const TABLE = 'items'

export default function ItemsScreen({ myUserId, myName }) {
  const [rows, setRows] = useState([])

  useEffect(() => {
    async function load() {
      const { data } = await db.list(TABLE)
      setRows(data ?? [])
    }
    load()
  }, [])

  async function add(title) {
    const { data, error } = await db.insert(TABLE, { title, done: false })
    if (!error) live.publish(TABLE, { eventType: 'INSERT', row: data, old: null }) // see gotcha 2
  }

  return (
    <LiveList table={TABLE} rows={rows} user={{ id: myUserId, name: myName }} row={(item) => <p>{item.title}</p>} />
  )
}
```

`LiveList` doesn't fetch its own data (recipes don't import `src/lib` — see
`../README.md`); the parent still owns `db.list`/`insert`/`update`/`remove`
exactly like `Loop.jsx`. Drop the `user` prop to skip presence entirely —
the list and the connection pill work without it.

## How the three tiers work

`live.js` picks a backend the same way `db.js` picks one — automatically,
from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`:

1. **Supabase env vars present** → a `postgres_changes` subscription per
   table via Supabase Realtime. Real push, works across two different
   devices — this is the tier that makes the phone-and-laptop demo moment
   happen.
2. **No env vars, `BroadcastChannel` available** (every modern browser,
   including Node 22, which is what `live.test.mjs` runs against) →
   messages posted on a per-table `BroadcastChannel`, received by every
   other tab in the same browser. Zero setup, fully offline.
3. **Neither** → polling every 2.5s against the exact `hack:<table>`
   localStorage key `db.js`'s local backend already writes, diffing the
   snapshot to produce INSERT/UPDATE/DELETE events. Last resort, but never
   silent.

`presence.js` follows the same idea with two tiers instead of three: real
Supabase Presence when configured, otherwise a roster written to
`hack:presence:<screen>` with a heartbeat and a sweep (BroadcastChannel is
used opportunistically for instant same-browser updates in the local tier,
but the sweep works with or without it).

## The three gotchas most likely to bite

**1. Supabase Realtime is OFF by default, per table — and a channel that
never fires looks exactly like a channel that's broken.** Enabling the
Realtime add-on for your project is not enough. Each table needs Realtime
switched on individually: **Database → Replication** in the Supabase
dashboard, then toggle the table (or `Database → Publications` → edit
`supabase_realtime` → add the table, depending on dashboard version).
Forget this and `.subscribe()` still reports `SUBSCRIBED` — the connection
is genuinely fine — but no `postgres_changes` event ever fires for that
table, for anyone, ever. It reads as a code bug and isn't one. This is the
classic 20-minute loss on this recipe; do it **before** the first test of
the live tier, not after it silently does nothing.

**2. The local tiers don't know a write happened unless you tell them.**
Supabase pushes because Postgres itself changed. `BroadcastChannel` and
polling have no database watching for them — call `live.publish(table,
event)` right after a successful `db.insert`/`update`/`remove`, with the
row you just wrote. Skip it and tab A's changes only reach tab B on
`BroadcastChannel`'s next unrelated message, or the poll tier's next
2.5s tick — either "eventually," never "now."

**3. `BroadcastChannel` never delivers a message back to the tab that sent
it — by spec, not by bug.** The tab that just wrote will not see its own
change arrive through `live.subscribe`. That's fine and intentional (it
already has the row from the write itself), but it means your own write
still needs the same optimistic-update pattern `Loop.jsx` uses — don't
wire "add a row" through `live.subscribe` alone or your own tab's list
will never update.

## Presence latency, concretely

`presence.join`'s list updates two ways: instantly when someone else's tab
calls `leave()` cleanly, and only on the next sweep (every 5s by default,
tuned via `sweepIntervalMs`) when a tab disappears without one — a closed
laptop lid, a crashed tab, a killed browser. A stale entry can take up to
`staleMs` (20s default) past its last heartbeat to disappear. That's the
tradeoff that makes "someone closed their laptop" not leave a ghost in "N
others viewing" forever; it is not instant, and shouldn't be tuned much
tighter than the default heartbeat (8s) allows without risking false drops
on a merely slow tab.

## Verifying this recipe

```bash
node --test src/recipes/realtime/live.test.mjs
```

19 tests: backoff-delay growth and its cap, `eventKey`/`createDeduper`
(the same change arriving twice must not double-apply), the poll tier's
`diffRows` (INSERT/UPDATE/DELETE detection), `sweepStale` (keep-fresh,
drop-stale, mixed), and a real `live.subscribe`/`live.publish` round trip
on the `BroadcastChannel` tier — including a check that a change published
twice is only ever delivered once. The Supabase tier isn't covered by this
file — it needs a real project with Realtime enabled per table (gotcha 1
above) — so sanity-check it by hand: open the app in two tabs (or a laptop
and a phone) with `.env` filled in, change something in one, and watch the
other update without a refresh.

```bash
npx esbuild src/recipes/realtime/LiveList.jsx \
  --loader:.jsx=jsx --jsx=automatic --bundle \
  --external:react --external:react-dom --external:@supabase/supabase-js \
  --outfile=/dev/null
```
