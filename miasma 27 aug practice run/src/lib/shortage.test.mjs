// Run with: node --test src/lib/shortage.test.mjs
// No dependencies beyond node:test / node:assert — no DOM, no localStorage, no
// npm install required, so this runs in either repo and before any UI exists.
//
// The SEED fixture below mirrors store.js's v2 Raozan seed exactly (9 shelters,
// 5 consignments). Asserting on real seed numbers means these tests fail if the
// integrator changes the seed — which is the point: the board's demo numbers and
// the 60-second video script both depend on them.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { shortageReport, attachNeeds } from './shortage.js'

const shelter = (id, name, capacity, headcount, needs) => ({ id, name, upazila: name, capacity, headcount, needs })

const SEED = {
  shelters: [
    shelter('raozan-pourashava-high-school', 'Raozan Pourashava High School Shelter', 320, 412, [
      { item: 'rice', qty: 380 }, { item: 'water', qty: 300 }, { item: 'tarp', qty: 120 },
    ]),
    shelter('gohira-union-parishad', 'Gohira Union Parishad Shelter', 250, 300, [
      { item: 'water', qty: 250 }, { item: 'ors', qty: 150 }, { item: 'blanket', qty: 100 }, { item: 'babyfood', qty: 40 },
    ]),
    shelter('noapara-degree-college', 'Noapara Degree College Shelter', 200, 180, [
      { item: 'blanket', qty: 150 }, { item: 'rice', qty: 120 },
    ]),
    shelter('urkirchar-pilot-high-school', 'Urkirchar Pilot High School Shelter', 220, 198, [
      { item: 'tarp', qty: 90 }, { item: 'dryfood', qty: 80 }, { item: 'medkit', qty: 30 },
    ]),
    shelter('binajuri-model-high-school', 'Binajuri Model High School Shelter', 180, 153, [
      { item: 'water', qty: 140 }, { item: 'ors', qty: 60 },
    ]),
    shelter('kadalpur-community-center', 'Kadalpur Community Center Shelter', 400, 220, [
      { item: 'dryfood', qty: 100 }, { item: 'babyfood', qty: 25 }, { item: 'medkit', qty: 15 },
    ]),
    shelter('chikdair-primary-school', 'Chikdair Primary School Shelter', 150, 90, [
      { item: 'rice', qty: 70 }, { item: 'blanket', qty: 50 },
    ]),
    shelter('dabua-union-shelter', 'Dabua Union Shelter', 260, 140, [
      { item: 'water', qty: 90 }, { item: 'tarp', qty: 40 }, { item: 'ors', qty: 30 }, { item: 'medkit', qty: 10 },
    ]),
    shelter('jaintiapur-bazar-shelter', 'Pahartali Bazar Shelter', 300, 200, [
      { item: 'dryfood', qty: 60 }, { item: 'babyfood', qty: 20 },
    ]),
  ],
  updates: [],
  consignments: [
    { id: 'seed-c1', ngo: 'BRAC', item: 'rice', qty: 300, unit: 'kg', etaHours: 6 },
    { id: 'seed-c2', ngo: 'BDRCS', item: 'water', qty: 800, unit: 'L', etaHours: 4 },
    { id: 'seed-c3', ngo: 'Ahsania Mission', item: 'dryfood', qty: 300, unit: 'packs', etaHours: 10 },
    { id: 'seed-c4', ngo: 'Muslim Aid', item: 'ors', qty: 300, unit: 'sachets', etaHours: 8 },
    { id: 'seed-c5', ngo: 'CARE Bangladesh', item: 'tarp', qty: 100, unit: 'pcs', etaHours: 12 },
  ],
}

const clone = (value) => JSON.parse(JSON.stringify(value))
const close = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, msg + ': expected ~' + expected + ', got ' + actual)

// --- the seed, which is what a judge sees on first paint --------------------

test('seed: exactly the 5 items whose need exceeds stock, worst gap first', () => {
  const report = shortageReport(clone(SEED))
  assert.deepEqual(
    report.map((g) => [g.item, g.gap]),
    [['blanket', 300], ['rice', 270], ['tarp', 150], ['babyfood', 85], ['medkit', 55]]
  )
})

test('seed: covered items are omitted entirely, not listed with a negative gap', () => {
  const items = shortageReport(clone(SEED)).map((g) => g.item)
  for (const covered of ['water', 'dryfood', 'ors']) {
    assert.ok(!items.includes(covered), covered + ' is covered (stock >= need) and must not appear')
  }
})

test('seed: need and stock totals are summed across every shelter and consignment', () => {
  const byItem = Object.fromEntries(shortageReport(clone(SEED)).map((g) => [g.item, g]))
  assert.equal(byItem.rice.totalNeed, 570) // 380 + 120 + 70
  assert.equal(byItem.rice.totalStock, 300) // one consignment
  assert.equal(byItem.blanket.totalNeed, 300) // 100 + 150 + 50
  assert.equal(byItem.blanket.totalStock, 0) // nothing seeded
  assert.equal(byItem.tarp.totalNeed, 250) // 120 + 90 + 40
  assert.equal(byItem.tarp.totalStock, 100)
})

test('seed: label and unit come from the supply catalogue', () => {
  const byItem = Object.fromEntries(shortageReport(clone(SEED)).map((g) => [g.item, g]))
  assert.deepEqual([byItem.rice.label, byItem.rice.unit], ['Rice', 'kg'])
  assert.deepEqual([byItem.blanket.label, byItem.blanket.unit], ['Blankets', 'pcs'])
  assert.deepEqual([byItem.medkit.label, byItem.medkit.unit], ['Medicine kits', 'kits'])
})

test('seed: shelters inside a group rank by severity = needQty * headcount/capacity', () => {
  const rice = shortageReport(clone(SEED)).find((g) => g.item === 'rice')
  assert.deepEqual(rice.shelters.map((s) => s.shelter.id), [
    'raozan-pourashava-high-school', // 380 * 412/320
    'noapara-degree-college', //        120 * 180/200
    'chikdair-primary-school', //        70 *  90/150
  ])
  close(rice.shelters[0].severity, 489.25, 'raozan rice severity')
  close(rice.shelters[1].severity, 108, 'noapara rice severity')
  close(rice.shelters[2].severity, 42, 'chikdair rice severity')
  assert.deepEqual(rice.shelters.map((s) => s.needQty), [380, 120, 70])
})

test('seed: severity weighs occupancy, not raw quantity alone', () => {
  const blanket = shortageReport(clone(SEED)).find((g) => g.item === 'blanket')
  // Noapara needs 150 at 90% full (135); Gohira needs 100 at 120% full (120).
  assert.equal(blanket.shelters[0].shelter.id, 'noapara-degree-college')
  close(blanket.shelters[0].severity, 135, 'noapara blanket severity')
  close(blanket.shelters[1].severity, 120, 'gohira blanket severity')
  // Chikdair needs 50 at 60% full — half Gohira's need but far less pressure.
  assert.equal(blanket.shelters[2].shelter.id, 'chikdair-primary-school')
  close(blanket.shelters[2].severity, 30, 'chikdair blanket severity')
})

test('seed: every group carries the numbers a judge needs to see the reasoning', () => {
  for (const group of shortageReport(clone(SEED))) {
    assert.equal(group.gap, group.totalNeed - group.totalStock, group.item + ' gap must equal need - stock')
    assert.ok(group.shelters.length > 0, group.item + ' must name the shelters that need it')
    for (const row of group.shelters) {
      assert.ok(row.shelter && row.shelter.name, 'each row carries its shelter object')
      assert.ok(Number.isFinite(row.needQty) && row.needQty > 0, 'needQty is a positive number')
      assert.ok(Number.isFinite(row.severity), 'severity is finite so the UI can print it')
    }
  }
})

// --- criticality boundary ---------------------------------------------------

test('gap of exactly zero is not critical', () => {
  const report = shortageReport({
    shelters: [shelter('s1', 'S1', 100, 50, [{ item: 'rice', qty: 100 }])],
    consignments: [{ item: 'rice', qty: 100 }],
  })
  assert.deepEqual(report, [])
})

test('one unit short is critical', () => {
  const report = shortageReport({
    shelters: [shelter('s1', 'S1', 100, 50, [{ item: 'rice', qty: 101 }])],
    consignments: [{ item: 'rice', qty: 100 }],
  })
  assert.equal(report.length, 1)
  assert.equal(report[0].gap, 1)
})

test('stock with no matching need never appears', () => {
  const report = shortageReport({
    shelters: [shelter('s1', 'S1', 100, 50, [{ item: 'rice', qty: 10 }])],
    consignments: [{ item: 'blanket', qty: 500 }, { item: 'rice', qty: 5 }],
  })
  assert.deepEqual(report.map((g) => g.item), ['rice'])
})

test('need with no consignments at all reports totalStock 0, not undefined', () => {
  const report = shortageReport({
    shelters: [shelter('s1', 'S1', 100, 50, [{ item: 'medkit', qty: 7 }])],
    consignments: [],
  })
  assert.equal(report[0].totalStock, 0)
  assert.equal(report[0].gap, 7)
})

// --- robustness: bad data must not scramble the ranking ---------------------

test('is pure — the caller state is not mutated, needs arrays included', () => {
  const state = clone(SEED)
  const before = JSON.stringify(state)
  shortageReport(state)
  assert.equal(JSON.stringify(state), before)
})

test('missing or malformed state returns an empty report instead of throwing', () => {
  for (const bad of [undefined, null, {}, { shelters: null }, { shelters: 'nope', consignments: 3 }]) {
    assert.deepEqual(shortageReport(bad), [])
  }
})

test('zero or missing capacity yields severity 0, never NaN or Infinity', () => {
  const report = shortageReport({
    shelters: [
      shelter('zero', 'Zero capacity', 0, 40, [{ item: 'rice', qty: 50 }]),
      shelter('missing', 'No capacity field', undefined, 40, [{ item: 'rice', qty: 50 }]),
      shelter('normal', 'Normal', 100, 50, [{ item: 'rice', qty: 50 }]),
    ],
    consignments: [],
  })
  for (const row of report[0].shelters) {
    assert.ok(Number.isFinite(row.severity), 'severity ' + row.severity + ' must be finite')
  }
  assert.equal(report[0].shelters[0].shelter.id, 'normal') // 50 * 0.5 = 25 beats the two zeros
  close(report[0].shelters[0].severity, 25, 'normal severity')
})

test('non-numeric and non-positive quantities are ignored, not coerced to NaN', () => {
  const report = shortageReport({
    shelters: [
      shelter('s1', 'S1', 100, 50, [
        { item: 'rice', qty: 100 },
        { item: 'rice', qty: 'abc' },
        { item: 'water', qty: -5 },
        { item: 'tarp', qty: 0 },
        { item: '', qty: 10 },
      ]),
    ],
    consignments: [{ item: 'rice', qty: 'oops' }],
  })
  assert.deepEqual(report.map((g) => g.item), ['rice'])
  assert.equal(report[0].totalNeed, 100)
  assert.equal(report[0].totalStock, 0)
})

test('duplicate need rows for one shelter and item are summed, not last-wins', () => {
  const report = shortageReport({
    shelters: [shelter('s1', 'S1', 100, 100, [{ item: 'rice', qty: 60 }, { item: 'rice', qty: 40 }])],
    consignments: [],
  })
  assert.equal(report[0].totalNeed, 100)
  assert.equal(report[0].shelters.length, 1)
  assert.equal(report[0].shelters[0].needQty, 100)
  close(report[0].shelters[0].severity, 100, 'summed severity uses the summed qty')
})

test('an item outside the fixed catalogue still surfaces rather than vanishing', () => {
  const report = shortageReport({
    shelters: [shelter('s1', 'S1', 100, 50, [{ item: 'generator', qty: 5 }])],
    consignments: [],
  })
  assert.equal(report.length, 1)
  assert.equal(report[0].item, 'generator')
  assert.equal(report[0].label, 'generator') // raw value as the label
  assert.equal(report[0].unit, '')
})

test('equal gaps are ordered by catalogue order, so the board never flickers', () => {
  const state = {
    shelters: [shelter('s1', 'S1', 100, 100, [{ item: 'medkit', qty: 50 }, { item: 'rice', qty: 50 }])],
    consignments: [],
  }
  const first = shortageReport(state).map((g) => g.item)
  const second = shortageReport(state).map((g) => g.item)
  assert.deepEqual(first, ['rice', 'medkit']) // rice is earlier in SUPPLY_ITEMS
  assert.deepEqual(first, second)
})

test('a caller-supplied supply catalogue overrides the built-in copy', () => {
  const report = shortageReport({
    shelters: [shelter('s1', 'S1', 100, 50, [{ item: 'rice', qty: 10 }])],
    consignments: [],
    supplyItems: [{ value: 'rice', label: 'Chal', unit: 'kilo' }],
  })
  assert.deepEqual([report[0].label, report[0].unit], ['Chal', 'kilo'])
})

// --- reactivity: the board must change when an update or an import lands ----

test('a field update that replaces a needs list re-ranks the board', () => {
  // SPEC v2 acceptance script step 2, exactly: the Raozan shelter reports
  // headcount 380 and Rice 400. submitUpdate REPLACES the needs array, so this
  // shelter's water (300) and tarp (120) disappear along with it.
  const after = clone(SEED)
  const target = after.shelters.find((s) => s.id === 'raozan-pourashava-high-school')
  target.headcount = 380
  target.needs = [{ item: 'rice', qty: 400 }]

  const report = shortageReport(after)
  const byItem = Object.fromEntries(report.map((g) => [g.item, g]))
  assert.equal(byItem.rice.gap, 290) // 590 need - 300 stock
  assert.equal(byItem.tarp.gap, 30) // 130 need - 100 stock, was 150
  assert.deepEqual(report.map((g) => g.item), ['blanket', 'rice', 'babyfood', 'medkit', 'tarp'])
  assert.ok(!byItem.tarp.shelters.some((s) => s.shelter.id === 'raozan-pourashava-high-school'))
})

test('importing enough stock closes a gap and drops the item off the board', () => {
  const after = clone(SEED)
  after.consignments.push({ id: 'csv-1', ngo: 'Test NGO', item: 'blanket', qty: 300, unit: 'pcs', etaHours: 3 })
  const report = shortageReport(after)
  assert.ok(!report.some((g) => g.item === 'blanket'), 'blanket need 300 vs stock 300 is no longer critical')
  assert.deepEqual(report.map((g) => g.item), ['rice', 'tarp', 'babyfood', 'medkit'])
})

test('a partial import shrinks the gap and demotes the item', () => {
  const after = clone(SEED)
  after.consignments.push({ id: 'csv-2', item: 'blanket', qty: 200, unit: 'pcs' })
  const report = shortageReport(after)
  assert.deepEqual(report.map((g) => [g.item, g.gap]), [
    ['rice', 270], ['tarp', 150], ['blanket', 100], ['babyfood', 85], ['medkit', 55],
  ])
})

// --- attachNeeds: the api.js reassembly the board runs before reporting -----
//
// fetchShelters() returns pins with no needs; fetchNeeds() returns a flat list.
// These cover the regrouping so the board's real data path is tested, not just
// the pure report over an already-assembled state.

/** SEED re-expressed the way api.js actually returns it. */
const apiShaped = () => ({
  shelters: clone(SEED).shelters.map(({ needs, ...pin }) => pin),
  needs: clone(SEED).shelters.flatMap((s) => s.needs.map((n) => ({ shelterId: s.id, item: n.item, qty: n.qty }))),
  consignments: clone(SEED).consignments,
})

test('attachNeeds groups a flat needs list back onto its shelters', () => {
  const { shelters, needs } = apiShaped()
  assert.ok(shelters.every((s) => s.needs === undefined), 'pins start with no needs')
  const merged = attachNeeds(shelters, needs)
  const raozan = merged.find((s) => s.id === 'raozan-pourashava-high-school')
  assert.deepEqual(raozan.needs, [
    { item: 'rice', qty: 380 },
    { item: 'water', qty: 300 },
    { item: 'tarp', qty: 120 },
  ])
})

test('attachNeeds sorts each shelter needs descending by qty', () => {
  const merged = attachNeeds(
    [{ id: 's1' }],
    [
      { shelterId: 's1', item: 'medkit', qty: 10 },
      { shelterId: 's1', item: 'rice', qty: 500 },
      { shelterId: 's1', item: 'tarp', qty: 90 },
    ]
  )
  assert.deepEqual(merged[0].needs.map((n) => n.qty), [500, 90, 10])
})

test('attachNeeds gives a shelter with no needs an empty array, not undefined', () => {
  const merged = attachNeeds([{ id: 'a' }, { id: 'b' }], [{ shelterId: 'a', item: 'rice', qty: 5 }])
  assert.deepEqual(merged.find((s) => s.id === 'b').needs, [])
})

test('attachNeeds ignores needs whose shelter is not in the list', () => {
  const merged = attachNeeds([{ id: 'a' }], [{ shelterId: 'ghost', item: 'rice', qty: 5 }])
  assert.equal(merged.length, 1)
  assert.deepEqual(merged[0].needs, [])
})

test('attachNeeds skips malformed need rows instead of throwing', () => {
  const merged = attachNeeds(
    [{ id: 'a' }],
    [
      { shelterId: 'a', item: 'rice', qty: 10 },
      { shelterId: null, item: 'rice', qty: 10 },
      { shelterId: 'a', item: '', qty: 10 },
      { shelterId: 'a', item: 'water', qty: 'x' },
      null,
    ]
  )
  assert.deepEqual(merged[0].needs, [{ item: 'rice', qty: 10 }])
})

test('attachNeeds tolerates missing arguments', () => {
  assert.deepEqual(attachNeeds(undefined, undefined), [])
  assert.deepEqual(attachNeeds([{ id: 'a' }], null)[0].needs, [])
})

test('attachNeeds is pure — neither argument is mutated', () => {
  const { shelters, needs } = apiShaped()
  const beforeShelters = JSON.stringify(shelters)
  const beforeNeeds = JSON.stringify(needs)
  attachNeeds(shelters, needs)
  assert.equal(JSON.stringify(shelters), beforeShelters)
  assert.equal(JSON.stringify(needs), beforeNeeds)
})

test('the board pipeline end to end: api shapes -> attachNeeds -> shortageReport', () => {
  const { shelters, needs, consignments } = apiShaped()
  const report = shortageReport({ shelters: attachNeeds(shelters, needs), updates: [], consignments })
  assert.deepEqual(
    report.map((g) => [g.item, g.gap]),
    [['blanket', 300], ['rice', 270], ['tarp', 150], ['babyfood', 85], ['medkit', 55]]
  )
  const rice = report.find((g) => g.item === 'rice')
  close(rice.shelters[0].severity, 489.25, 'top rice severity survives the round trip')
})

test('a signed-out board (needs gated away) shows nothing rather than false zeros', () => {
  // RLS denies shelter_needs to the public tier, so fetchNeeds() yields [].
  // The board must then be empty, NOT a list of items with totalNeed 0.
  const { shelters, consignments } = apiShaped()
  const report = shortageReport({ shelters: attachNeeds(shelters, []), updates: [], consignments })
  assert.deepEqual(report, [])
})
