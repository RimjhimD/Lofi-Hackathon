// Run with: node --test src/lib/store.test.mjs
// No dependencies beyond node:test / node:assert — must work before `npm install`
// finishes, and must work under plain node (no DOM, no localStorage global).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  SUPPLY_ITEMS,
  getState,
  subscribe,
  submitUpdate,
  addConsignments,
  occupancyLevel,
  resetToSeed,
} from './store.js'

const SUPPLY_VALUES = new Set(SUPPLY_ITEMS.map(([value]) => value))

// Every mutation is against one shared module-level singleton, so reset to a
// known-good seed before each test — otherwise test order would matter.
beforeEach(() => {
  resetToSeed()
})

test('seed: has 9 shelters, 6 updates, 5 consignments', () => {
  const { shelters, updates, consignments } = getState()
  assert.equal(shelters.length, 9)
  assert.equal(updates.length, 6)
  assert.equal(consignments.length, 5)
})

test('seed: occupancy mix is exactly 2 over, 3 near-full, 4 ok', () => {
  const { shelters } = getState()
  const counts = { ok: 0, 'near-full': 0, over: 0 }
  for (const shelter of shelters) {
    counts[occupancyLevel(shelter)] += 1
  }
  assert.equal(counts.over, 2)
  assert.equal(counts['near-full'], 3)
  assert.equal(counts.ok, 4)
})

test('seed: every shelter need item is a valid SUPPLY_ITEMS value', () => {
  const { shelters } = getState()
  for (const shelter of shelters) {
    assert.ok(shelter.needs.length >= 2 && shelter.needs.length <= 4, `${shelter.id} needs 2-4 items`)
    for (const need of shelter.needs) {
      assert.ok(SUPPLY_VALUES.has(need.item), `${need.item} is a valid supply item`)
      assert.equal(typeof need.qty, 'number')
    }
  }
})

test('seed: at least 2 supply items have totalNeed > totalStock (critical gap)', () => {
  const { shelters, consignments } = getState()

  const totalNeed = {}
  for (const shelter of shelters) {
    for (const { item, qty } of shelter.needs) {
      totalNeed[item] = (totalNeed[item] ?? 0) + qty
    }
  }

  const totalStock = {}
  for (const { item, qty } of consignments) {
    totalStock[item] = (totalStock[item] ?? 0) + qty
  }

  const criticalItems = SUPPLY_ITEMS.map(([value]) => value).filter(
    (item) => (totalNeed[item] ?? 0) > (totalStock[item] ?? 0)
  )

  assert.ok(
    criticalItems.length >= 2,
    `expected at least 2 critical items, got ${criticalItems.length}: ${criticalItems.join(', ')}`
  )
})

test('occupancyLevel: boundaries — 84.9% ok, 85% near-full, 100% near-full, 100.1% over', () => {
  assert.equal(occupancyLevel({ headcount: 849, capacity: 1000 }), 'ok')
  assert.equal(occupancyLevel({ headcount: 850, capacity: 1000 }), 'near-full')
  assert.equal(occupancyLevel({ headcount: 1000, capacity: 1000 }), 'near-full')
  assert.equal(occupancyLevel({ headcount: 1001, capacity: 1000 }), 'over')
})

test('submitUpdate: applies headcount + needs to the shelter and prepends the update', () => {
  const shelterId = 'jaintiapur-bazar-shelter'
  const before = getState()
  const updatesBefore = before.updates.length

  const record = submitUpdate({
    shelterId,
    headcount: 250,
    needs: [{ item: 'rice', qty: 400 }],
    note: 'boat arrived',
  })

  const after = getState()
  const shelter = after.shelters.find((s) => s.id === shelterId)

  assert.equal(shelter.headcount, 250)
  assert.deepEqual(shelter.needs, [{ item: 'rice', qty: 400 }])
  assert.equal(shelter.updatedAt, record.at)
  assert.ok(typeof record.id === 'string' && record.id.length > 0)
  assert.ok(!Number.isNaN(Date.parse(record.at)))

  assert.equal(after.updates.length, updatesBefore + 1)
  assert.equal(after.updates[0].id, record.id)
  assert.equal(after.updates[0].shelterId, shelterId)
})

test('addConsignments: appends rows and gives each an id', () => {
  const before = getState().consignments.length

  const added = addConsignments([
    { ngo: 'Caritas Bangladesh', item: 'medkit', qty: 40, unit: 'kits', etaHours: 5 },
    { ngo: 'Action Aid Bangladesh', item: 'blanket', qty: 200, unit: 'pcs', etaHours: 9 },
  ])

  const after = getState().consignments
  assert.equal(after.length, before + 2)
  for (const row of added) {
    assert.ok(typeof row.id === 'string' && row.id.length > 0)
  }
  assert.deepEqual(after.slice(-2).map((r) => r.ngo), ['Caritas Bangladesh', 'Action Aid Bangladesh'])
})

test('subscribe: fires on mutation, and unsubscribe stops further calls', () => {
  let calls = 0
  let lastState = null
  const unsubscribe = subscribe((state) => {
    calls += 1
    lastState = state
  })

  addConsignments([{ ngo: 'BRAC', item: 'rice', qty: 10, unit: 'kg', etaHours: 3 }])
  assert.equal(calls, 1)
  assert.ok(lastState.consignments.length > 0)

  unsubscribe()

  addConsignments([{ ngo: 'BRAC', item: 'rice', qty: 10, unit: 'kg', etaHours: 3 }])
  assert.equal(calls, 1, 'listener must not fire after unsubscribe')
})
