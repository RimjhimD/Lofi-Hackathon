/**
 * LLM client.
 *
 * WHY THIS EXISTS
 * "Summarise this", "classify this", "extract the fields" is the demo that
 * wins hackathons and the demo that dies on stage the moment a provider
 * 429s, times out, or hands back a response shaped nothing like you tested
 * against. This module is the one place that talks to a model, so it is
 * the one place that has to survive all of that without taking the app
 * down with it.
 *
 * Three backends, picked automatically by which key is present - same
 * trick as ../../lib/db.js and ../auth/auth.js:
 *
 *   - no VITE_*_API_KEY set          -> MOCK mode. Returns a plausible
 *                                        canned response after a short
 *                                        delay. No network, no key, works
 *                                        the instant you copy this folder
 *                                        in. Build and demo the whole UI
 *                                        against this before any key exists
 *                                        - that is the point.
 *   - VITE_ANTHROPIC_API_KEY set     -> Anthropic (Claude), checked first.
 *   - VITE_GOOGLE_API_KEY set        -> Google (Gemini), if no Anthropic
 *                                        key is present.
 *
 * Same call site either way: complete({ system, prompt, schema }).
 * Always resolves to { data, error }. Never throws - a rate limit, a
 * dropped connection, or a malformed body from the provider should produce
 * a message on screen, not a crash. See README.md's Security section
 * before you put a real key anywhere near a browser build.
 */

const env = import.meta.env ?? {}

const ANTHROPIC_KEY = env.VITE_ANTHROPIC_API_KEY
// Exact ID, no date suffix and no `-latest` - see README gotcha #3.
const ANTHROPIC_MODEL = env.VITE_ANTHROPIC_MODEL || 'claude-haiku-4-5'
const GOOGLE_KEY = env.VITE_GOOGLE_API_KEY
const GOOGLE_MODEL = env.VITE_GOOGLE_MODEL || 'gemini-2.0-flash'

const DEFAULT_TIMEOUT_MS = 30000
const MOCK_DELAY_MS = 700

export const backend = ANTHROPIC_KEY ? 'anthropic' : GOOGLE_KEY ? 'google' : 'mock'

// --- shared plumbing ---------------------------------------------------------

/**
 * fetch() with a timeout AND a caller-supplied AbortSignal, distinguishing
 * the two on the way out so error handling can tell "the provider was too
 * slow" from "the user clicked Stop". Both end up as an AbortError from
 * fetch()'s point of view; only this wrapper knows which timer fired.
 */
async function fetchWithTimeout(url, options, timeoutMs, externalSignal) {
  const controller = new AbortController()
  let timedOut = false
  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    externalSignal.addEventListener('abort', onExternalAbort)
  }
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err?.name === 'AbortError') {
      const wrapped = new Error(timedOut ? 'Request timed out.' : 'Cancelled.')
      wrapped.name = timedOut ? 'TimeoutError' : 'AbortError'
      throw wrapped
    }
    throw err
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

/** Turns a thrown fetch/abort error into the { message, kind } shape. */
function classifyFetchError(err) {
  if (err?.name === 'TimeoutError') {
    return { message: 'The request timed out. The provider took too long to respond.', kind: 'timeout' }
  }
  if (err?.name === 'AbortError') {
    return { message: 'Cancelled.', kind: 'cancelled' }
  }
  return { message: err?.message || 'Network request failed. Check your connection.', kind: 'network' }
}

async function safeReadText(res) {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

async function safeParseJson(res) {
  try {
    return await res.json()
  } catch {
    return undefined
  }
}

function schemaPromptSuffix(schema) {
  return (
    '\n\nRespond with ONLY valid JSON - no prose, no commentary, no markdown ' +
    `code fences. The JSON must match this schema exactly:\n${JSON.stringify(schema)}`
  )
}

// --- mock backend -------------------------------------------------------------

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(makeAbortError())
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(makeAbortError())
      },
      { once: true },
    )
  })
}

function makeAbortError() {
  const err = new Error('Cancelled.')
  err.name = 'AbortError'
  return err
}

/** Fabricates a value that satisfies a (small, JSON-Schema-shaped) schema. */
function mockValueForSchema(schema) {
  if (!schema || typeof schema !== 'object') return null
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]
  switch (schema.type) {
    case 'string':
      return typeof schema.example === 'string' ? schema.example : 'Sample text from mock mode.'
    case 'number':
    case 'integer':
      return 42
    case 'boolean':
      return true
    case 'array':
      return [schema.items ? mockValueForSchema(schema.items) : 'sample']
    case 'object': {
      const out = {}
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        out[key] = mockValueForSchema(sub)
      }
      return out
    }
    default:
      return null
  }
}

function mockCannedText(prompt) {
  const topic = prompt.trim().slice(0, 80)
  const truncated = prompt.trim().length > 80 ? '…' : ''
  return (
    'This is a mock response (no VITE_ANTHROPIC_API_KEY or VITE_GOOGLE_API_KEY ' +
    `is set). With a real key this would be a real completion for: "${topic}${truncated}"`
  )
}

async function mockComplete({ prompt, schema, signal }) {
  try {
    await delay(MOCK_DELAY_MS, signal)
  } catch (err) {
    return { data: null, error: classifyFetchError(err) }
  }
  const text = schema ? JSON.stringify(mockValueForSchema(schema)) : mockCannedText(prompt)
  return { data: { text }, error: null }
}

// --- anthropic backend --------------------------------------------------------

async function anthropicComplete({ system, prompt, schema, signal, timeoutMs }) {
  let res
  try {
    res = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          // Lets this run as a direct browser fetch for the demo. It does
          // NOT make putting a real key here safe - see README.md.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 1024,
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: prompt }],
          // Native structured output (GA, no beta header needed as of the
          // current Claude API docs - docs.claude.com/.../structured-outputs).
          // Constrains the response server-side instead of only hoping the
          // model followed a text instruction. Still returned as a normal
          // text content block, parsed the same way below - and extract.js's
          // parse-and-validate-and-retry loop still runs on top of this as
          // the safety net, for this provider and every other one.
          ...(schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
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
  if (!res.ok) {
    const body = await safeReadText(res)
    const kind = res.status === 401 || res.status === 403 ? 'auth' : 'unknown'
    return { data: null, error: { message: `Anthropic API error (${res.status}): ${body.slice(0, 200) || res.statusText}`, kind } }
  }

  const json = await safeParseJson(res)
  const text = json?.content?.find?.((block) => block?.type === 'text')?.text
  if (typeof text !== 'string') {
    return { data: null, error: { message: 'Anthropic returned a response in an unexpected shape.', kind: 'malformed' } }
  }
  return { data: { text }, error: null }
}

// --- google (gemini) backend --------------------------------------------------

async function googleComplete({ system, prompt, signal, timeoutMs }) {
  let res
  try {
    res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:generateContent?key=${GOOGLE_KEY}`,
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
  if (!res.ok) {
    const body = await safeReadText(res)
    const kind = res.status === 401 || res.status === 403 ? 'auth' : 'unknown'
    return { data: null, error: { message: `Gemini API error (${res.status}): ${body.slice(0, 200) || res.statusText}`, kind } }
  }

  const json = await safeParseJson(res)
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p?.text ?? '').join('')
  if (typeof text !== 'string' || text === '') {
    return { data: null, error: { message: 'Gemini returned a response in an unexpected shape.', kind: 'malformed' } }
  }
  return { data: { text }, error: null }
}

// --- public API ----------------------------------------------------------------

/**
 * One completion. Optionally pass `schema` (a small JSON-Schema-shaped
 * object - `{ type, properties, required, items, enum }`) to ask the model
 * for structured JSON; this only shapes the prompt, it does not parse or
 * validate the response - that is extract.js's job, on purpose, because
 * this module must never assume the model actually followed instructions.
 *
 * @param {{ system?: string, prompt: string, schema?: object, signal?: AbortSignal, timeoutMs?: number }} opts
 * @returns {Promise<{ data: { text: string } | null, error: { message: string, kind: string } | null }>}
 */
export async function complete({ system, prompt, schema, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return { data: null, error: { message: 'prompt is required.', kind: 'invalid_input' } }
  }

  // Anthropic enforces the schema server-side via output_config (see
  // anthropicComplete) - the textual "respond with only JSON matching this
  // shape" instruction is redundant there and only needed for backends
  // with no native equivalent.
  const needsPromptSchemaHint = schema && backend !== 'anthropic'
  const fullSystem = needsPromptSchemaHint ? `${system ?? ''}${schemaPromptSuffix(schema)}` : system

  try {
    if (backend === 'mock') return await mockComplete({ prompt, schema, signal })
    if (backend === 'anthropic') return await anthropicComplete({ system: fullSystem, prompt, schema, signal, timeoutMs })
    return await googleComplete({ system: fullSystem, prompt, signal, timeoutMs })
  } catch (err) {
    // Every branch above already catches its own errors - this is belt and
    // suspenders so a bug here still can't throw out of this module.
    return { data: null, error: { message: err?.message ?? 'Unexpected error talking to the model.', kind: 'unknown' } }
  }
}

/**
 * Not part of the public API - exported so stream.js (same recipe folder)
 * can reuse the timeout/error/key plumbing instead of duplicating it.
 * Everything in here is already reachable from the built bundle via
 * import.meta.env regardless of what is or isn't exported - see README.md.
 */
export const _internal = {
  anthropicKey: ANTHROPIC_KEY,
  anthropicModel: ANTHROPIC_MODEL,
  googleKey: GOOGLE_KEY,
  googleModel: GOOGLE_MODEL,
  fetchWithTimeout,
  classifyFetchError,
  safeReadText,
}
