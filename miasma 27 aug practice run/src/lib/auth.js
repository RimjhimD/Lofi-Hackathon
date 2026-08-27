/**
 * Session + profile layer for Relief Lens v2.
 *
 * ⚠️ CLIENT-SIDE GATING IS UX ONLY, NOT SECURITY. Every check in `can()`
 * below exists to hide a button/tab a user shouldn't see — it is NOT the
 * access boundary. The real wall is Postgres row-level security (RLS) on
 * shelters / shelter_needs / updates / consignments / profiles, driven by
 * the `public.app_role()` / `public.is_approved()` helpers. A disapproved
 * user (or an attacker who deletes this file from devtools and calls the
 * Supabase REST API directly) still gets rejected by RLS. Never ship a
 * mutation whose only protection is `can()` returning false client-side —
 * the matching INSERT/UPDATE/DELETE policy must exist too.
 *
 * Three roles (`user_role` enum): 'admin' | 'commissioner' | 'volunteer'.
 * New signups land as { role: 'volunteer', approved: false } via a trigger
 * on auth.users — an unapproved user sees nothing beyond the public shelter
 * map until an admin approves them.
 *
 * When `hasSupabase()` is false (no env vars — local dev), there is no real
 * auth backend to talk to: `getSession`/`fetchMyProfile` resolve to `null`
 * and `onAuthChange` fires once with `null`. `api.js`'s localStorage
 * fallback has no RLS to emulate, so treat "no session" in local mode as
 * "single local demo user, full access" rather than "logged out."
 */
import { supabase, hasSupabase } from './supa.js'

/** Current session, or null (Supabase not configured, or signed out). */
export async function getSession() {
  if (!hasSupabase()) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(error.message)
  return data.session ?? null
}

/**
 * Fires `cb(session | null)` once immediately with the current session, then
 * again on every sign-in / sign-out / token refresh. Returns an unsubscribe
 * function — call it from an effect cleanup so listeners don't pile up.
 */
export function onAuthChange(cb) {
  if (!hasSupabase()) {
    cb(null)
    return () => {}
  }

  let cancelled = false
  supabase.auth.getSession().then(({ data }) => {
    if (!cancelled) cb(data.session ?? null)
  })

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session ?? null)
  })

  return () => {
    cancelled = true
    subscription.unsubscribe()
  }
}

/** Email + password sign-in. Throws with a readable message on failure. */
export async function signInWithPassword(email, password) {
  if (!hasSupabase()) {
    throw new Error('Supabase is not configured — the app is running in local demo mode.')
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
  return data.session
}

/** Signs the current user out. No-op (never throws) when not configured. */
export async function signOut() {
  if (!hasSupabase()) return
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(error.message)
}

/**
 * The signed-in user's own `profiles` row, or `null` when signed out / not
 * configured. RLS already scopes a non-admin caller to "own row only," so
 * this is safe to call without a role check — it simply returns null if
 * there is no session to look up.
 */
export async function fetchMyProfile() {
  if (!hasSupabase()) return null

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw new Error(sessionError.message)
  const user = sessionData.session?.user
  if (!user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, approved')
    .eq('id', user.id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ?? null
}

const STAFF_ROLES = new Set(['volunteer', 'commissioner', 'admin'])
const IMPORT_ROLES = new Set(['commissioner', 'admin'])

/**
 * Client-side permission helper — see the module doc's security warning.
 * `profile` is whatever `fetchMyProfile()` resolved to (or `null` signed
 * out / unapproved-with-no-row-yet). Mirrors the three-tier access model:
 *
 *   - 'viewMap'                          -> always true (public tier)
 *   - 'viewShortage' | 'submitUpdate'    -> approved volunteer/commissioner/admin
 *   - 'importConsignments'               -> approved commissioner/admin
 *   - 'manageAccounts'                   -> admin
 */
export function can(profile, action) {
  switch (action) {
    case 'viewMap':
      return true
    case 'viewShortage':
    case 'submitUpdate':
      return Boolean(profile?.approved && STAFF_ROLES.has(profile.role))
    case 'importConsignments':
      return Boolean(profile?.approved && IMPORT_ROLES.has(profile.role))
    case 'manageAccounts':
      return profile?.role === 'admin'
    default:
      return false
  }
}
