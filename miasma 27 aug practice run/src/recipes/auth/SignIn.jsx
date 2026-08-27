/**
 * Email + magic link. Three states: form -> sent -> (link clicked, handled
 * by Supabase's redirect, not by this component).
 *
 * On the LOCAL backend there is no mail server, so `auth.signIn(email)`
 * resolves with a session immediately - the "sent" state below is simply
 * never reached in that mode. Nothing here needs to branch on `backend` to
 * get that right; it falls out of auth.js always returning
 * `{ data: { session } }` and this component reacting to whether
 * `session` came back populated.
 */
import { useState } from 'react'
import { auth, isValidEmail, isRateLimitError } from './auth.js'

export default function SignIn({ prompt = 'Sign in to continue.' }) {
  const [email, setEmail] = useState('')
  const [stage, setStage] = useState('form') // 'form' | 'sending' | 'sent'
  const [error, setError] = useState(null)
  const [sentTo, setSentTo] = useState('')

  async function submit() {
    const trimmed = email.trim()
    if (!isValidEmail(trimmed)) {
      setError('Enter a valid email address.')
      return
    }
    setError(null)
    setStage('sending')

    const { data, error: err } = await auth.signIn(trimmed)

    if (err) {
      setStage('form')
      setError(
        isRateLimitError(err)
          ? 'Too many attempts - wait a minute before trying again.'
          : err.message
      )
      return
    }

    if (data.session) {
      // Local backend (or an already-active Supabase session): signed in,
      // nothing further to do. Whatever wraps this component (e.g.
      // AuthGate) is watching auth.subscribe() and will swap this away.
      setStage('form')
      setEmail('')
      return
    }

    // Supabase backend: link sent, not signed in yet.
    setSentTo(trimmed)
    setStage('sent')
  }

  function useDifferentEmail() {
    setStage('form')
    setError(null)
    setEmail(sentTo)
  }

  async function resend() {
    setError(null)
    setStage('sending')
    const { error: err } = await auth.signIn(sentTo)
    if (err) {
      setError(
        isRateLimitError(err)
          ? 'Too many attempts - wait a minute before trying again.'
          : err.message
      )
    }
    setStage('sent')
  }

  return (
    <div className="rounded-card border border-ink-300/60 bg-white px-5 py-5 dark:bg-ink-900/40">
      {stage === 'sent' ? (
        <>
          <p className="font-medium">Check your email</p>
          <p className="mt-2 text-sm text-ink-500">
            We sent a link to <strong className="font-medium text-ink-700 dark:text-ink-300">{sentTo}</strong>.
            Open it in <strong>this same browser</strong> - the link signs in the tab it's opened in, so
            tapping it from a phone's mail app while testing on desktop won't complete the sign-in here.
          </p>

          {error && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
              <span className="flex-1">{error}</span>
              <button className="underline" onClick={() => setError(null)}>dismiss</button>
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <button className="text-accent underline disabled:opacity-40" onClick={resend} disabled={stage === 'sending'}>
              Resend link
            </button>
            <button className="text-ink-500 underline" onClick={useDifferentEmail}>
              Use a different email
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="font-medium">{prompt}</p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <input
              className="min-w-0 flex-1 rounded-xl border border-ink-300/60 bg-white/80 px-4 py-3 text-base
                     placeholder:text-ink-500 focus:border-accent dark:bg-ink-900/40"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Email address"
              aria-invalid={error ? 'true' : undefined}
              autoComplete="email"
              enterKeyHint="send"
            />
            <button
              className="shrink-0 rounded-xl bg-accent px-5 py-3 font-medium text-white disabled:opacity-40"
              disabled={stage === 'sending'}
            >
              {stage === 'sending' ? 'Sending…' : 'Send link'}
            </button>
          </form>

          {error && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
              <span className="flex-1">{error}</span>
              <button className="underline" onClick={() => setError(null)}>dismiss</button>
            </p>
          )}
        </>
      )}
    </div>
  )
}
