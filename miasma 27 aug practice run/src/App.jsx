/**
 * App shell — sidebar navigation, top bar, and each panel's mount point.
 *
 * The three access tiers ARE the product, so navigation shows them instead of
 * hiding the difference: a locked destination stays visible with a lock, so
 * anyone can see the app has an access model. Client-side `can()` is UX only —
 * Postgres RLS is the real wall (PERMISSIONS.md).
 *
 *   public       → shelter map only
 *   volunteer    → overview, needs, field reports, shortage board
 *   commissioner → the above plus aid imports
 *   admin        → the above plus account management
 *
 * Integrator note: the header AuthShim is replaced here by LoginPanel, as its
 * own comment invited. Everything else here is layout and mount points.
 */
import { useState } from 'react'
import MapView from './components/MapView.jsx'
import ImportPanel from './components/ImportPanel.jsx'
import AdminPanel from './components/AdminPanel.jsx'
import LoginPanel, { useSession, ROLE_STYLE } from './components/LoginPanel.jsx'
import Dashboard from './components/Dashboard.jsx'
import UpdateForm from './components/UpdateForm.jsx'
import UpdatesFeed from './components/UpdatesFeed.jsx'
import ShortageBoard from './components/ShortageBoard.jsx'
import { can } from './lib/auth.js'

const APP_NAME = 'Relief Lens'

const ICONS = {
  map: (
    <>
      <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  inventory: (
    <>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" strokeLinejoin="round" />
      <path d="m3 7.5 9 4.5 9-4.5M12 12v9" />
    </>
  ),
  shortage: (
    <>
      <path d="M3 3v18h18" strokeLinecap="round" />
      <path d="m7 14 3-4 3 3 4-6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  admin: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" strokeLinecap="round" />
      <path d="M17 9.5h4M19 7.5v4" strokeLinecap="round" />
    </>
  ),
}

const NAV = [
  { id: 'map', label: 'Shelter map', tier: 'Public', action: null, blurb: 'Where people are sheltering' },
  { id: 'inventory', label: 'Aid inventory', tier: 'Staff', action: 'viewShortage', blurb: 'Incoming consignments' },
  { id: 'shortage', label: 'Shortage board', tier: 'Staff', action: 'viewShortage', blurb: 'What is short, and where' },
  { id: 'admin', label: 'Accounts', tier: 'Admin', action: 'manageAccounts', blurb: 'Approve staff, set roles' },
]

function Icon({ name, className = 'h-4.5 w-4.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

function LockIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  )
}

function Panel({ title, children }) {
  return (
    <div className="flex min-h-[22rem] animate-[rl-fade_.35s_ease-out_both] flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900/40">
      <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{title}</p>
      <p className="max-w-sm text-xs leading-relaxed text-slate-400">{children}</p>
    </div>
  )
}

function Locked({ label }) {
  return (
    <div className="flex min-h-[22rem] animate-[rl-fade_.35s_ease-out_both] flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
        <LockIcon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label} is staff-only</p>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Sign in with a demo account from the panel on the right. The database enforces this too — hiding the page is
          only the polite half.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const { profile, signedIn } = useSession()
  const [page, setPage] = useState('map')
  const allowed = (action) => !action || can(profile, action)
  const current = NAV.find((n) => n.id === page) ?? NAV[0]

  const NavItems = ({ onPick }) =>
    NAV.map(({ id, label, action, blurb }) => {
      const isActive = page === id
      const open = allowed(action)
      return (
        <button
          key={id}
          type="button"
          onClick={() => {
            setPage(id)
            onPick?.()
          }}
          aria-current={isActive ? 'page' : undefined}
          className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200 ${
            isActive
              ? 'bg-white/10 text-white shadow-inner ring-1 ring-white/15'
              : open
                ? 'text-slate-300 hover:bg-white/5 hover:text-white'
                : 'text-slate-500 hover:bg-white/5'
          }`}
        >
          <span
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition ${
              isActive ? 'bg-sky-500 text-white shadow-sm shadow-sky-900/40' : 'bg-white/5 text-slate-400 group-hover:text-slate-200'
            }`}
          >
            <Icon name={id} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {label}
              {!open && <LockIcon />}
            </span>
            <span className="block truncate text-[11px] text-slate-500">{blurb}</span>
          </span>
        </button>
      )
    })

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900 lg:flex dark:bg-slate-950 dark:text-slate-100">
      {/* Sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col bg-gradient-to-b from-slate-900 to-slate-950 lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="flex items-center gap-3 px-5 py-5">
          <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-700 text-white shadow-lg shadow-blue-900/40">
            <Icon name="map" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight text-white">{APP_NAME}</p>
            <p className="truncate text-[11px] text-slate-400">District relief cell</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Sections">
          <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Operations</p>
          <NavItems />
        </nav>

        <div className="border-t border-white/5 px-5 py-4">
          {signedIn ? (
            <div className="flex items-center gap-2.5">
              <span className={`grid h-8 w-8 place-items-center rounded-lg text-[11px] font-bold uppercase ring-1 ${ROLE_STYLE[profile.role] ?? ROLE_STYLE.volunteer}`}>
                {(profile.full_name || profile.role).slice(0, 2)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-200">{profile.full_name || 'Staff user'}</p>
                <p className="text-[11px] capitalize text-slate-500">{profile.role}</p>
              </div>
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-slate-500">
              Viewing public information. Sign in for needs, reports and aid stock.
            </p>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Top bar */}
        <header className="sticky top-0 z-[600] border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/85">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{current.tier}</p>
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">{current.label}</h1>
            </div>

            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Live
            </span>

            {signedIn ? (
              <span className={`inline-flex animate-[rl-pop_.3s_ease-out_both] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium capitalize ring-1 ${ROLE_STYLE[profile.role] ?? ROLE_STYLE.volunteer}`}>
                {profile.role}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                Public view
              </span>
            )}
          </div>

          {/* Mobile nav */}
          <div className="flex gap-1 overflow-x-auto border-t border-slate-200 px-3 py-2 lg:hidden dark:border-slate-800">
            {NAV.map(({ id, label, action }) => {
              const isActive = page === id
              const open = allowed(action)
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPage(id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    isActive ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {!open && <LockIcon className="h-3 w-3" />}
                  {label}
                </button>
              )
            })}
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6">
          {signedIn ? (
            <Dashboard />
          ) : (
            <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 via-blue-600 to-sky-500 px-5 py-6 text-white shadow-lg shadow-blue-900/10 animate-[rl-rise_.5s_ease-out_both] sm:px-7 sm:py-8">
              <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
              <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-24 h-48 w-48 rounded-full bg-sky-300/20 blur-3xl" />
              <p className="relative text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">Public information</p>
              <h2 className="relative mt-1 max-w-2xl text-xl font-semibold leading-snug sm:text-2xl">
                Every open flood shelter in the district, and how full it is right now.
              </h2>
              <p className="relative mt-2 max-w-2xl text-sm text-white/85">
                Supply needs, field reports and aid stock are restricted to the relief cell.
              </p>
            </section>
          )}

          <div className="mt-6 flex animate-[rl-rise_.5s_ease-out_both] flex-col gap-6 xl:flex-row">
            <div key={`${profile?.role ?? 'anon'}-${page}`} className="min-w-0 flex-1 animate-[rl-fade_.35s_ease-out_both]">
              {page === 'map' && <MapView />}
              {page === 'inventory' && (allowed('viewShortage') ? <ImportPanel /> : <Locked label="Aid inventory" />)}
              {page === 'shortage' &&
                (allowed('viewShortage') ? <ShortageBoard /> : <Locked label="The shortage board" />)}
              {page === 'admin' && (allowed('manageAccounts') ? <AdminPanel /> : <Locked label="Account management" />)}
            </div>

            <aside className="flex w-full shrink-0 flex-col gap-4 xl:w-84">
              <LoginPanel />
              {allowed('submitUpdate') ? (
                <>
                  <UpdateForm profile={profile} />
                  <UpdatesFeed profile={profile} />
                </>
              ) : (
                <p className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-xs leading-relaxed text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  Field reporting is staff-only. Approved volunteers file shelter headcounts and urgent needs here, and
                  every report updates the map for everyone immediately.
                </p>
              )}
            </aside>
          </div>

          <footer className="pt-8 text-xs text-slate-400">Relief Lens</footer>
        </main>
      </div>
    </div>
  )
}
