/**
 * Admin data access — `profiles` table, backing U5's AdminPanel.jsx. Mirrors
 * ./api.js's contract and backend split (SPEC.md, U5 row):
 *
 *   hasSupabase() true  -> talks to Postgres via ./supa.js. RLS is the real
 *     wall (see PERMISSIONS.md "Manage accounts" — profiles_select_admin /
 *     profiles_update_admin gate every read/write here to app_role() ===
 *     'admin' server-side, and guard_profile_privileges_trigger blocks even
 *     an admin's own row from having role/approved changed by anyone else).
 *     A rejected read/write surfaces here as a thrown Error, never a silent
 *     no-op — AdminPanel shows the message, it never swallows it.
 *   hasSupabase() false -> delegates to an in-module mock profile list, so
 *     the panel is fully demoable offline with zero Supabase setup, same
 *     trick api.js plays with ./store.js. THIS MOCK IS DEV-ONLY: it has no
 *     RLS behind it — Postgres RLS is the real wall, this is just enough
 *     fake data to look at while building the UI. See auth.js's module doc
 *     for the same warning applied to `can()`.
 *
 * WHY THE SUPABASE IMPORT BELOW IS DYNAMIC, NOT STATIC:
 * ./supa.js reads `import.meta.env.VITE_*` at module-evaluation time with no
 * guard. Vite replaces `import.meta.env` at build/dev time, but that
 * replacement does not exist under plain `node --test` — `import.meta.env`
 * is simply `undefined` there (see src/recipes/llm/README.md, "import.meta.env
 * can't be stubbed under plain node --test"). A *static*
 * `import … from './supa.js'` at the top of this file would crash
 * `node --test src/lib/admin-api.test.mjs` before a single test ran, even a
 * test that only exercises the pure `sortProfilesPendingFirst` helper below,
 * because static imports are evaluated eagerly, in full, before anything
 * else in the file runs. A dynamic `import('./supa.js')`, scoped inside the
 * three functions that actually need a backend, defers that evaluation to
 * call time — so loading this module for its pure logic stays test-safe.
 * Under Vite (the app's real runtime) this behaves identically to a static
 * import: the module is already in the bundle (api.js/auth.js import it
 * statically), so the dynamic import resolves from cache with no extra
 * network round-trip.
 */

function fail(error, fallbackMessage) {
  throw new Error(error?.message || fallbackMessage)
}

/** Lazily loads ./supa.js — see the module doc above for why this is dynamic. */
async function backend() {
  return import('./supa.js')
}

function mapProfileRow(row) {
  return {
    id: row.id,
    full_name: row.full_name,
    role: row.role,
    approved: row.approved,
    created_at: row.created_at,
  }
}

// --- dev-only mock fallback --------------------------------------------
// Consulted only when hasSupabase() is false. One of each role, plus a
// second volunteer left pending, so the panel's "pending first" sort and
// approve/revoke flow both have something to show from first paint.

function makeMockProfiles() {
  const day = 86400000
  const now = Date.now()
  return [
    {
      id: 'mock-admin-0001',
      full_name: 'Amina Karim (admin)',
      role: 'admin',
      approved: true,
      created_at: new Date(now - 6 * day).toISOString(),
    },
    {
      id: 'mock-commissioner-0002',
      full_name: 'Farid Hossain',
      role: 'commissioner',
      approved: true,
      created_at: new Date(now - 5 * day).toISOString(),
    },
    {
      id: 'mock-volunteer-0003',
      full_name: 'Nusrat Jahan',
      role: 'volunteer',
      approved: true,
      created_at: new Date(now - 4 * day).toISOString(),
    },
    {
      id: 'mock-volunteer-0004',
      full_name: 'Rakib Uddin',
      role: 'volunteer',
      approved: false,
      created_at: new Date(now - 1 * day).toISOString(),
    },
  ]
}

let mockProfiles = makeMockProfiles()
const mockListeners = new Set()

function notifyMock() {
  const snapshot = mockProfiles.map((p) => ({ ...p }))
  for (const fn of mockListeners) fn(snapshot)
}

/**
 * Dev-only: subscribe to mock-profile changes. `fn(profiles)` fires
 * immediately with the current list, then again after every
 * setRole()/setApproved() call made while hasSupabase() is false — there is
 * no Postgres realtime to listen to in this mode, so this tiny pub/sub is
 * what lets AdminPanel re-render after its own writes. Returns an
 * unsubscribe function. No-op to call under a real Supabase backend (it
 * only ever fires from the mock writes below).
 */
export function subscribeMockProfiles(fn) {
  fn(mockProfiles.map((p) => ({ ...p })))
  mockListeners.add(fn)
  return () => mockListeners.delete(fn)
}

/** Test/debug helper: reset the in-module mock list to its 4-profile seed. */
export function resetMockProfiles() {
  mockProfiles = makeMockProfiles()
  notifyMock()
  return mockProfiles.map((p) => ({ ...p }))
}

// --- pure helpers (see admin-api.test.mjs) ------------------------------

/**
 * Pending-approval profiles first (they need action), each group then
 * alphabetical by full_name. Pure — no I/O, safe to unit test head-on and
 * safe to import without ever touching ./supa.js.
 */
export function sortProfilesPendingFirst(profiles) {
  return [...profiles].sort((a, b) => {
    if (a.approved !== b.approved) return a.approved ? 1 : -1
    return (a.full_name || '').localeCompare(b.full_name || '')
  })
}

// --- reads ---------------------------------------------------------------

/**
 * All profiles. Admin-only in practice: under Supabase, `profiles_select_admin`
 * only returns every row to a caller whose own `app_role()` is 'admin' —
 * anyone else gets just their own row back via `profiles_select_own` (RLS
 * silently narrows the result set rather than erroring, since AdminPanel's
 * own gate is what keeps non-admins from calling this in the first place).
 */
export async function fetchProfiles() {
  const { hasSupabase, supabase } = await backend()
  if (!hasSupabase()) {
    return mockProfiles.map((p) => ({ ...p }))
  }
  const { data, error } = await supabase.from('profiles').select('id, full_name, role, approved, created_at')
  if (error) fail(error, 'Could not load accounts.')
  return (data ?? []).map(mapProfileRow)
}

// --- writes ----------------------------------------------------------------

/**
 * Change a profile's role. Returns the updated row on success. Throws a
 * readable Error on failure — e.g. RLS/`guard_profile_privileges_trigger`
 * rejecting a non-admin caller — never a silent no-op.
 */
export async function setRole(id, role) {
  const { hasSupabase, supabase } = await backend()
  if (!hasSupabase()) {
    if (!mockProfiles.some((p) => p.id === id)) throw new Error('Account not found.')
    mockProfiles = mockProfiles.map((p) => (p.id === id ? { ...p, role } : p))
    notifyMock()
    return { ...mockProfiles.find((p) => p.id === id) }
  }
  const { data, error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', id)
    .select('id, full_name, role, approved, created_at')
    .single()
  if (error) fail(error, 'Could not change role.')
  return mapProfileRow(data)
}

/** Approve/revoke a profile. Same return/failure contract as setRole(). */
export async function setApproved(id, approved) {
  const { hasSupabase, supabase } = await backend()
  if (!hasSupabase()) {
    if (!mockProfiles.some((p) => p.id === id)) throw new Error('Account not found.')
    mockProfiles = mockProfiles.map((p) => (p.id === id ? { ...p, approved } : p))
    notifyMock()
    return { ...mockProfiles.find((p) => p.id === id) }
  }
  const { data, error } = await supabase
    .from('profiles')
    .update({ approved })
    .eq('id', id)
    .select('id, full_name, role, approved, created_at')
    .single()
  if (error) fail(error, 'Could not change approval.')
  return mapProfileRow(data)
}
