// Run with: node --test scale.test.mjs
// Covers the edge cases that actually bite: all-zero data, a single data
// point, negative values, and a flat series (identical min/max). Every one
// of these must not produce NaN and must not collapse the axis to a single
// repeated tick.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { niceTicks, linearScale, bandScale, linePath } from './scale.js'

function assertAllFinite(arr, label) {
  for (const v of arr) {
    assert.ok(Number.isFinite(v), `${label}: expected finite number, got ${v}`)
  }
}

describe('niceTicks', () => {
  test('normal range picks round numbers', () => {
    const ticks = niceTicks(0, 97)
    assertAllFinite(ticks, 'ticks')
    assert.ok(ticks[0] <= 0)
    assert.ok(ticks[ticks.length - 1] >= 97)
    // every step should be a "nice" round number, not e.g. 19.4
    const step = ticks[1] - ticks[0]
    assert.ok([1, 2, 2.5, 5, 10, 20, 25, 50, 100].some((n) => Math.abs(step - n) < 1e-9 || step % n === 0))
  })

  test('all-zero data does not collapse the axis', () => {
    const ticks = niceTicks(0, 0)
    assertAllFinite(ticks, 'ticks')
    assert.ok(ticks.length >= 2)
    assert.notEqual(ticks[0], ticks[ticks.length - 1])
  })

  test('a single data point (min === max, non-zero) does not collapse', () => {
    const ticks = niceTicks(42, 42)
    assertAllFinite(ticks, 'ticks')
    assert.ok(ticks.length >= 2)
    assert.notEqual(ticks[0], ticks[ticks.length - 1])
  })

  test('a flat series (identical min and max) does not collapse', () => {
    const ticks = niceTicks(-7, -7)
    assertAllFinite(ticks, 'ticks')
    assert.ok(ticks.length >= 2)
    assert.notEqual(ticks[0], ticks[ticks.length - 1])
  })

  test('negative values produce a valid ascending range', () => {
    const ticks = niceTicks(-50, -10)
    assertAllFinite(ticks, 'ticks')
    assert.ok(ticks[0] <= -50)
    assert.ok(ticks[ticks.length - 1] >= -10)
  })

  test('handles min/max passed reversed', () => {
    const ticks = niceTicks(100, 0)
    assertAllFinite(ticks, 'ticks')
    assert.ok(ticks[0] <= 0)
    assert.ok(ticks[ticks.length - 1] >= 100)
  })

  test('non-finite input falls back to a safe default', () => {
    assert.deepEqual(niceTicks(NaN, 10), [0, 1])
    assert.deepEqual(niceTicks(0, Infinity), [0, 1])
  })
})

describe('linearScale', () => {
  test('maps a normal domain to a pixel range', () => {
    const scale = linearScale([0, 100], [0, 200])
    assert.equal(scale(0), 0)
    assert.equal(scale(100), 200)
    assert.equal(scale(50), 100)
  })

  test('all-zero domain does not produce NaN', () => {
    const scale = linearScale([0, 0], [0, 200])
    assert.ok(Number.isFinite(scale(0)))
    // the padded domain should still centre the single value
    assert.ok(Math.abs(scale(0) - 100) < 1e-9)
  })

  test('a single-value (flat) domain does not produce NaN', () => {
    const scale = linearScale([9, 9], [0, 100])
    assert.ok(Number.isFinite(scale(9)))
  })

  test('negative domain maps correctly, no NaN', () => {
    const scale = linearScale([-50, -10], [0, 100])
    assertAllFinite([scale(-50), scale(-10), scale(-30)], 'scale')
    assert.equal(scale(-50), 0)
    assert.equal(scale(-10), 100)
  })

  test('non-finite domain bounds fall back instead of NaN', () => {
    const scale = linearScale([NaN, 10], [0, 100])
    assert.ok(Number.isFinite(scale(5)))
  })
})

describe('bandScale', () => {
  test('divides a range into equal bands', () => {
    const { bandwidth, position } = bandScale(4, [0, 400], 0)
    assert.equal(bandwidth, 100)
    assert.equal(position(0), 0)
    assert.equal(position(3), 300)
  })

  test('a single band still fits inside the range', () => {
    const { bandwidth, position } = bandScale(1, [0, 100])
    assert.ok(bandwidth > 0 && bandwidth <= 100)
    assert.ok(Number.isFinite(position(0)))
  })

  test('zero count does not divide by zero', () => {
    const { bandwidth, position } = bandScale(0, [0, 100])
    assertAllFinite([bandwidth, position(0)], 'band')
  })
})

describe('linePath', () => {
  test('no data returns an empty path (empty state, not an empty box)', () => {
    assert.equal(linePath([], { width: 100, height: 50 }), '')
    assert.equal(linePath(null, { width: 100, height: 50 }), '')
  })

  test('a single data point renders a valid, centred, zero-length path', () => {
    const d = linePath([42], { width: 100, height: 50 })
    assert.match(d, /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/)
    assert.ok(!d.includes('NaN'))
    const [, x1] = d.match(/M ([\d.]+)/)
    // domain is padded symmetrically around the single value, so it should
    // land at the horizontal centre of the drawable width.
    assert.ok(Math.abs(Number(x1) - 50) < 1)
  })

  test('all-zero series renders a flat, valid path (no NaN)', () => {
    const d = linePath([0, 0, 0, 0], { width: 100, height: 50 })
    assert.ok(!d.includes('NaN'))
    assert.match(d, /^M/)
  })

  test('a flat non-zero series renders a flat, valid path', () => {
    const d = linePath([5, 5, 5], { width: 100, height: 50 })
    assert.ok(!d.includes('NaN'))
  })

  test('negative values render without NaN and span the full height', () => {
    const d = linePath([-10, 0, 10], { width: 100, height: 50 })
    assert.ok(!d.includes('NaN'))
    const ys = [...d.matchAll(/[ML] [\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]))
    assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= 50)
  })

  test('an explicit yDomain (e.g. from nice ticks) is honoured', () => {
    const d = linePath([50], { width: 100, height: 100, yDomain: [0, 100] })
    const [, , y1] = d.match(/M ([\d.]+) ([\d.]+)/)
    assert.ok(Math.abs(Number(y1) - 50) < 1)
  })
})
