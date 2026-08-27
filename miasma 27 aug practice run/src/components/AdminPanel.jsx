/**
 * Account management (U5). Gated to approved admins only — see auth.js's
 * `can(profile, 'manageAccounts')`. That gate is UX only; the real wall is
 * Postgres RLS (`profiles_select_admin` / `profiles_update_admin` +
 * `guard_profile_privileges_trigger`, see PERMISSIONS.md "Manage accounts").
 * A rejected write still surfaces here as a visible error message, never a
 * crash or a silent no-op.
 *
 * Mount only when `can(profile, 'manageAccounts')` is true (App.jsx's job —
 * see the integration note this unit returns) so a non-admin never even
 * sees the "Admin" tab; this component's own gate below is the second,
 * belt-and-braces layer for the case where it renders anyway (e.g. someone
 * pastes the URL fragment, or profile approval changes mid-session).
 */
import { useEffect, useState } from 'react'
import { fetchMyProfile, can } from '../lib/auth.js'
import { hasSupabase } from '../lib/supa.js'
import { fetchProfiles, setRole, setApproved, sortProfilesPendingFirst, subscribeMockProfiles } from '../lib/admin-api.js'

const ROLES = ['volunteer', 'commissioner', 'admin']

function shortId(id) {
  return `#${String(id).slice(0, 8)}`
}

function formatJoined(createdAt) {
  if (!createdAt) return null
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function GatePanel({ myProfile }) {
  return (
    <div className="rounded-card border border-dashed border-ink-300/70 px-6 py-10 text-center text-ink-500">
      <p className="font-medium text-ink-700 dark:text-ink-300">Admin sign-in required</p>
      <p className="mx-auto mt-1 max-w-sm text-sm">
        {myProfile
          ? `Signed in as ${myProfile.full_name || myProfile.role} — account management is limited to approved admins.`
          : 'Sign in with an approved admin account to approve users and change roles.'}
      </p>
    </div>
  )
}

function ProfileRow({ row, isSelf, saving, error, onRoleChange, onApprovedToggle, onDismissError }) {
  const selfTitle = isSelf ? 'you cannot demote yourself' : undefined

  return (
    <li
      className={`rounded-card border px-4 py-3 ${
        !row.approved
          ? 'border-accent/40 bg-accent-soft/60 dark:bg-accent-soft/10'
          : 'border-ink-300/60 bg-white dark:bg-ink-900/40'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-ink-900 dark:text-ink-50">
              {row.full_name || '(no name on file)'}
            </span>
            <span className="font-mono text-xs text-ink-500">{shortId(row.id)}</span>
            {!row.approved && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white">
                pending approval
              </span>
            )}
          </div>
          {formatJoined(row.created_at) && (
            <p className="mt-0.5 text-xs text-ink-500">Joined {formatJoined(row.created_at)}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <label className="sr-only" htmlFor={`role-${row.id}`}>
            Role for {row.full_name || shortId(row.id)}
          </label>
          <select
            id={`role-${row.id}`}
            value={row.role}
            disabled={saving || isSelf}
            title={selfTitle}
            onChange={(e) => onRoleChange(row, e.target.value)}
            className="rounded-lg border border-ink-300/60 bg-white px-3 py-2 text-sm capitalize disabled:opacity-40 dark:bg-ink-900/60 dark:border-ink-700"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={saving || isSelf}
            title={selfTitle}
            onClick={() => onApprovedToggle(row)}
            className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40 ${
              row.approved
                ? 'border border-danger/40 text-danger hover:bg-danger/10'
                : 'bg-accent text-white hover:opacity-90'
            }`}
          >
            {saving ? 'Saving…' : row.approved ? 'Revoke' : 'Approve'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          <span className="flex-1">{error}</span>
          <button type="button" className="shrink-0 underline" onClick={onDismissError}>
            dismiss
          </button>
        </p>
      )}
    </li>
  )
}

export default function AdminPanel() {
  const [loading, setLoading] = useState(true)
  const [myProfile, setMyProfile] = useState(null)
  const [allowed, setAllowed] = useState(false)
  const [profiles, setProfiles] = useState([])
  const [listError, setListError] = useState(null)
  const [savingIds, setSavingIds] = useState(() => new Set())
  const [rowErrors, setRowErrors] = useState({})
  const [reloadToken, setReloadToken] = useState(0)

  // Gate + initial load. Re-runs on manual retry (reloadToken) only — role
  // changes to other rows don't need to re-check who *I* am.
  useEffect(() => {
    let cancelled = false

    async function init() {
      setLoading(true)
      setListError(null)
      try {
        const me = await fetchMyProfile()
        if (cancelled) return
        setMyProfile(me)

        // Dev-only: no Supabase configured means no real auth backend to
        // gate against, so treat the local session as admin (see auth.js's
        // module doc — "no session" in local mode is "single local demo
        // user, full access", not "logged out").
        const isAllowed = !hasSupabase() || can(me, 'manageAccounts')
        setAllowed(isAllowed)
        if (!isAllowed) {
          setProfiles([])
          return
        }

        const rows = await fetchProfiles()
        if (cancelled) return
        setProfiles(rows)
      } catch (err) {
        if (!cancelled) setListError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  // Dev-only mock backend has no Postgres realtime — this tiny subscribe is
  // what keeps the list in sync (see admin-api.js's subscribeMockProfiles).
  // No-op under a real Supabase backend (the mock never mutates in that mode).
  useEffect(() => {
    if (hasSupabase()) return undefined
    return subscribeMockProfiles(setProfiles)
  }, [])

  async function mutate(id, applyOptimistic, apiCall) {
    setRowErrors((prev) => ({ ...prev, [id]: null }))
    let previous
    setProfiles((prev) => {
      previous = prev
      return prev.map((p) => (p.id === id ? applyOptimistic(p) : p))
    })
    setSavingIds((prev) => new Set(prev).add(id))
    try {
      const updated = await apiCall()
      setProfiles((prev) => prev.map((p) => (p.id === id ? updated : p)))
    } catch (err) {
      // Revert to server truth — the optimistic change never happened.
      setProfiles(previous)
      setRowErrors((prev) => ({ ...prev, [id]: err.message }))
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  function handleRoleChange(row, role) {
    mutate(
      row.id,
      (p) => ({ ...p, role }),
      () => setRole(row.id, role)
    )
  }

  function handleApprovedToggle(row) {
    const nextApproved = !row.approved
    mutate(
      row.id,
      (p) => ({ ...p, approved: nextApproved }),
      () => setApproved(row.id, nextApproved)
    )
  }

  function dismissRowError(id) {
    setRowErrors((prev) => ({ ...prev, [id]: null }))
  }

  if (loading) {
    return <div className="h-40 animate-pulse rounded-card bg-ink-100 dark:bg-ink-700/30" aria-busy="true" />
  }

  if (!allowed) {
    return <GatePanel myProfile={myProfile} />
  }

  if (listError) {
    return (
      <div className="rounded-card border border-danger/40 bg-danger/10 px-6 py-8 text-center">
        <p className="font-medium text-danger">Could not load accounts</p>
        <p className="mt-1 text-sm text-danger">{listError}</p>
        <button
          type="button"
          onClick={() => setReloadToken((n) => n + 1)}
          className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Try again
        </button>
      </div>
    )
  }

  if (profiles.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-ink-300/70 px-6 py-10 text-center text-ink-500">
        No accounts yet.
      </div>
    )
  }

  const sorted = sortProfilesPendingFirst(profiles)
  const pendingCount = profiles.filter((p) => !p.approved).length

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">Accounts</h2>
        <p className="mt-1 inline-block rounded-full bg-accent-soft px-3 py-1 text-xs text-accent">
          {profiles.length} accounts · {pendingCount} pending approval
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {sorted.map((row) => (
          <ProfileRow
            key={row.id}
            row={row}
            isSelf={Boolean(myProfile && row.id === myProfile.id)}
            saving={savingIds.has(row.id)}
            error={rowErrors[row.id]}
            onRoleChange={handleRoleChange}
            onApprovedToggle={handleApprovedToggle}
            onDismissError={() => dismissRowError(row.id)}
          />
        ))}
      </ul>
    </section>
  )
}
