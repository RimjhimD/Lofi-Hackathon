/**
 * A list that updates itself when someone else changes the data - the
 * "someone else just changed this" demo moment. Owns its own copy of the
 * rows (seeded from the `rows` prop, then patched in place by live
 * events) so a change is visibly a patch, not a full re-render: the row
 * that changed gets a brief highlight ring instead of the whole list
 * flickering.
 *
 * This component does NOT talk to db.js (recipes don't import from
 * src/lib - see ../README.md). It renders whatever `rows` the parent
 * loaded and reconciles it against live.subscribe(table, ...) events. The
 * parent still owns writes: call db.insert/update/remove as normal, then
 * live.publish(table, event) right after - see README.md gotcha 1. Pass
 * `onEvent` if the parent also wants to react to changes that came from
 * *someone else* (e.g. to persist them into its own `rows` state so a
 * later reload matches).
 *
 * `row` (optional) is a render-prop: `(item) => ReactNode`, React's
 * equivalent of the Svelte version's `{#snippet row(item)}`.
 */
import { useEffect, useState } from 'react'
import { live } from './live.js'
import { presence } from './presence.js'

export default function LiveList({ table, rows = [], row, screen = table, user = null, onEvent }) {
  const [items, setItems] = useState(() => [...rows])
  const [justChanged, setJustChanged] = useState(new Set())
  const [status, setStatus] = useState('offline')
  const [others, setOthers] = useState([])

  // The parent's own array is the source of truth for the initial load (and
  // for any reload it does itself); live events patch on top of it.
  useEffect(() => {
    setItems([...rows])
  }, [rows])

  function flash(id) {
    setJustChanged((prev) => new Set(prev).add(id))
    setTimeout(() => {
      setJustChanged((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 1600)
  }

  useEffect(() => {
    if (!table) return

    function apply(event) {
      if (event.eventType === 'INSERT' && event.row) {
        setItems((prev) => (prev.some((r) => r.id === event.row.id) ? prev : [event.row, ...prev]))
        flash(event.row.id)
      } else if (event.eventType === 'UPDATE' && event.row) {
        setItems((prev) => prev.map((r) => (r.id === event.row.id ? event.row : r)))
        flash(event.row.id)
      } else if (event.eventType === 'DELETE' && event.old) {
        setItems((prev) => prev.filter((r) => r.id !== event.old.id))
      }
      onEvent?.(event)
    }

    const unsubscribe = live.subscribe(table, apply)
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table])

  useEffect(() => {
    if (!table) return
    const unsubscribe = live.onStatus(table, (value) => setStatus(value))
    return unsubscribe
  }, [table])

  // Presence is opt-in: no `user` prop, no "N others viewing", no join call.
  useEffect(() => {
    if (!user || !screen) return
    const handle = presence.join(screen, user)
    const unsubscribe = handle.onChange((list) => {
      setOthers(list.filter((p) => p.id !== user.id))
    })
    return () => {
      unsubscribe()
      handle.leave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, user?.id])

  const pillClass =
    status === 'live'
      ? 'bg-ok/10 text-ok'
      : status === 'reconnecting'
        ? 'bg-accent/10 text-accent'
        : 'bg-danger/10 text-danger'
  const pillLabel = status === 'live' ? 'Live' : status === 'reconnecting' ? 'Reconnecting…' : 'Offline'

  return (
    <section className="mx-auto w-full max-w-xl px-4 pb-24">
      <div className="mb-3 flex items-center justify-between gap-3 text-sm">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ${pillClass}`}>
          <span className={`size-1.5 rounded-full bg-current ${status === 'reconnecting' ? 'animate-pulse' : ''}`}></span>
          {pillLabel}
        </span>
        {user && (
          <span className="text-ink-500">
            {others.length === 0 ? 'Just you here' : `${others.length} other${others.length === 1 ? '' : 's'} viewing`}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        // Empty state does a job: it explains and doesn't look broken.
        <div className="rounded-card border border-dashed border-ink-300/70 px-6 py-10 text-center">
          <p className="text-ink-500">Nothing here yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={`rounded-card bg-white px-4 py-3 shadow-sm ring-2 transition-colors duration-700 dark:bg-ink-900/40 ${
                justChanged.has(item.id) ? 'ring-accent' : 'ring-transparent'
              }`}
            >
              {row ? row(item) : <p className="break-words font-medium">{item.title ?? item.name ?? item.label ?? JSON.stringify(item)}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
