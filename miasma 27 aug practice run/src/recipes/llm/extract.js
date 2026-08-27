/**
 * Structured extraction - the pattern that actually wins hackathons.
 *
 * WHY THIS EXISTS
 * "Ask the model for JSON" is not the hard part. The hard part is that a
 * model under load, or a smaller/cheaper one, hands back JSON missing a
 * field, wrapped in a markdown fence, or not JSON at all - and code that
 * trusts the shape blind will crash three screens away from where the bad
 * data came in. This module asks for structured output against a schema,
 * checks what actually came back before touching it, and - because the
 * single most effective fix for a model that almost got it right is simply
 * telling it what was wrong - retries exactly once with the validation
 * error fed back into the prompt.
 *
 * extract() never throws and never returns unvalidated data: `data` either
 * fully conforms to `schema`, or it is null and `error` says why.
 *
 * When the backend is Anthropic, llm.js already asks the model to conform
 * server-side (native structured output via `output_config`) - see
 * llm.js's `anthropicComplete`. That makes a bad response far less likely
 * for that one provider, but it does not change anything here: this module
 * still parses and validates every response itself and still retries once
 * on failure, for every provider, because "the provider claims to
 * guarantee it" is not the same as "this code checked."
 *
 * SCHEMA FORMAT - deliberately small, not full JSON Schema:
 *   { type: 'object' | 'string' | 'number' | 'boolean' | 'array',
 *     properties: { key: <schema> },   // for type: 'object'
 *     required: ['key', ...],          // for type: 'object'
 *     items: <schema>,                 // for type: 'array'
 *     enum: [...] }                    // any type
 * Enough to describe "an object with these required fields, these types,
 * maybe a nested array or enum" - which covers the summarise/classify/
 * extract shapes this recipe exists for - without pulling in a validation
 * library.
 */
import { complete as defaultComplete } from './llm.js'

const MAX_ATTEMPTS = 2 // one try + one retry with the error fed back in

/**
 * @param {{ system?: string, prompt: string, schema: object, complete?: Function }} opts
 *   `complete` defaults to llm.js's client and is only a parameter so tests
 *   can stub the transport - real call sites never need to pass it.
 * @returns {Promise<{ data: object | null, error: { message: string, kind: string } | null }>}
 */
export async function extract({ system, prompt, schema, complete = defaultComplete } = {}) {
  if (!schema || typeof schema !== 'object') {
    return { data: null, error: { message: 'extract() requires a schema.', kind: 'invalid_input' } }
  }
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return { data: null, error: { message: 'prompt is required.', kind: 'invalid_input' } }
  }

  const baseSystem =
    'You are a precise data-extraction engine. Respond with only the JSON requested - no prose, no commentary, no markdown code fences.'
  const effectiveSystem = system ? `${baseSystem}\n\n${system}` : baseSystem

  let attemptPrompt = prompt
  let lastError = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data, error } = await complete({ system: effectiveSystem, prompt: attemptPrompt, schema })

    if (error) {
      // Transport-level failure (rate limit, timeout, network, malformed
      // body) - rewording the prompt won't fix this, so retry unchanged
      // and hope it was a one-off provider hiccup.
      lastError = error
      continue
    }

    const parsed = tryParseJson(data?.text)
    if (parsed.error) {
      lastError = { message: `Model response was not valid JSON: ${parsed.error}`, kind: 'malformed' }
      attemptPrompt = withValidationFeedback(prompt, lastError.message, data?.text ?? '')
      continue
    }

    const validation = validate(parsed.value, schema)
    if (!validation.valid) {
      lastError = { message: `Response did not match the schema - ${validation.reason}`, kind: 'schema_mismatch' }
      attemptPrompt = withValidationFeedback(prompt, validation.reason, data?.text ?? '')
      continue
    }

    return { data: parsed.value, error: null }
  }

  return { data: null, error: lastError ?? { message: 'Extraction failed for an unknown reason.', kind: 'unknown' } }
}

function withValidationFeedback(originalPrompt, reason, badResponse) {
  return (
    `${originalPrompt}\n\n` +
    `Your previous response could not be used: ${reason}\n` +
    `Previous response was:\n${badResponse}\n\n` +
    'Respond again with ONLY corrected JSON matching the schema - no prose, no markdown fences.'
  )
}

/**
 * text -> parsed JSON, tolerating the two things models do despite being
 * told not to: wrapping the JSON in a ```json fence, or adding a sentence
 * before/after it. Never throws.
 */
function tryParseJson(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { error: 'response was empty or not text' }
  }

  let candidate = text.trim()
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidate = fenced[1].trim()

  try {
    return { value: JSON.parse(candidate) }
  } catch (firstErr) {
    // Salvage: slice from the first { or [ to the last } or ], in case the
    // model added a sentence around otherwise-valid JSON.
    const start = candidate.search(/[{[]/)
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
    if (start !== -1 && end > start) {
      try {
        return { value: JSON.parse(candidate.slice(start, end + 1)) }
      } catch (secondErr) {
        return { error: secondErr.message }
      }
    }
    return { error: firstErr.message }
  }
}

/** Minimal structural validator for the schema format documented above. */
function validate(value, schema, path = '$') {
  if (schema.type && !matchesType(value, schema.type)) {
    return { valid: false, reason: `${path}: expected ${schema.type}, got ${describeType(value)}` }
  }

  if (schema.type === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) return { valid: false, reason: `${path}: missing required field "${key}"` }
    }
    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) {
        const result = validate(value[key], subSchema, `${path}.${key}`)
        if (!result.valid) return result
      }
    }
  }

  if (schema.type === 'array' && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const result = validate(value[i], schema.items, `${path}[${i}]`)
      if (!result.valid) return result
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return { valid: false, reason: `${path}: expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}` }
  }

  return { valid: true }
}

function matchesType(value, type) {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    default:
      return true
  }
}

function describeType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
