/**
 * Wraps a piece of the app behind - or merely alongside - auth.
 *
 * THE RULE (playbook/01-rubric.md, "does it work"): a judge who has to
 * make an account to see the demo scores it lower. Default to `optional`
 * or `demo`. Reach for `required` only when the feature is genuinely
 * per-user, and even then it's one real sign-in flow away from a judge who
 * gives up - see README.md before you flip this on for the whole app.
 *
 *   optional (default) - content ALWAYS renders, signed in or not. A small
 *                         bar offers "Sign in" (click reveals SignIn.jsx
 *                         inline) when signed out, or identity + sign out
 *                         when signed in. Nothing is ever blocked.
 *   demo                - content is replaced by one button, "Continue as
 *                         demo user", until there is a session. No email,
 *                         one tap. Use this when the feature needs *a*
 *                         user (so per-user data has somewhere to live)
 *                         but must not cost a judge more than a click.
 *   required             - content is replaced by the real SignIn.jsx
 *                         (email + magic link) until there is a session.
 *                         The one mode the rubric explicitly penalises if
 *                         it sits in front of the demo - see README.md.
 *
 * All three show the signed-in identity + a sign-out control once there
 * is a session; that part doesn't depend on mode.
 */
import { useEffect, useState } from 'react'
import { auth } from './auth.js'
import SignIn from './SignIn.jsx'

export default function AuthGate({ mode = 'optional', children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [showSignIn, setShowSignIn] = useState(false)

  useEffect(() => {
    const unsubscribe = auth.subscribe((u) => {
      setUser(u)
      setReady(true)
    })
    return unsubscribe
  }, [])

  async function continueAsDemo() {
    setBusy(true)
    setError(null)
    const { error: err } = await auth.signIn()
    if (err) setError(err.message)
    setBusy(false)
  }

  async function signOut() {
    setBusy(true)
    await auth.signOut()
    setShowSignIn(false)
    setBusy(false)
  }

  if (!ready) {
    return <div className="h-12 animate-pulse rounded-card bg-ink-100 dark:bg-ink-700/30" aria-busy="true"></div>
  }

  if (user) {
    return (
      <>
        <div className="mb-4 flex items-center justify-between gap-3 rounded-card bg-white px-4 py-2 text-sm shadow-sm dark:bg-ink-900/40">
          <span className="truncate text-ink-700 dark:text-ink-300">
            Signed in as <strong className="font-medium">{user.email}</strong>
            {user.isDemo && <span className="text-ink-500"> (demo)</span>}
          </span>
          <button
            className="shrink-0 text-accent underline disabled:opacity-40"
            onClick={signOut}
            disabled={busy}
          >
            Sign out
          </button>
        </div>
        {children}
      </>
    )
  }

  if (mode === 'required') {
    return <SignIn prompt="Sign in to continue." />
  }

  if (mode === 'demo') {
    return (
      <div className="rounded-card border border-dashed border-ink-300/70 px-6 py-8 text-center">
        <p className="text-ink-500">Sign in to continue - no email required for this demo.</p>
        <button
          className="mt-3 rounded-xl bg-accent px-5 py-3 font-medium text-white disabled:opacity-40"
          onClick={continueAsDemo}
          disabled={busy}
        >
          {busy ? 'Signing in…' : 'Continue as demo user'}
        </button>

        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-danger/10 px-4 py-3 text-left text-sm text-danger">
            <span className="flex-1">{error}</span>
            <button className="underline" onClick={() => setError(null)}>dismiss</button>
          </p>
        )}
      </div>
    )
  }

  // optional: never block.
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3 rounded-card bg-white px-4 py-2 text-sm shadow-sm dark:bg-ink-900/40">
        <span className="text-ink-500">Not signed in - your data stays in this browser.</span>
        <button className="shrink-0 text-accent underline" onClick={() => setShowSignIn(!showSignIn)}>
          {showSignIn ? 'Cancel' : 'Sign in'}
        </button>
      </div>
      {showSignIn && (
        <div className="mb-4">
          <SignIn prompt="Sign in (optional)." />
        </div>
      )}
      {children}
    </>
  )
}
