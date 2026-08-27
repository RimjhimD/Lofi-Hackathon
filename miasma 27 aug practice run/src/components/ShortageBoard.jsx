/**
 * ShortageBoard — U4 (owner: Robiul). MVP bullet 4, the "Shortage board" tab.
 *
 * Paste target: `src/components/ShortageBoard.jsx` in the drill repo.
 * App.jsx already has the mount point (`{tab === 'shortage' && ...}`) — that
 * one-line swap is the integrator's, and it is the ONLY change outside this
 * file. Nothing here touches App.jsx, store.js, app.css, index.html or
 * package.json.
 *
 * What it does, per SPEC v2's done-when:
 *   - groups critical items (gap > 0) worst-first
 *   - ranks shelters inside each group by severity = needQty × occupancyRatio
 *   - shows the numbers behind the ranking, so a judge can see WHY shelter X
 *     outranks shelter Y without asking
 *   - re-renders when a field update or a CSV import lands (no page reload)
 *   - is gated: needs an approved staff session, per PERMISSIONS.md
 *
 * Data path: `fetchShelters()` returns pins WITHOUT needs (shelters is the one
 * public table); `fetchNeeds()` returns a flat `{shelterId, item, qty}` list
 * that requires an approved session. api.js's own doc says the caller
 * reassembles them, so this component groups needs by shelterId and hands
 * `shortageReport` the `{shelters, updates, consignments}` shape its contract
 * expects. No new dependency, no chart library — the gap bars are divs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchShelters, fetchNeeds, fetchConsignments, subscribeChanges } from '../lib/api.js'
import { can, fetchMyProfile, onAuthChange } from '../lib/auth.js'
// shortageReport and occupancyLevel come through store.js, which re-exports
// shortage.js — BOARD.md's standing note is to keep that single import path.
import { shortageReport, occupancyLevel } from '../lib/store.js'
// attachNeeds is U4's own helper and store.js does not re-export it. Imported
// direct rather than asking the integrator to widen store.js's export list
// mid-drill; if one path is preferred later, that is a one-line store.js change.
import { attachNeeds } from '../lib/shortage.js'

/**
 * True when the app is running with no Supabase keys. api.js/auth.js both fall
 * back to the localStorage seed in that mode and `fetchMyProfile()` resolves to
 * null, so gating on `can(null, …)` would lock the board out of local dev AND
 * out of a keyless deploy — auth.js's own module doc says to treat local mode
 * as "single local demo user, full access" instead.
 *
 * Read straight from import.meta.env rather than importing supa.js, to keep
 * this inside U4's own file. Worth asking the integrator to export an
 * `isLocalMode()` from auth.js so this check lives in one place.
 */
function isLocalMode() {
  const env = import.meta.env ?? {}
  return !(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY)
}

const PERCENT = (ratio) => `${Math.round(ratio * 100)}%`

const OCCUPANCY_STYLE = {
  over: 'bg-danger/15 text-danger',
  'near-full': 'bg-accent-soft text-accent',
  ok: 'bg-ink-100 text-ink-700 dark:bg-ink-700/30 dark:text-ink-100',
}

/** Thousands separators so 1200 reads as 1,200 on a projector. */
const num = (value) => Number(value).toLocaleString('en-US')

function Panel({ children, tone = 'muted' }) {
  const border = tone === 'error' ? 'border-danger/40' : 'border-ink-300/70'
  return (
    <div className={`rounded-card border border-dashed ${border} px-6 py-10 text-center`}>
      <div className="mx-auto max-w-md text-sm text-ink-500">{children}</div>
    </div>
  )
}

export default function ShortageBoard() {
  const [profile, setProfile] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const localMode = isLocalMode()
  const allowed = localMode || can(profile, 'viewShortage')

  // --- session ---------------------------------------------------------------
  useEffect(() => {
    let live = true
    const unsubscribe = onAuthChange(async () => {
      try {
        const next = await fetchMyProfile()
        if (live) setProfile(next)
      } catch {
        // A profile lookup failure is not the board's error to show — it just
        // means "no usable session", which the gate below already handles.
        if (live) setProfile(null)
      } finally {
        if (live) setAuthReady(true)
      }
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  // --- data ------------------------------------------------------------------
  const load = useCallback(async () => {
    try {
      // One await per table, in parallel — needs/consignments are the gated
      // reads, so a signed-out user's rejection surfaces here as an error
      // rather than a silently empty board.
      const [shelters, needs, consignments] = await Promise.all([
        fetchShelters(),
        fetchNeeds(),
        fetchConsignments(),
      ])
      setData({ shelters, needs, consignments })
      setError(null)
    } catch (err) {
      setError(err?.message || 'Could not load shortage data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!allowed) {
      setLoading(false)
      return undefined
    }
    setLoading(true)
    load()
    // Bullet 4's "updates when either source changes": one subscription, and
    // any change refetches what this tab shows. In local mode subscribeChanges
    // fires on every store mutation; on Supabase it fires per table.
    return subscribeChanges(() => {
      load()
    })
  }, [allowed, load])

  // --- derive ----------------------------------------------------------------
  const groups = useMemo(() => {
    if (!data) return []
    const shelters = attachNeeds(data.shelters, data.needs)
    return shortageReport({ shelters, updates: [], consignments: data.consignments ?? [] })
  }, [data])

  const worstGap = groups.length ? groups[0].gap : 0

  // --- render ----------------------------------------------------------------
  if (!authReady && !localMode) {
    return <Panel>Checking your access…</Panel>
  }

  if (!allowed) {
    return (
      <Panel>
        <p className="font-medium text-ink-700 dark:text-ink-100">Sign in to see the shortage board</p>
        <p className="mt-2">
          Shelter needs and aid stock are visible to approved staff only. The public map stays open to
          everyone. If you have just signed up, an admin still has to approve your account.
        </p>
      </Panel>
    )
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-card bg-ink-100 dark:bg-ink-700/30" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Panel tone="error">
        <p className="font-medium text-danger">Could not load the shortage board</p>
        <p className="mt-2">{error}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            load()
          }}
          className="mt-4 rounded-card bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Try again
        </button>
      </Panel>
    )
  }

  if (!groups.length) {
    return (
      <Panel>
        <p className="font-medium text-ink-700 dark:text-ink-100">No critical shortages right now</p>
        <p className="mt-2">
          Every supply item has at least as much incoming stock as the shelters have asked for. Items
          appear here the moment a field update pushes demand past stock.
        </p>
      </Panel>
    )
  }

  return (
    <section aria-label="Shortage board">
      <header className="pb-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {groups.length} item{groups.length === 1 ? '' : 's'} critically short
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          An item is critical when shelters need more than all consignments hold. Worst gap first;
          inside each item, shelters are ranked by <strong>need × occupancy</strong> — a fuller
          shelter with the same need outranks an emptier one.
        </p>
      </header>

      <ul className="space-y-3">
        {groups.map((group) => (
          <li key={group.item} className="rounded-card border border-ink-300/60 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-base font-semibold">{group.label}</h3>
              <p className="text-sm text-ink-500">
                need <strong className="text-ink-900 dark:text-ink-50">{num(group.totalNeed)}</strong>{' '}
                {group.unit} · stock {num(group.totalStock)} {group.unit} ·{' '}
                <strong className="text-danger">gap {num(group.gap)} {group.unit}</strong>
              </p>
            </div>

            {/* Proportional gap bar: stock covered vs the shortfall. Plain divs
                — the charts recipe cannot draw paired bars and silently drops
                labels past six items. */}
            <div
              className="mt-3 flex h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-700/30"
              role="img"
              aria-label={`${group.label}: ${num(group.totalStock)} ${group.unit} in stock against ${num(
                group.totalNeed
              )} ${group.unit} needed, short by ${num(group.gap)}`}
            >
              <div
                className="bg-accent"
                style={{ width: `${(group.totalStock / group.totalNeed) * 100}%` }}
              />
              <div className="bg-danger" style={{ width: `${(group.gap / group.totalNeed) * 100}%` }} />
            </div>
            {worstGap > 0 && (
              <p className="mt-1 text-xs text-ink-500">
                {Math.round((group.totalStock / group.totalNeed) * 100)}% of demand covered
              </p>
            )}

            <ol className="mt-3 space-y-2">
              {group.shelters.map((row, index) => {
                const ratio = row.shelter.capacity ? row.shelter.headcount / row.shelter.capacity : 0
                const level = occupancyLevel(row.shelter)
                return (
                  <li
                    key={row.shelter.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-ink-300/40 pt-2 text-sm"
                  >
                    <span className="w-5 shrink-0 text-ink-500">{index + 1}.</span>
                    <span className="min-w-0 flex-1 font-medium">
                      {row.shelter.name}
                      {row.shelter.upazila && (
                        <span className="font-normal text-ink-500"> · {row.shelter.upazila}</span>
                      )}
                    </span>
                    <span className="text-ink-500">
                      needs <strong className="text-ink-900 dark:text-ink-50">{num(row.needQty)}</strong>{' '}
                      {group.unit}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${OCCUPANCY_STYLE[level]}`}>
                      {num(row.shelter.headcount)}/{num(row.shelter.capacity)} · {PERCENT(ratio)}
                    </span>
                    <span className="text-xs text-ink-500" title="needQty × occupancy ratio">
                      severity {row.severity.toFixed(1)}
                    </span>
                  </li>
                )
              })}
            </ol>
          </li>
        ))}
      </ul>
    </section>
  )
}
