/**
 * U1 — signed-in district summary.
 *
 * The first thing a duty officer needs on opening the app: how many people are
 * sheltering, how many sites are past capacity, what aid is inbound. Public
 * visitors never see it (PERMISSIONS.md "View map" is the whole public tier).
 * Derived entirely from api.js reads — no new tables, and deliberately not the
 * shortage board, which is U4's unit.
 */
import { useCallback, useEffect, useState } from 'react'
import { fetchShelters, fetchUpdates, fetchConsignments, subscribeChanges } from '../lib/api.js'
import { occupancyLevel } from '../lib/store.js'
import { can } from '../lib/auth.js'
import { useSession } from './LoginPanel.jsx'

const TONES = {
  neutral: 'text-slate-900 dark:text-slate-100',
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-rose-600 dark:text-rose-400',
}

const RAILS = {
  neutral: 'bg-slate-300 dark:bg-slate-700',
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-rose-500',
}

function Stat({ label, value, sub, tone = 'neutral' }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <span className={`absolute inset-y-0 left-0 w-1 ${RAILS[tone]}`} aria-hidden="true" />
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums leading-none ${TONES[tone]}`}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

/**
 * subscribeChanges() shares one fixed-name Supabase channel across every
 * caller, and supabase-js throws if a second caller attaches listeners after
 * the channel has already subscribed. An uncaught throw inside an effect takes
 * the whole React tree down (white screen), so every subscription here is
 * defensive: losing live refresh degrades to a static view, which is survivable
 * — losing the page is not. Real fix belongs in api.js (unique channel name).
 */
function safeSubscribe(cb) {
  try {
    const off = subscribeChanges(cb)
    return typeof off === 'function' ? off : () => {}
  } catch {
    return () => {}
  }
}

export default function Dashboard() {
  const { profile, localMode } = useSession()
  const approved = can(profile, 'viewShortage') || localMode

  const [shelters, setShelters] = useState([])
  const [updates, setUpdates] = useState([])
  const [consignments, setConsignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      setShelters(await fetchShelters())
      if (approved) {
        const [u, c] = await Promise.all([fetchUpdates().catch(() => []), fetchConsignments().catch(() => [])])
        setUpdates(u)
        setConsignments(c)
      } else {
        setUpdates([])
        setConsignments([])
      }
      setError(null)
    } catch (e) {
      setError(e?.message ?? 'Could not load the district summary.')
    } finally {
      setLoading(false)
    }
  }, [approved])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => safeSubscribe(() => load()), [load])

  if (loading) {
    return <div className="h-24 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/70" aria-busy="true" />
  }

  if (error) {
    return (
      <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30">
        {error}
      </p>
    )
  }

  const people = shelters.reduce((sum, s) => sum + (Number(s.headcount) || 0), 0)
  const capacity = shelters.reduce((sum, s) => sum + (Number(s.capacity) || 0), 0)
  const over = shelters.filter((s) => occupancyLevel(s) === 'over').length
  const nearFull = shelters.filter((s) => occupancyLevel(s) === 'near-full').length
  const pressure = capacity ? Math.round((people / capacity) * 100) : 0
  const inbound = consignments.reduce((sum, c) => sum + (Number(c.qty) || 0), 0)

  return (
    <section aria-label="District summary">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          District overview
        </h2>
        {updates[0] && (
          <p className="hidden truncate text-xs text-slate-400 sm:block">
            Latest report: “{updates[0].note || 'no note'}”
          </p>
        )}
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Shelters open" value={shelters.length} sub="active sites" />
        <Stat label="People sheltering" value={people.toLocaleString('en-US')} sub={`${pressure}% of capacity`} />
        <Stat label="Total capacity" value={capacity.toLocaleString('en-US')} sub="planned places" />
        <Stat label="Over capacity" value={over} tone={over ? 'bad' : 'ok'} sub={over ? 'needs relief now' : 'none'} />
        <Stat label="Near full" value={nearFull} tone={nearFull ? 'warn' : 'ok'} sub="85–100%" />
        <Stat
          label="Aid inbound"
          value={approved ? consignments.length : '—'}
          tone="neutral"
          sub={approved ? `${inbound.toLocaleString('en-US')} units pledged` : 'staff only'}
        />
      </dl>

      {!approved && (
        <p className="mt-2 text-xs text-slate-400">
          Your account is awaiting approval, so needs, updates and aid stock stay hidden.
        </p>
      )}
    </section>
  )
}
