/**
 * Inventory tab (U3) — aid consignment CSV import + browse.
 *
 * Three independent pieces of state to keep straight:
 *   1. profile gate  — is there an approved staff session at all (auth.js)?
 *   2. data load     — fetchConsignments() + subscribeChanges() refresh.
 *   3. CSV import    — parse -> per-row error list -> import the good rows.
 *
 * Every branch below is a real UI state (loading/error/empty), not a silent
 * blank screen — CLAUDE.md rule 4.
 */
import { useEffect, useMemo, useState } from 'react'
import { fetchConsignments, addConsignments, subscribeChanges } from '../lib/api.js'
import { fetchMyProfile, can } from '../lib/auth.js'
import { hasSupabase } from '../lib/supa.js'
import { SUPPLY_ITEMS } from '../lib/store.js'
import { parseConsignmentsCsv } from '../lib/consignment-csv.js'

const ITEM_LABELS = Object.fromEntries(SUPPLY_ITEMS.map(([value, label]) => [value, label]))

// Dev-only stand-in profile used when Supabase isn't configured (no .env on
// this machine yet). There is no real auth backend to check in that mode —
// api.js already falls back to localStorage with no RLS to emulate — so we
// treat "local demo, no session" as full commissioner access purely so the
// whole import flow is clickable/testable offline. This is UX only: the
// moment Supabase IS configured, this branch is skipped entirely and
// Postgres RLS (see PERMISSIONS.md) is the only thing deciding access.
const DEV_PROFILE = { role: 'commissioner', approved: true }

function StateBox({ children, tone = 'muted' }) {
  const toneClass = tone === 'error' ? 'border-danger/40 text-danger' : 'border-dashed border-ink-300/70 text-ink-500'
  return <div className={`rounded-card border px-6 py-10 text-center ${toneClass}`}>{children}</div>
}

function fold(str) {
  return String(str ?? '').toLowerCase()
}

export default function ImportPanel() {
  // --- 1. profile gate -------------------------------------------------
  const [profile, setProfile] = useState(null)
  const [profileReady, setProfileReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!hasSupabase()) {
      setProfile(DEV_PROFILE)
      setProfileReady(true)
      return
    }
    fetchMyProfile()
      .then((p) => !cancelled && setProfile(p))
      .catch(() => !cancelled && setProfile(null))
      .finally(() => !cancelled && setProfileReady(true))
    return () => {
      cancelled = true
    }
  }, [])

  // "View needs / shortage data (shelter_needs, updates, consignments)" is
  // one capability tier in PERMISSIONS.md — any approved staff — so we reuse
  // the same `can()` action the shortage board uses; there is no separate
  // 'viewConsignments' action in auth.js.
  const canView = profileReady && can(profile, 'viewShortage')
  const canImport = profileReady && (can(profile, 'importConsignments') || !hasSupabase())

  // --- 2. data load ------------------------------------------------------
  const [consignments, setConsignments] = useState([])
  const [loadState, setLoadState] = useState('loading') // 'loading' | 'ready' | 'error'
  const [loadError, setLoadError] = useState('')

  async function loadConsignments() {
    setLoadState('loading')
    try {
      const rows = await fetchConsignments()
      setConsignments(rows)
      setLoadState('ready')
    } catch (e) {
      setLoadError(e?.message ?? 'Could not load consignments.')
      setLoadState('error')
    }
  }

  useEffect(() => {
    if (!canView) return
    loadConsignments()
    return subscribeChanges(() => loadConsignments())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView])

  // --- 3. CSV import -------------------------------------------------------
  const [rowErrors, setRowErrors] = useState([]) // [{row, line, message}]
  const [importMsg, setImportMsg] = useState(null) // { tone: 'ok' | 'warn' | 'error', text }
  const [importing, setImporting] = useState(false)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file twice in a row
    if (!file) return

    setImporting(true)
    setImportMsg(null)
    setRowErrors([])
    try {
      const text = await file.text()
      const { valid, errors } = parseConsignmentsCsv(text)
      setRowErrors(errors)

      if (valid.length > 0) {
        await addConsignments(valid)
        await loadConsignments()
      }

      const rowWord = (n) => `${n} row${n === 1 ? '' : 's'}`
      if (valid.length === 0) {
        setImportMsg({ tone: 'error', text: `0 rows imported, ${rowWord(errors.length)} rejected.` })
      } else if (errors.length > 0) {
        setImportMsg({ tone: 'warn', text: `${rowWord(valid.length)} imported, ${rowWord(errors.length)} rejected.` })
      } else {
        setImportMsg({ tone: 'ok', text: `${rowWord(valid.length)} imported.` })
      }
    } catch (err) {
      setImportMsg({ tone: 'error', text: err?.message ?? 'Could not read that file.' })
    } finally {
      setImporting(false)
    }
  }

  function dismissRowError(index) {
    setRowErrors((prev) => prev.filter((_, i) => i !== index))
  }

  // --- search + table -------------------------------------------------------
  const [query, setQuery] = useState('')

  // "newest first": api.js/store.js don't expose a created_at on
  // consignments (see fetchConsignments), so there's nothing to sort by —
  // both backends return rows in insertion order, so reversing that array
  // is the best available approximation of "last imported first".
  const newestFirst = useMemo(() => [...consignments].slice().reverse(), [consignments])

  const filtered = useMemo(() => {
    const q = fold(query).trim()
    if (!q) return newestFirst
    return newestFirst.filter((c) => fold(c.ngo).includes(q) || fold(ITEM_LABELS[c.item] ?? c.item).includes(q))
  }, [newestFirst, query])

  // --- render ---------------------------------------------------------------

  if (!profileReady) return <StateBox>Checking your access…</StateBox>

  if (!canView) {
    return (
      <StateBox>
        Aid inventory needs a staff login. Sign in with an approved volunteer, commissioner, or admin account to see
        consignments.
      </StateBox>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a href="/sample-aid.csv" download className="font-medium text-accent underline">
          sample CSV
        </a>
        <a href="/sample-aid-bad.csv" download className="font-medium text-accent underline">
          sample with bad rows
        </a>
      </div>

      {canImport && (
        <div className="rounded-card border border-dashed border-ink-300/70 px-4 py-6 text-center">
          <label className="cursor-pointer text-sm font-medium text-accent underline">
            {importing ? 'Reading file…' : 'Upload a consignments CSV'}
            <input type="file" accept=".csv,text/csv" className="hidden" disabled={importing} onChange={handleFile} />
          </label>
          <p className="mt-1 text-xs text-ink-500">Columns: ngo_name, item, quantity, unit, eta_hours</p>
        </div>
      )}

      {importMsg && (
        <p
          className={`rounded-xl px-4 py-3 text-sm ${
            importMsg.tone === 'error'
              ? 'bg-danger/10 text-danger'
              : importMsg.tone === 'warn'
                ? 'bg-danger/10 text-danger'
                : 'bg-ok/10 text-ok'
          }`}
          aria-live="polite"
        >
          {importMsg.text}
        </p>
      )}

      {rowErrors.length > 0 && (
        <div>
          <p className="text-sm font-medium text-ink-700 dark:text-ink-100">Rows with problems</p>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm">
            {rowErrors.map((e, i) => (
              <li key={i} className="flex items-start justify-between gap-2 rounded-lg bg-danger/10 px-3 py-1.5 text-danger">
                <span>
                  <span className="font-medium">Line {e.line}:</span> {e.message}
                </span>
                <button type="button" className="shrink-0 hover:opacity-70" aria-label="Dismiss" onClick={() => dismissRowError(i)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="relative">
        <input
          type="search"
          className="w-full rounded-xl border border-ink-300/60 bg-white/80 px-4 py-3 text-base placeholder:text-ink-500 focus:border-accent dark:bg-ink-900/40"
          placeholder="Search by NGO or item…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search consignments"
        />
      </div>

      {loadState === 'loading' && <StateBox>Loading consignments…</StateBox>}

      {loadState === 'error' && (
        <StateBox tone="error">
          {loadError}
          <button type="button" className="mt-3 block w-full text-sm font-medium text-accent underline" onClick={loadConsignments}>
            Try again
          </button>
        </StateBox>
      )}

      {loadState === 'ready' && filtered.length === 0 && (
        <StateBox>{consignments.length === 0 ? 'No consignments yet — import a CSV to get started.' : `Nothing matches "${query}".`}</StateBox>
      )}

      {loadState === 'ready' && filtered.length > 0 && (
        <>
          <p className="text-sm text-ink-500">
            {filtered.length} of {consignments.length} consignments
          </p>
          <div className="overflow-x-auto rounded-card border border-ink-300/50">
            <table className="w-full min-w-max text-left text-sm">
              <thead className="bg-ink-100 dark:bg-ink-700/30">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">NGO</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Item</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Qty</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">ETA</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Received</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-t border-ink-300/30">
                    <td className="whitespace-nowrap px-3 py-2">{c.ngo}</td>
                    <td className="whitespace-nowrap px-3 py-2">{ITEM_LABELS[c.item] ?? c.item}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {c.qty} {c.unit}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{c.etaHours}h</td>
                    {/* api.js/store.js don't expose a receipt timestamp on consignments today —
                        shown honestly as "—" rather than faking a date. */}
                    <td className="whitespace-nowrap px-3 py-2 text-ink-500">{c.receivedAt ?? c.createdAt ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
