import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyFilters,
  facetCounts,
  makeEqualsFilter,
  makeOneOfFilter,
  makeRangeFilter,
  makeDateRangeFilter,
} from './filters.js'

const items = [
  { id: 1, cat: 'A', price: 10, date: '2024-01-01' },
  { id: 2, cat: 'B', price: 20, date: '2024-02-01' },
  { id: 3, cat: 'A', price: 30, date: '2024-03-01' },
  { id: 4, cat: 'C', price: 40, date: '2024-04-01' },
  { id: 5, cat: 'A' }, // price and date entirely absent
]

describe('range — boundary is inclusive on both ends', () => {
  test('an item exactly at min or max is kept', () => {
    const filter = makeRangeFilter('price', { min: 10, max: 30 })
    const ids = applyFilters(items, [filter]).map((i) => i.id)
    assert.deepEqual(ids, [1, 2, 3]) // 10 and 30 both survive; 40 and missing do not
  })

  test('an item one unit outside min or max is dropped', () => {
    const belowMin = applyFilters(items, [makeRangeFilter('price', { min: 11 })]).map((i) => i.id)
    const aboveMax = applyFilters(items, [makeRangeFilter('price', { max: 9 })]).map((i) => i.id)
    assert.ok(!belowMin.includes(1)) // price 10 excluded once min is 11
    assert.deepEqual(aboveMax, []) // nothing is <= 9
  })

  test('an item missing the field is excluded, never throws', () => {
    assert.doesNotThrow(() => applyFilters(items, [makeRangeFilter('price', { min: 0 })]))
    const ids = applyFilters(items, [makeRangeFilter('price', { min: 0 })]).map((i) => i.id)
    assert.ok(!ids.includes(5))
  })
})

describe('dateRange — boundary is inclusive on both ends', () => {
  test('an item exactly at from or to is kept', () => {
    const filter = makeDateRangeFilter('date', { from: '2024-01-01', to: '2024-03-01' })
    const ids = applyFilters(items, [filter]).map((i) => i.id)
    assert.deepEqual(ids, [1, 2, 3])
  })

  test('an item one day outside from or to is dropped', () => {
    const ids = applyFilters(items, [makeDateRangeFilter('date', { from: '2024-01-02' })]).map((i) => i.id)
    assert.ok(!ids.includes(1))
  })

  test('an item missing the field is excluded, never throws', () => {
    assert.doesNotThrow(() => applyFilters(items, [makeDateRangeFilter('date', { from: '2024-01-01' })]))
    const ids = applyFilters(items, [makeDateRangeFilter('date', { from: '2024-01-01' })]).map((i) => i.id)
    assert.ok(!ids.includes(5))
  })
})

describe('oneOf — empty selection matches everything', () => {
  test('an empty values array does not restrict the list at all', () => {
    const ids = applyFilters(items, [makeOneOfFilter('cat', [])]).map((i) => i.id)
    assert.deepEqual(ids, items.map((i) => i.id)) // every item, including one with a value present
  })

  test('a non-empty values array restricts to those values only', () => {
    const ids = applyFilters(items, [makeOneOfFilter('cat', ['A'])]).map((i) => i.id)
    assert.deepEqual(ids, [1, 3, 5])
  })

  test('an item missing the field never throws and is excluded unless undefined is explicitly listed', () => {
    const withMissingField = [{ id: 99 }]
    assert.doesNotThrow(() => applyFilters(withMissingField, [makeOneOfFilter('cat', ['A'])]))
    assert.deepEqual(applyFilters(withMissingField, [makeOneOfFilter('cat', ['A'])]), [])
  })
})

describe('equals — item missing the field', () => {
  test('never throws, and is excluded rather than matched', () => {
    assert.doesNotThrow(() => applyFilters(items, [makeEqualsFilter('cat', 'A')]))
    const ids = applyFilters(items, [makeEqualsFilter('cat', 'A')]).map((i) => i.id)
    assert.deepEqual(ids, [1, 3, 5])
  })
})

describe('applyFilters — composing multiple filters (AND)', () => {
  test('three filters together, all of them satisfiable', () => {
    const filters = [
      makeEqualsFilter('cat', 'A'),
      makeRangeFilter('price', { min: 0, max: 50 }),
      makeOneOfFilter('cat', ['A', 'B']),
    ]
    const ids = applyFilters(items, filters).map((i) => i.id)
    assert.deepEqual(ids, [1, 3]) // id 5 fails the range filter (missing price)
  })

  test('three filters where one matches nothing collapses the result to empty', () => {
    const filters = [
      makeEqualsFilter('cat', 'A'),
      makeOneOfFilter('cat', ['A', 'B']),
      makeRangeFilter('price', { min: 1000 }), // nothing is this expensive
    ]
    assert.deepEqual(applyFilters(items, filters), [])
  })

  test('no filters returns the list unchanged', () => {
    assert.equal(applyFilters(items, []), items) // same reference, per contract
  })
})

describe('facetCounts — excludes the filter on its own field', () => {
  test('two active filters on different fields: facets for one field ignore only that field’s own filter', () => {
    // Active: cat in {A}, price >= 15. Requesting facets for "cat" must drop
    // the cat filter but keep applying the price filter.
    const filters = [makeOneOfFilter('cat', ['A']), makeRangeFilter('price', { min: 15 })]
    const counts = facetCounts(items, filters, 'cat')

    // Survivors of price >= 15 alone: id2 (B, 20), id3 (A, 30), id4 (C, 40).
    // id1 (price 10) and id5 (no price) are excluded by the price filter
    // regardless of category — proving the cat filter itself was dropped,
    // not just loosened.
    assert.deepEqual([...counts.entries()].sort(), [
      ['A', 1],
      ['B', 1],
      ['C', 1],
    ])
  })

  test('facets for the other active field ("price") keep the cat filter applied', () => {
    const filters = [makeOneOfFilter('cat', ['A']), makeRangeFilter('price', { min: 15 })]
    const counts = facetCounts(items, filters, 'price')

    // Base list is filtered by cat=A only (price filter dropped for this call):
    // id1 (A, 10), id3 (A, 30), id5 (A, no price -> skipped from counts).
    assert.deepEqual([...counts.entries()].sort((a, b) => a[0] - b[0]), [
      [10, 1],
      [30, 1],
    ])
  })

  test('an item missing the counted field is silently skipped, never throws', () => {
    assert.doesNotThrow(() => facetCounts(items, [], 'price'))
    const counts = facetCounts(items, [], 'price')
    assert.equal([...counts.values()].reduce((a, b) => a + b, 0), 4) // id5 (no price) not counted
  })
})
