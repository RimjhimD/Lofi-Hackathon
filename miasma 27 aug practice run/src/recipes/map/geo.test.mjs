// Run with: node --test geo.test.mjs
// Covers the edge cases that actually break a map on stage: an empty point
// list, a single point (must not zoom to the map's maximum as if it found a
// tight cluster), and points that are identical (a zero-size bounding box).
// Also asserts one real-world distance so a regression in the haversine
// maths itself doesn't slip through.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { distanceKm, withinRadius, boundingBox, defaultView, DEFAULT_CENTER, DEFAULT_ZOOM, SINGLE_POINT_ZOOM } from './geo.js'

// Real coordinates, real cities.
const DHAKA = { lat: 23.8103, lng: 90.4125 }
const CHITTAGONG = { lat: 22.3569, lng: 91.7832 }
const GULSHAN = { lat: 23.7925, lng: 90.4078 } // a few km from Dhaka's centre, still "Dhaka"

describe('distanceKm', () => {
  test('matches the known Dhaka-to-Chittagong great-circle distance', () => {
    // The two city centres are ~210-220km apart in a straight line (the
    // ~264km figure often quoted is the road distance, not this). Assert a
    // real, tight range so a broken formula (e.g. degrees vs radians, or a
    // dropped factor of 2) fails this test instead of just "looking off".
    const d = distanceKm(DHAKA, CHITTAGONG)
    assert.ok(d > 205 && d < 225, `expected ~210-220km, got ${d}`)
  })

  test('distance from a point to itself is zero', () => {
    assert.equal(distanceKm(DHAKA, DHAKA), 0)
  })

  test('is symmetric', () => {
    assert.ok(Math.abs(distanceKm(DHAKA, CHITTAGONG) - distanceKm(CHITTAGONG, DHAKA)) < 1e-9)
  })

  test('a short in-city hop is a small, sane number, not a rounding artifact', () => {
    const d = distanceKm(DHAKA, GULSHAN)
    assert.ok(d > 0 && d < 5, `expected a few km, got ${d}`)
  })

  test('invalid input returns NaN, not a throw', () => {
    assert.ok(Number.isNaN(distanceKm(null, DHAKA)))
    assert.ok(Number.isNaN(distanceKm(DHAKA, undefined)))
    assert.ok(Number.isNaN(distanceKm({ lat: NaN, lng: 1 }, DHAKA)))
  })
})

describe('withinRadius', () => {
  const points = [DHAKA, GULSHAN, CHITTAGONG]

  test('filters to points within the radius, inclusive of the boundary', () => {
    const result = withinRadius(points, DHAKA, 5)
    assert.deepEqual(result, [DHAKA, GULSHAN])
  })

  test('an empty point list returns an empty array, not an error', () => {
    assert.deepEqual(withinRadius([], DHAKA, 100), [])
  })

  test('radius of 0 still matches an identical point', () => {
    assert.deepEqual(withinRadius([DHAKA], DHAKA, 0), [DHAKA])
  })

  test('drops points with missing/invalid coordinates instead of throwing', () => {
    const dirty = [DHAKA, { lat: null, lng: 1 }, { id: 'no-coords' }, GULSHAN]
    assert.deepEqual(withinRadius(dirty, DHAKA, 5), [DHAKA, GULSHAN])
  })

  test('no center or non-finite radius returns an empty array rather than throwing', () => {
    assert.deepEqual(withinRadius(points, null, 5), [])
    assert.deepEqual(withinRadius(points, DHAKA, NaN), [])
  })
})

describe('boundingBox', () => {
  test('an empty list returns null (the empty-state signal)', () => {
    assert.equal(boundingBox([]), null)
    assert.equal(boundingBox(null), null)
    assert.equal(boundingBox(undefined), null)
  })

  test('a single point returns a zero-size box centred on it', () => {
    const box = boundingBox([DHAKA])
    assert.deepEqual(box, { north: DHAKA.lat, south: DHAKA.lat, east: DHAKA.lng, west: DHAKA.lng })
  })

  test('identical points collapse to the same zero-size box as a single point', () => {
    const box = boundingBox([DHAKA, { ...DHAKA }, { ...DHAKA }])
    assert.deepEqual(box, { north: DHAKA.lat, south: DHAKA.lat, east: DHAKA.lng, west: DHAKA.lng })
  })

  test('a real spread produces the correct min/max box', () => {
    const box = boundingBox([DHAKA, CHITTAGONG, GULSHAN])
    assert.equal(box.north, Math.max(DHAKA.lat, CHITTAGONG.lat, GULSHAN.lat))
    assert.equal(box.south, Math.min(DHAKA.lat, CHITTAGONG.lat, GULSHAN.lat))
    assert.equal(box.east, Math.max(DHAKA.lng, CHITTAGONG.lng, GULSHAN.lng))
    assert.equal(box.west, Math.min(DHAKA.lng, CHITTAGONG.lng, GULSHAN.lng))
  })

  test('invalid points are dropped, not counted as (0,0)', () => {
    const box = boundingBox([DHAKA, { lat: 'nope', lng: 1 }])
    assert.deepEqual(box, { north: DHAKA.lat, south: DHAKA.lat, east: DHAKA.lng, west: DHAKA.lng })
  })
})

describe('defaultView', () => {
  test('no data falls back to Dhaka at the default zoom', () => {
    assert.deepEqual(defaultView([]), { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM })
    assert.deepEqual(defaultView(null), { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM })
  })

  test('a single point centres on it at SINGLE_POINT_ZOOM, never the max zoom', () => {
    const view = defaultView([DHAKA])
    assert.deepEqual(view.center, DHAKA)
    assert.equal(view.zoom, SINGLE_POINT_ZOOM)
  })

  test('identical points are treated the same as a single point', () => {
    const view = defaultView([DHAKA, { ...DHAKA }, { ...DHAKA }])
    assert.deepEqual(view.center, DHAKA)
    assert.equal(view.zoom, SINGLE_POINT_ZOOM)
  })

  test('a real spread centres on the bounding-box midpoint at a wider, sane zoom', () => {
    const view = defaultView([DHAKA, CHITTAGONG])
    const box = boundingBox([DHAKA, CHITTAGONG])
    assert.equal(view.center.lat, (box.north + box.south) / 2)
    assert.equal(view.center.lng, (box.east + box.west) / 2)
    // Two cities ~200km apart should zoom out well past "single point" scale.
    assert.ok(view.zoom < SINGLE_POINT_ZOOM)
    assert.ok(view.zoom >= 3)
  })

  test('a very tight but non-identical cluster does not zoom past the single-point cap', () => {
    const tight = [DHAKA, { lat: DHAKA.lat + 0.0001, lng: DHAKA.lng + 0.0001 }]
    const view = defaultView(tight)
    assert.equal(view.zoom, SINGLE_POINT_ZOOM)
  })

  test('mutating the returned view never mutates the module defaults', () => {
    const view = defaultView([])
    view.center.lat = 0
    assert.notEqual(DEFAULT_CENTER.lat, 0)
  })
})
