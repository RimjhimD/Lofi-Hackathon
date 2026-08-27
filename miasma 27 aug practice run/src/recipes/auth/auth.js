/**
 * Auth adapter.
 *
 * WHY THIS EXISTS
 * The rubric (playbook/01-rubric.md, "does it work") says it in plain words:
 * "Signup wall in front of the demo... loses [the criterion]. If a judge must
 * create an account, put a seeded demo login on the landing page in plain
 * text, or make the core loop work logged out." This module makes the second
 * option the path of least resistance.
 *
 * Two backends, picked automatically - same trick as ../../lib/db.js:
 *
 *   - no VITE_SUPABASE_URL set  -> LOCAL demo mode. A fake session lives in
 *                                  localStorage. Signing in is instant - no
 *                                  email ever leaves the browser - so there
 *                                  is no round trip to explain to a judge.
 *   - VITE_SUPABASE_URL set     -> Supabase magic-link (OTP) auth. Real
 *                                  email, real session, survives a phone
 *                                  handed to a judge.
 *
 * Same call sites either way: signIn, signOut, currentUser, subscribe.
 * signIn/signOut/currentUser return { data, error } and never throw - a
 * flaky mail provider or a typo'd address should produce a message, not a
 * crash. subscribe is the one exception: it returns a plain unsubscribe
 * function (there is nothing async to fail on setup), documented at its call
 * site below.
 *
 * DEMO IDENTITY, TWO WAYS
 *   auth.signIn()      - no email -> the "continue as demo user" path. Local
 *                         backend: instant fake session. Supabase backend:
 *                         a real anonymous session (sb.auth.signInAnonymously),
 *                         so per-user / RLS-gated data still works for a judge
 *                         who never typed an email. Requires "Allow anonymous
 *                         sign-ins" to be ON in the Supabase dashboard - see
 *                         README.md.
 *   auth.signIn(email) - the real flow. Local backend: still instant (there
 *                         is no mail server to round-trip to), the address is
 *                         only used as a display label. Supabase backend:
 *                         sends an actual magic link.
 */

// `import.meta.env` is a Vite-ism - always present when this runs in the app,
// but plain `node --test` (used by auth.test.mjs) has no bundler rewriting
// it, so `import.meta.env` alone is `undefined` there. Guard once here rather
// than special-casing every call site, exactly the same value either way.
const env = import.meta.env ?? {}
const url = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY

export const backend = url && anonKey ? 'supabase' : 'local'

let client = null
async function supabase() {
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js')
    client = createClient(url, anonKey)
  }
  return client
}

// --- pure helpers (no localStorage, no network - safe under plain node) ----

/** Good enough to catch a typo without rejecting a real address. */
export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/** True when a Supabase auth error is "slow down", not "it's broken". */
export function isRateLimitError(error) {
  if (!error) return false
  if (error.status === 429) return true
  return /rate.?limit/i.test(error.message ?? '')
}

function makeDemoUser(email) {
  const trimmed = typeof email === 'string' ? email.trim() : ''
  return { id: 'demo-user', email: trimmed || 'demo@localhost', isDemo: true }
}

function makeSession(user) {
  return { user, created_at: new Date().toISOString() }
}

// --- localStorage backend ---------------------------------------------------

const LOCAL_KEY = 'hack:auth:session'

function readLocalSession() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null')
  } catch {
    // Corrupt storage should sign the user out quietly, not white-screen.
    return null
  }
}

function writeLocalSession(session) {
  if (session) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(session))
  } else {
    localStorage.removeItem(LOCAL_KEY)
  }
}

// In-tab listeners. Cross-tab sync rides the browser's native `storage`
// event, wired up per-listener in subscribe() below.
const localListeners = new Set()
function notifyLocal(session) {
  for (const cb of localListeners) cb(session)
}

// --- public API --------------------------------------------------------------

export const auth = {
  /** @see module doc "DEMO IDENTITY, TWO WAYS" */
  async signIn(email) {
    if (backend === 'local') {
      const session = makeSession(makeDemoUser(email))
      writeLocalSession(session)
      notifyLocal(session)
      return { data: { session }, error: null }
    }

    // Supabase backend, no email -> anonymous "continue as demo user".
    if (email === undefined || email === null || email.trim() === '') {
      try {
        const sb = await supabase()
        const { data, error } = await sb.auth.signInAnonymously()
        if (error) return { data: null, error: { message: error.message, status: error.status } }
        return { data: { session: data.session }, error: null }
      } catch (err) {
        return { data: null, error: { message: err?.message ?? 'Could not start a demo session.' } }
      }
    }

    // Supabase backend, real email -> magic link.
    if (!isValidEmail(email)) {
      return { data: null, error: { message: 'Enter a valid email address.' } }
    }
    try {
      const sb = await supabase()
      const { error } = await sb.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) return { data: null, error: { message: error.message, status: error.status } }
      // Link sent, not signed in yet - the session lands after the redirect.
      return { data: { session: null }, error: null }
    } catch (err) {
      return { data: null, error: { message: err?.message ?? 'Could not send the link. Try again.' } }
    }
  },

  async signOut() {
    if (backend === 'local') {
      writeLocalSession(null)
      notifyLocal(null)
      return { data: null, error: null }
    }
    try {
      const sb = await supabase()
      const { error } = await sb.auth.signOut()
      return { data: null, error: error ? { message: error.message } : null }
    } catch (err) {
      return { data: null, error: { message: err?.message ?? 'Sign out failed.' } }
    }
  },

  /** Current user, or null. Never throws. */
  async currentUser() {
    if (backend === 'local') {
      return { data: { user: readLocalSession()?.user ?? null }, error: null }
    }
    try {
      const sb = await supabase()
      const { data, error } = await sb.auth.getSession()
      if (error) return { data: { user: null }, error: { message: error.message } }
      return { data: { user: data.session?.user ?? null }, error: null }
    } catch (err) {
      return { data: { user: null }, error: { message: err?.message ?? 'Could not read session.' } }
    }
  },

  /**
   * Fires callback(user | null) once immediately with the current state, then
   * again on every sign-in/out. Returns a plain unsubscribe function - call
   * it from an `$effect` cleanup so listeners don't pile up.
   *
   * The one method on this object that does not return { data, error }:
   * there is nothing async to fail during setup, and forcing a promise here
   * would just make every call site `await` something that never rejects.
   */
  subscribe(callback) {
    if (backend === 'local') {
      const wrapped = (session) => callback(session?.user ?? null)
      localListeners.add(wrapped)
      wrapped(readLocalSession())

      // Cross-tab: a sign-in/out in another tab should update this one too.
      const onStorage = (e) => {
        if (e.key === LOCAL_KEY) wrapped(readLocalSession())
      }
      window.addEventListener('storage', onStorage)

      return () => {
        localListeners.delete(wrapped)
        window.removeEventListener('storage', onStorage)
      }
    }

    let subscription = null
    let cancelled = false
    supabase().then((sb) => {
      if (cancelled) return
      const { data } = sb.auth.onAuthStateChange((_event, session) => {
        callback(session?.user ?? null)
      })
      subscription = data.subscription
    })
    return () => {
      cancelled = true
      subscription?.unsubscribe()
    }
  },
}
