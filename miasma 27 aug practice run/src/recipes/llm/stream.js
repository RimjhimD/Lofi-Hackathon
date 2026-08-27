/**
 * Token streaming on top of llm.js.
 *
 * WHY THIS EXISTS
 * complete() in llm.js waits for the whole answer before it resolves - fine
 * for extract.js's structured JSON (you need the whole object anyway, and
 * streaming half a JSON object is useless). Bad for a chat/summarize panel,
 * where the model can take five to ten seconds and a judge watching a blank
 * box reads it as broken. This delivers text as it arrives instead.
 *
 * streamComplete() returns SYNCHRONOUSLY: { done, cancel }. A Stop button
 * needs `cancel` before the promise has anything to resolve with, so this
 * cannot be a plain async function. Await `done` for the final result, in
 * the same { data, error } shape as llm.js's complete().
 *
 *   const { done, cancel } = streamComplete({
 *     system, prompt,
 *     onChunk: (delta, full) => { output = full },
 *   })
 *   stopButton.onclick = cancel
 *   const { data, error } = await done
 *
 * Real providers (Anthropic, Google): true token streaming over
 * text/event-stream, hand-parsed - no SDK, no new dependency.
 *
 * Mock mode has nothing to stream from, so it calls llm.js's complete() and
 * delivers the whole answer as one onChunk call - "falls back cleanly to
 * non-streaming" per this module's contract. Same fallback triggers if the
 * runtime has no ReadableStream. The *content* is identical either way;
 * only the pacing differs, and pacing is invisible once a real key is set -
 * see gotcha #1 in README.md.
 *
 * A stream that dies mid-response (network drop, provider cuts the
 * connection) does not throw the accumulated text away: `done` resolves
 * with BOTH a non-null `data.text` (whatever arrived) AND a non-null
 * `error` (why it stopped). That is the one place in this recipe that
 * breaks llm.js's "either data or error, never both" rule, on purpose -
 * losing a paragraph the model already sent would be worse than the rule.
 */
import { backend, complete, _internal } from './llm.js'

const { anthropicKey, anthropicModel, googleKey, googleModel, fetchWithTimeout, classifyFetchError, safeReadText } = _internal

const DEFAULT_TIMEOUT_MS = 30000

/**
 * @param {{ system?: string, prompt: string, onChunk?: (delta: string, full: string) => void, timeoutMs?: number, signal?: AbortSignal }} opts
 * @returns {{ done: Promise<{ data: { text: string } | null, error: { message: string, kind: string } | null }>, cancel: () => void }}
 */
export function streamComplete({ system, prompt, onChunk, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  const done = runStream({ system, prompt, onChunk, timeoutMs, signal: controller.signal })
  return { done, cancel: () => controller.abort() }
}

async function runStream({ system, prompt, onChunk, timeoutMs, signal }) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return { data: null, error: { message: 'prompt is required.', kind: 'invalid_input' } }
  }

  const emit = typeof onChunk === 'function' ? onChunk : () => {}

  // Mock mode, and any environment without ReadableStream, fall back to a
  // single non-streamed delivery - see module doc.
  if (backend === 'mock' || typeof ReadableStream === 'undefined') {
    const { data, error } = await complete({ system, prompt, signal })
    if (data?.text) emit(data.text, data.text)
    return { data, error }
  }

  try {
    return backend === 'anthropic'
      ? await anthropicStream({ system, prompt, emit, timeoutMs, signal })
      : await googleStream({ system, prompt, emit, timeoutMs, signal })
  } catch (err) {
    return { data: null, error: classifyFetchError(err) }
  }
}

/**
 * Reads a text/event-stream body, splitting on the blank-line event
 * separator and handing each event's concatenated `data:` payload to
 * `onData`. Providers occasionally send non-JSON keepalive lines or
 * multi-line data blocks; both are handled by the caller's onData, not
 * here - this function only knows SSE framing, not payload semantics.
 */
async function readSSE(reader, onData) {
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sepIndex
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex)
      buffer = buffer.slice(sepIndex + 2)
      const dataLines = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
      if (dataLines.length) onData(dataLines.join('\n'))
    }
  }
}

async function anthropicStream({ system, prompt, emit, timeoutMs, signal }) {
  let res
  try {
    res = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: anthropicModel,
          max_tokens: 1024,
          stream: true,
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: prompt }],
        }),
      },
      timeoutMs,
      signal,
    )
  } catch (err) {
    return { data: null, error: classifyFetchError(err) }
  }

  if (res.status === 429) {
    return {
      data: null,
      error: { message: 'Anthropic rate-limited this request. Wait a moment and try again.', kind: 'rate_limit' },
    }
  }
  if (!res.ok || !res.body) {
    const body = await safeReadText(res)
    const kind = res.status === 401 || res.status === 403 ? 'auth' : 'unknown'
    return { data: null, error: { message: `Anthropic API error (${res.status}): ${body.slice(0, 200) || res.statusText}`, kind } }
  }

  let full = ''
  let streamError = null
  try {
    await readSSE(res.body.getReader(), (payload) => {
      let event
      try {
        event = JSON.parse(payload)
      } catch {
        return // keepalive or a line this parser doesn't need - skip it
      }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        full += event.delta.text
        emit(event.delta.text, full)
      } else if (event.type === 'error') {
        streamError = { message: event.error?.message ?? 'Anthropic stream reported an error.', kind: 'unknown' }
      }
    })
  } catch (err) {
    // Connection dropped mid-stream - keep what arrived, report the failure.
    return { data: { text: full }, error: classifyFetchError(err) }
  }

  if (streamError) return { data: { text: full }, error: streamError }
  if (!full) return { data: null, error: { message: 'Anthropic stream ended with no text.', kind: 'malformed' } }
  return { data: { text: full }, error: null }
}

async function googleStream({ system, prompt, emit, timeoutMs, signal }) {
  let res
  try {
    res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:streamGenerateContent?alt=sse&key=${googleKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        }),
      },
      timeoutMs,
      signal,
    )
  } catch (err) {
    return { data: null, error: classifyFetchError(err) }
  }

  if (res.status === 429) {
    return { data: null, error: { message: 'Gemini rate-limited this request. Wait a moment and try again.', kind: 'rate_limit' } }
  }
  if (!res.ok || !res.body) {
    const body = await safeReadText(res)
    const kind = res.status === 401 || res.status === 403 ? 'auth' : 'unknown'
    return { data: null, error: { message: `Gemini API error (${res.status}): ${body.slice(0, 200) || res.statusText}`, kind } }
  }

  let full = ''
  try {
    await readSSE(res.body.getReader(), (payload) => {
      let event
      try {
        event = JSON.parse(payload)
      } catch {
        return
      }
      const piece = event?.candidates?.[0]?.content?.parts?.map((p) => p?.text ?? '').join('') ?? ''
      if (piece) {
        full += piece
        emit(piece, full)
      }
    })
  } catch (err) {
    return { data: { text: full }, error: classifyFetchError(err) }
  }

  if (!full) return { data: null, error: { message: 'Gemini stream ended with no text.', kind: 'malformed' } }
  return { data: { text: full }, error: null }
}
