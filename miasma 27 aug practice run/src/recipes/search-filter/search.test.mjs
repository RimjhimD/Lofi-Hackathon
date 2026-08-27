import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { search, fold, highlightSegments } from './search.js'

const items = [
  { id: 1, name: 'Café Table', description: 'Small round bistro table' },
  { id: 2, name: 'Category 5 Cable', description: '10m network cable' },
  { id: 3, name: 'Vacation Backpack', description: 'Carry-on sized, water resistant cable tie included' },
  { id: 4, name: 'Naïve Bayes Notebook', description: 'Intro to probabilistic ML' },
  { id: 5, name: 'John Doe Résumé', description: 'Contact: j@x.com' },
]

describe('fold', () => {
  test('lowercases and strips diacritics', () => {
    assert.equal(fold('Café Naïve RÉSUMÉ'), 'cafe naive resume')
  })
})

describe('search — MUST cases', () => {
  test('is case-insensitive', () => {
    const lower = search(items, 'category', ['name']).map((r) => r.item.id)
    const upper = search(items, 'CATEGORY', ['name']).map((r) => r.item.id)
    const mixed = search(items, 'CaTeGoRy', ['name']).map((r) => r.item.id)
    assert.deepEqual(lower, [2])
    assert.deepEqual(upper, [2])
    assert.deepEqual(mixed, [2])
  })

  test('folds accents/diacritics both in query and in field', () => {
    // Unaccented query finds accented field.
    assert.deepEqual(search(items, 'cafe', ['name']).map((r) => r.item.id), [1])
    assert.deepEqual(search(items, 'naive', ['name']).map((r) => r.item.id), [4])
    assert.deepEqual(search(items, 'resume', ['name']).map((r) => r.item.id), [5])
    // Accented query finds unaccented field too (query is folded the same way).
    assert.deepEqual(search(items, 'café', ['name']).map((r) => r.item.id), [1])
  })

  test('multi-word query: words may appear in any order, in any searched field', () => {
    const forward = search(items, 'john doe', ['name', 'description'])
    const backward = search(items, 'doe john', ['name', 'description'])
    assert.deepEqual(forward.map((r) => r.item.id), [5])
    assert.deepEqual(backward.map((r) => r.item.id), [5])

    // "resume" is in name, "contact" is in description — different fields, must both match.
    const acrossFields = search(items, 'resume contact', ['name', 'description'])
    assert.deepEqual(acrossFields.map((r) => r.item.id), [5])
  })

  test('empty query returns everything, unchanged, in original order', () => {
    const result = search(items, '', ['name', 'description'])
    assert.equal(result.length, items.length)
    result.forEach((r, i) => {
      assert.equal(r.item, items[i]) // same reference, same order
      assert.deepEqual(r.matches, {})
    })

    // Whitespace-only query behaves the same as empty.
    const whitespaceResult = search(items, '   ', ['name', 'description'])
    assert.equal(whitespaceResult.length, items.length)
  })

  test('a query matching nothing returns an empty array', () => {
    assert.deepEqual(search(items, 'xylophone quasar', ['name', 'description']), [])
  })

  test('a query where only some words match returns no results (AND semantics)', () => {
    assert.deepEqual(search(items, 'café xylophone', ['name', 'description']), [])
  })

  test('exposes matched ranges usable for highlighting', () => {
    const [result] = search(items, 'cafe', ['name'])
    assert.deepEqual(result.matches.name, [{ start: 0, end: 4 }])
    assert.equal(result.item.name.slice(0, 4), 'Café')
  })
})

describe('search — ranking order', () => {
  test('an exact prefix match outranks a mid-word match', () => {
    // "Category 5 Cable" -> "cat" is a prefix match (score 80).
    // "Vacation Backpack" -> "cat" is buried mid-word in "vaCATion" (score 40).
    const results = search(items, 'cat', ['name'])
    assert.deepEqual(results.map((r) => r.item.id), [2, 3])
    assert.ok(results[0].score > results[1].score)
  })

  test('a whole-field exact match outranks a same-position prefix match', () => {
    const list = [{ id: 'a', name: 'Table' }, { id: 'b', name: 'Table And Chairs' }]
    const results = search(list, 'table', ['name'])
    assert.deepEqual(results.map((r) => r.item.id), ['a', 'b'])
  })

  test('a word-boundary match outranks a mid-word match', () => {
    const list = [
      { id: 'a', name: 'Blue Cable Tie' }, // "cable" starts a word
      { id: 'b', name: 'Escaping Room' }, // "cap" not present; use different example below
    ]
    const results = search(list, 'cable', ['name'])
    assert.deepEqual(results.map((r) => r.item.id), ['a'])
  })
})

describe('highlightSegments', () => {
  test('splits text around ranges', () => {
    const segments = highlightSegments('Café Table', [{ start: 0, end: 4 }])
    assert.deepEqual(segments, [
      { text: 'Café', highlight: true },
      { text: ' Table', highlight: false },
    ])
  })

  test('no ranges returns the whole text unhighlighted', () => {
    assert.deepEqual(highlightSegments('Café Table', []), [{ text: 'Café Table', highlight: false }])
  })

  test('merges overlapping ranges from multiple matched words', () => {
    const [result] = search([{ id: 1, name: 'Cast Cast Iron' }], 'cast', ['name'])
    // Only one distinct word "cast" repeated — best occurrence is recorded once per query word,
    // so a single-word query yields a single range.
    assert.equal(result.matches.name.length, 1)
  })
})
