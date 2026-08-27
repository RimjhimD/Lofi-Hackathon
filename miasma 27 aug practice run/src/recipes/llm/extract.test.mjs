// Run with: node --test src/recipes/llm/extract.test.mjs
//
// extract.js's `complete` parameter is a test seam - it defaults to
// llm.js's real client, but every test here passes a stub instead, so
// nothing in this file makes a network call.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extract } from './extract.js'

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'number' },
  },
  required: ['name', 'age'],
}

function ok(text) {
  return { data: { text }, error: null }
}

test('valid response: data conforms to the schema on the first try', async () => {
  let calls = 0
  const stub = async () => {
    calls += 1
    return ok(JSON.stringify({ name: 'Ada', age: 30 }))
  }

  const { data, error } = await extract({ prompt: 'extract the person', schema: SCHEMA, complete: stub })

  assert.equal(error, null)
  assert.deepEqual(data, { name: 'Ada', age: 30 })
  assert.equal(calls, 1)
})

test('malformed JSON: reported as an error after the retry also fails', async () => {
  let calls = 0
  const stub = async () => {
    calls += 1
    return ok('this is not json, sorry')
  }

  const { data, error } = await extract({ prompt: 'extract the person', schema: SCHEMA, complete: stub })

  assert.equal(data, null)
  assert.equal(error.kind, 'malformed')
  assert.match(error.message, /not valid JSON/)
  assert.equal(calls, 2) // one try + one retry
})

test('missing required field: reported as a schema mismatch naming the field', async () => {
  let calls = 0
  const stub = async () => {
    calls += 1
    return ok(JSON.stringify({ name: 'Ada' })) // age missing, every attempt
  }

  const { data, error } = await extract({ prompt: 'extract the person', schema: SCHEMA, complete: stub })

  assert.equal(data, null)
  assert.equal(error.kind, 'schema_mismatch')
  assert.match(error.message, /age/)
  assert.equal(calls, 2)
})

test('retry path: succeeds on the second attempt, with the validation error fed back in', async () => {
  let calls = 0
  const promptsSeen = []
  const stub = async ({ prompt }) => {
    calls += 1
    promptsSeen.push(prompt)
    if (calls === 1) return ok('not json at all')
    return ok(JSON.stringify({ name: 'Grace', age: 45 }))
  }

  const { data, error } = await extract({ prompt: 'extract the person', schema: SCHEMA, complete: stub })

  assert.equal(error, null)
  assert.deepEqual(data, { name: 'Grace', age: 45 })
  assert.equal(calls, 2)
  // The second attempt's prompt must carry the first attempt's failure back
  // to the model - that's the entire point of the retry.
  assert.match(promptsSeen[1], /previous response could not be used/i)
  assert.match(promptsSeen[1], /not json at all/)
})

test('retry path: fails twice (transport error both times), original error surfaces', async () => {
  let calls = 0
  const stub = async () => {
    calls += 1
    return { data: null, error: { message: 'Rate limited by provider.', kind: 'rate_limit' } }
  }

  const { data, error } = await extract({ prompt: 'extract the person', schema: SCHEMA, complete: stub })

  assert.equal(data, null)
  assert.equal(error.kind, 'rate_limit')
  assert.equal(error.message, 'Rate limited by provider.')
  assert.equal(calls, 2)
})

test('requires a schema', async () => {
  const { data, error } = await extract({ prompt: 'no schema here' })
  assert.equal(data, null)
  assert.equal(error.kind, 'invalid_input')
})

test('requires a non-empty prompt', async () => {
  const { data, error } = await extract({ prompt: '  ', schema: SCHEMA })
  assert.equal(data, null)
  assert.equal(error.kind, 'invalid_input')
})
