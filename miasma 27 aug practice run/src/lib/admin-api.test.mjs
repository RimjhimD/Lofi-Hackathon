// Run with: node --test src/lib/admin-api.test.mjs
// No dependencies beyond node:test / node:assert. Deliberately does NOT call
// fetchProfiles()/setRole()/setApproved() — those dynamic-import ./supa.js,
// which reads `import.meta.env` and crashes under plain node (see the module
// doc in admin-api.js). This file covers the pure logic and the mock
// subscribe/notify pub-sub, neither of which touches ./supa.js at all.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { sortProfilesPendingFirst, subscribeMockProfiles, resetMockProfiles } from './admin-api.js'

beforeEach(() => {
  resetMockProfiles()
})

test('sortProfilesPendingFirst: pending (approved=false) accounts come first', () => {
  const input = [
    { full_name: 'Zara', approved: true },
    { full_name: 'Amit', approved: false },
    { full_name: 'Bina', approved: true },
  ]
  const sorted = sortProfilesPendingFirst(input)
  assert.deepEqual(
    sorted.map((p) => p.full_name),
    ['Amit', 'Bina', 'Zara']
  )
})

test('sortProfilesPendingFirst: within each group, alphabetical by full_name', () => {
  const input = [
    { full_name: 'Zara', approved: false },
    { full_name: 'Amit', approved: false },
    { full_name: 'Mina', approved: false },
  ]
  const sorted = sortProfilesPendingFirst(input)
  assert.deepEqual(
    sorted.map((p) => p.full_name),
    ['Amit', 'Mina', 'Zara']
  )
})

test('sortProfilesPendingFirst: does not mutate its input array', () => {
  const input = [
    { full_name: 'Zara', approved: true },
    { full_name: 'Amit', approved: false },
  ]
  const copy = [...input]
  sortProfilesPendingFirst(input)
  assert.deepEqual(input, copy)
})

test('sortProfilesPendingFirst: handles an empty list', () => {
  assert.deepEqual(sortProfilesPendingFirst([]), [])
})

test('sortProfilesPendingFirst: tolerates a missing full_name', () => {
  const input = [
    { full_name: null, approved: false },
    { full_name: 'Amit', approved: false },
  ]
  assert.doesNotThrow(() => sortProfilesPendingFirst(input))
})

test('mock seed: 4 profiles — 1 admin, 1 commissioner, 2 volunteers, exactly 1 pending', () => {
  let seen
  const unsubscribe = subscribeMockProfiles((profiles) => {
    seen = profiles
  })
  unsubscribe()

  assert.equal(seen.length, 4)
  assert.equal(seen.filter((p) => p.role === 'admin').length, 1)
  assert.equal(seen.filter((p) => p.role === 'commissioner').length, 1)
  assert.equal(seen.filter((p) => p.role === 'volunteer').length, 2)
  assert.equal(seen.filter((p) => !p.approved).length, 1)
  assert.equal(seen.filter((p) => p.approved).length, 3)
})

test('subscribeMockProfiles: fires immediately with a snapshot, then unsubscribe stops further calls', () => {
  let calls = 0
  const unsubscribe = subscribeMockProfiles(() => {
    calls += 1
  })
  assert.equal(calls, 1, 'fires once immediately on subscribe')
  unsubscribe()
  resetMockProfiles()
  assert.equal(calls, 1, 'no further calls after unsubscribe')
})

test('subscribeMockProfiles: snapshots are independent copies, not shared references', () => {
  let first
  const unsubscribe = subscribeMockProfiles((profiles) => {
    first = profiles
  })
  first[0].full_name = 'mutated locally'
  let second
  subscribeMockProfiles((profiles) => {
    second = profiles
  })
  assert.notEqual(second[0].full_name, 'mutated locally')
  unsubscribe()
})

test('resetMockProfiles: returns a fresh 4-profile seed and notifies subscribers', () => {
  let notifiedCount = null
  const unsubscribe = subscribeMockProfiles((profiles) => {
    notifiedCount = profiles.length
  })
  const reset = resetMockProfiles()
  assert.equal(reset.length, 4)
  assert.equal(notifiedCount, 4)
  unsubscribe()
})
