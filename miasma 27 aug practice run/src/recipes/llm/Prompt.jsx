/**
 * Input + streaming output panel for llm.js / stream.js.
 *
 * States shipped: empty (nothing asked yet), loading (streaming in),
 * error (banner, dismissible, never blocking), and a standing "no key
 * configured, running in mock mode" notice - see ../auth/AuthGate.jsx
 * for the same pattern applied to sign-in. Plus a Stop control, because a
 * streaming request with nothing to cancel it is not really cancellable.
 */
import { useState } from 'react'
import { backend } from './llm.js'
import { streamComplete } from './stream.js'

export default function Prompt({ system = 'You are a concise, helpful assistant.', placeholder = 'Ask something…' }) {
  const [prompt, setPrompt] = useState('')
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [cancel, setCancel] = useState(null)

  const canSubmit = prompt.trim().length > 0 && !busy

  async function run() {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    setOutput('')

    const stream = streamComplete({
      system,
      prompt: text,
      onChunk: (_delta, full) => {
        setOutput(full)
      },
    })
    setCancel(() => stream.cancel)

    const { data, error: err } = await stream.done
    if (data?.text) setOutput(data.text)
    // A user-initiated Stop is not a failure worth a red banner - the
    // partial output it left behind already shows what happened.
    if (err && err.kind !== 'cancelled') setError(err.message)
    setBusy(false)
    setCancel(null)
  }

  function stop() {
    cancel?.()
  }

  return (
    <section className="mx-auto w-full max-w-xl px-4 pb-24">
      {backend === 'mock' && (
        <p className="mb-3 rounded-xl bg-accent-soft px-4 py-3 text-sm text-ink-700 dark:text-ink-300">
          No provider key configured — running in <strong>mock mode</strong>.
          Set <code>VITE_ANTHROPIC_API_KEY</code> or <code>VITE_GOOGLE_API_KEY</code>
          in <code>.env</code> for real completions. Read this recipe's README
          before a key goes anywhere near a browser build.
        </p>
      )}

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          run()
        }}
      >
        <textarea
          className="min-w-0 flex-1 resize-none rounded-xl border border-ink-300/60 bg-white/80 px-4 py-3 text-base
             placeholder:text-ink-500 focus:border-accent dark:bg-ink-900/40"
          rows="3"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={placeholder}
          aria-label="Prompt"
          disabled={busy}
        ></textarea>

        <div className="flex gap-2">
          <button
            className="rounded-xl bg-accent px-5 py-3 font-medium text-white disabled:opacity-40"
            type="submit"
            disabled={!canSubmit}
          >
            {busy ? 'Generating…' : 'Send'}
          </button>

          {busy && (
            <button
              className="rounded-xl border border-ink-300/60 px-5 py-3 font-medium text-ink-700 dark:text-ink-300"
              type="button"
              onClick={stop}
            >
              Stop
            </button>
          )}
        </div>
      </form>

      {error && (
        // One banner, dismissible, non-blocking. Never an alert().
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          <span className="flex-1">{error}</span>
          <button className="underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </p>
      )}

      {busy && !output ? (
        <div className="mt-6 space-y-2" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-ink-100 dark:bg-ink-700/30"></div>
          ))}
        </div>
      ) : output ? (
        <div className="mt-6 whitespace-pre-wrap rounded-card bg-white px-4 py-3 text-sm shadow-sm dark:bg-ink-900/40">
          {output}
        </div>
      ) : (
        !error && (
          // Empty state does a job: it explains what to do next.
          <div className="mt-10 rounded-card border border-dashed border-ink-300/70 px-6 py-10 text-center">
            <p className="text-ink-500">Nothing here yet. Ask something above.</p>
          </div>
        )
      )}
    </section>
  )
}
