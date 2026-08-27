/**
 * Authentication surface, and the session hook the rest of the UI reads.
 *
 * Auth goes through src/lib/auth.js; the only import from supa.js is the
 * documented hasSupabase() branch flag.
 *
 * WHY THERE IS A LOCAL SESSION
 * With no backend keys, auth.js cannot sign anyone in, so the login screen
 * could never be exercised and every role gate would be untestable. Local mode
 * therefore gets a real in-memory session: same three accounts, same password,
 * same roles, driving the same can() checks. Sign in locally and the UI behaves
 * exactly as it will against the real database.
 */
import { useCallback, useEffect, useState } from 'react'
import { onAuthChange, fetchMyProfile, signInWithPassword, signOut, can } from '../lib/auth.js'
import { hasSupabase } from '../lib/supa.js'

export const DEMO_PASSWORD = 'relief-demo-2026'

export const DEMO_USERS = [
  { email: 'volunteer@relieflens.demo', role: 'volunteer', title: 'Volunteer', blurb: 'Field team — sees needs, files reports' },
  { email: 'commissioner@relieflens.demo', role: 'commissioner', title: 'Commissioner', blurb: 'Relief cell — the above, plus aid imports' },
  { email: 'admin@relieflens.demo', role: 'admin', title: 'Admin', blurb: 'Everything, plus account management' },
]

export const ROLE_STYLE = {
  volunteer: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
  commissioner: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30',
  admin: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30',
}

let localProfile = null
const localListeners = new Set()
function setLocalProfile(next) {
  localProfile = next
  for (const fn of localListeners) fn(next)
}
function localSignIn(email, password) {
  const user = DEMO_USERS.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase())
  if (!user) throw new Error('No demo account with that email address.')
  if (password !== DEMO_PASSWORD) throw new Error('Wrong password for the demo account.')
  setLocalProfile({ id: `local-${user.role}`, full_name: user.title, role: user.role, approved: true })
}

export function useSession() {
  const localMode = !hasSupabase()
  const [profile, setProfile] = useState(localMode ? localProfile : null)
  const [loading, setLoading] = useState(!localMode)

  useEffect(() => {
    if (localMode) {
      localListeners.add(setProfile)
      setProfile(localProfile)
      return () => localListeners.delete(setProfile)
    }
    let alive = true
    const unsubscribe = onAuthChange(async (session) => {
      if (!alive) return
      if (!session) {
        setProfile(null)
        setLoading(false)
        return
      }
      try {
        const next = await fetchMyProfile()
        if (alive) setProfile(next)
      } catch {
        if (alive) setProfile(null)
      } finally {
        if (alive) setLoading(false)
      }
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [localMode])

  return { profile, loading, localMode, signedIn: Boolean(profile) }
}

function Shield() {
  return (
    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-sm">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z" strokeLinejoin="round" />
        <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

export default function LoginPanel() {
  const { profile, loading, localMode, signedIn } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)

  const doSignIn = useCallback(
    async (nextEmail, nextPassword) => {
      setError(null)
      setBusy(true)
      try {
        if (localMode) localSignIn(nextEmail, nextPassword)
        else await signInWithPassword(String(nextEmail).trim(), nextPassword)
        setPassword('')
      } catch (e) {
        setError(e?.message ?? 'Sign-in failed.')
      } finally {
        setBusy(false)
      }
    },
    [localMode],
  )

  async function handleSignOut() {
    if (localMode) return setLocalProfile(null)
    try {
      await signOut()
    } catch (e) {
      setError(e?.message ?? 'Sign-out failed.')
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" aria-busy="true" />
      </section>
    )
  }

  if (signedIn) {
    const meta = DEMO_USERS.find((u) => u.role === profile.role)
    return (
      <section className="animate-[rl-rise_.4s_ease-out_both] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <Shield />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold leading-tight">{profile.full_name || 'Staff user'}</h2>
            <span className={`mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${ROLE_STYLE[profile.role] ?? ROLE_STYLE.volunteer}`}>
              {profile.role}
              {profile.approved ? '' : ' · pending approval'}
            </span>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{meta?.blurb ?? 'Approved staff account.'}</p>
        {!profile.approved && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300">
            An admin has to approve this account before needs and reports unlock.
          </p>
        )}
        <button type="button" onClick={handleSignOut} className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium transition hover:bg-slate-50 active:scale-[.98] dark:border-slate-700 dark:hover:bg-slate-800">
          Sign out
        </button>
      </section>
    )
  }

  return (
    <section className="animate-[rl-rise_.4s_ease-out_both] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
        <Shield />
        <div>
          <h2 className="text-sm font-semibold leading-tight">Staff sign-in</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Needs, reports and aid are staff-only.</p>
        </div>
      </div>

      <div className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">One tap</p>
        <ul className="mt-2 space-y-2">
          {DEMO_USERS.map((user) => (
            <li key={user.email}>
              <button
                type="button"
                disabled={busy}
                onClick={() => doSignIn(user.email, DEMO_PASSWORD)}
                className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition-all duration-200 hover:-translate-y-px hover:border-blue-400 hover:shadow-md active:scale-[.98] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
              >
                <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold uppercase ring-1 ${ROLE_STYLE[user.role]}`}>
                  {user.title.slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{user.title}</span>
                  <span className="block truncate text-[11px] text-slate-400">{user.blurb}</span>
                </span>
                <span aria-hidden="true" className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-500">→</span>
              </button>
            </li>
          ))}
        </ul>

        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </p>
        )}

        <button type="button" onClick={() => setShowForm((v) => !v)} className="mt-3 text-xs font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400">
          {showForm ? 'Hide email sign-in' : 'Sign in with email instead'}
        </button>

        {showForm && (
          <form
            className="mt-2 flex flex-col gap-2 animate-[rl-fade_.3s_ease-out_both]"
            onSubmit={(e) => {
              e.preventDefault()
              if (!email.trim() || !password) return setError('Enter an email address and a password.')
              doSignIn(email, password)
            }}
          >
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="volunteer@relieflens.demo" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950" />
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950" />
            <button type="submit" disabled={busy} className="rounded-xl bg-gradient-to-b from-blue-600 to-blue-700 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-blue-500 hover:to-blue-600 active:scale-[.98] disabled:opacity-50">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        <p className="mt-3 border-t border-slate-200 pt-3 text-[11px] leading-relaxed text-slate-400 dark:border-slate-800">
          Password for all three: <code className="rounded bg-slate-100 px-1 font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-300">{DEMO_PASSWORD}</code>
        </p>
      </div>
    </section>
  )
}

export { can }
