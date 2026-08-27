/**
 * THE CORE LOOP — the file you rewrite at 18:30.
 *
 * This is a deliberately generic add / toggle / delete list. It exists so that
 * every state a judge can put the app into is already handled before you know
 * what the problem is: loading, empty, error, optimistic write, failed write.
 *
 * Replace the noun ("task"), the fields, and the rule. Keep the states.
 * Those states are most of "does it work" and a good part of "built well".
 */
import { useEffect, useState } from 'react'
import { db, backend } from './db.js'

const TABLE = 'items'

export default function Loop() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const remaining = rows.filter((r) => !r.done).length

  async function load() {
    setLoading(true)
    const { data, error: err } = await db.list(TABLE)
    // Show the message, never the stack trace. A crash reads as broken; a
    // message reads as handled.
    setError(err ? err.message : null)
    setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function add() {
    const title = draft.trim()
    if (!title || busy) return
    setBusy(true)
    setDraft('')

    // Optimistic: the row appears instantly, then reconciles. On a Dhaka mobile
    // connection the round trip is the difference between "snappy" and "laggy",
    // and the judge is holding the phone.
    const optimistic = { id: `tmp-${Date.now()}`, title, done: false, created_at: new Date().toISOString() }
    setRows((prev) => [optimistic, ...prev])

    const { data, error: err } = await db.insert(TABLE, { title, done: false })
    if (err) {
      setRows((prev) => prev.filter((r) => r.id !== optimistic.id))
      setError(err.message)
      setDraft(title) // give the typing back rather than eating it
    } else {
      setRows((prev) => prev.map((r) => (r.id === optimistic.id ? data : r)))
      setError(null)
    }
    setBusy(false)
  }

  async function toggle(row) {
    const next = !row.done
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, done: next } : r)))
    const { error: err } = await db.update(TABLE, row.id, { done: next })
    if (err) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, done: !next } : r)))
      setError(err.message)
    }
  }

  async function remove(row) {
    const snapshot = rows
    setRows((prev) => prev.filter((r) => r.id !== row.id))
    const { error: err } = await db.remove(TABLE, row.id)
    if (err) {
      setRows(snapshot)
      setError(err.message)
    }
  }

  /**
   * Seed button. An app demoed against an empty database looks broken even when
   * it works — this exists so the demo never opens on a blank screen.
   * Delete it before submitting only if the app has real data of its own.
   */
  async function seed() {
    setBusy(true)
    await db.clear(TABLE)
    for (const title of ['Confirm tomorrow’s bookings', 'Call the supplier back', 'Send Friday invoice']) {
      await db.insert(TABLE, { title, done: false })
    }
    await load()
    setBusy(false)
  }

  return (
    <section className="mx-auto w-full max-w-xl px-4 pb-24">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-xl border border-ink-300/60 bg-white/80 px-4 py-3 text-base
             placeholder:text-ink-500 focus:border-accent dark:bg-ink-900/40"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add something…"
          aria-label="New item"
          enterKeyHint="done"
        />
        <button
          className="rounded-xl bg-accent px-5 py-3 font-medium text-white disabled:opacity-40"
          disabled={!draft.trim() || busy}
        >
          Add
        </button>
      </form>

      {error && (
        // One banner, dismissible, non-blocking. Never an alert().
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          <span className="flex-1">{error}</span>
          <button className="underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </p>
      )}

      {loading ? (
        <div className="mt-6 space-y-2" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-card bg-ink-100 dark:bg-ink-700/30"></div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        // Empty state does a job: it explains and it offers the next action.
        <div className="mt-10 rounded-card border border-dashed border-ink-300/70 px-6 py-10 text-center">
          <p className="text-ink-500">Nothing here yet.</p>
          <button className="mt-3 text-sm font-medium text-accent underline" onClick={seed} disabled={busy}>
            Load sample data
          </button>
        </div>
      ) : (
        <>
          <ul className="mt-6 space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-card bg-white px-4 py-3 shadow-sm dark:bg-ink-900/40"
              >
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-[var(--color-accent)]"
                  checked={row.done}
                  onChange={() => toggle(row)}
                  aria-label={`Mark "${row.title}" done`}
                />
                <span
                  className={`flex-1 break-words ${row.done ? 'line-through text-ink-500' : ''}`}
                >
                  {row.title}
                </span>
                <button
                  className="shrink-0 px-2 text-ink-500 hover:text-danger"
                  onClick={() => remove(row)}
                  aria-label={`Delete "${row.title}"`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-sm text-ink-500">
            {remaining} of {rows.length} left · stored in {backend === 'supabase' ? 'Supabase' : 'this browser'}
          </p>
        </>
      )}
    </section>
  )
}
