// Run with: node --test src/recipes/upload/resize.test.mjs
//
// Only the DOM-free pure logic is covered here — file-type validation,
// resize dimension maths, and the localStorage quota arithmetic. Everything
// that touches canvas, createImageBitmap, FileReader, or localStorage itself
// needs a real browser and is not testable with plain `node --test`; verify
// those manually (see the checklist in README.md).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isImageFile, computeTargetSize } from './resize.js'
import { estimateBytes, wouldExceedQuota, LOCAL_BUDGET_BYTES } from './storage.js'

// --- isImageFile -------------------------------------------------------------

test('isImageFile: accepts common image MIME types', () => {
  assert.equal(isImageFile({ type: 'image/jpeg' }), true)
  assert.equal(isImageFile({ type: 'image/png' }), true)
  assert.equal(isImageFile({ type: 'image/webp' }), true)
  assert.equal(isImageFile({ type: 'image/heic' }), true)
})

test('isImageFile: rejects non-image types', () => {
  assert.equal(isImageFile({ type: 'application/pdf' }), false)
  assert.equal(isImageFile({ type: 'text/csv' }), false)
  assert.equal(isImageFile({ type: 'video/mp4' }), false)
})

test('isImageFile: rejects missing, empty, or malformed type without throwing', () => {
  assert.equal(isImageFile({ type: '' }), false)
  assert.equal(isImageFile({ type: undefined }), false)
  assert.equal(isImageFile({}), false)
  assert.equal(isImageFile(null), false)
  assert.equal(isImageFile(undefined), false)
  assert.equal(isImageFile({ type: 42 }), false) // wrong type for `type` itself
})

test('isImageFile: works against a real File object', () => {
  const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
  assert.equal(isImageFile(file), true)
  const doc = new File(['x'], 'receipt.pdf', { type: 'application/pdf' })
  assert.equal(isImageFile(doc), false)
})

// --- computeTargetSize -------------------------------------------------------

test('computeTargetSize: never upscales an image already smaller than maxDim', () => {
  const result = computeTargetSize(400, 300, 1600)
  assert.deepEqual(result, { width: 400, height: 300, scale: 1 })
})

test('computeTargetSize: downscales the longest edge to fit, preserving aspect ratio', () => {
  const result = computeTargetSize(4000, 3000, 1600)
  assert.equal(result.width, 1600)
  assert.equal(result.height, 1200) // 3000 * (1600/4000) = 1200
})

test('computeTargetSize: downscales a portrait (tall) image on its longest edge', () => {
  const result = computeTargetSize(3000, 4000, 1600)
  assert.equal(result.height, 1600)
  assert.equal(result.width, 1200)
})

test('computeTargetSize: square image scales both edges equally', () => {
  const result = computeTargetSize(2000, 2000, 1000)
  assert.deepEqual(result, { width: 1000, height: 1000, scale: 0.5 })
})

test('computeTargetSize: exact match at the boundary does not scale', () => {
  const result = computeTargetSize(1600, 900, 1600)
  assert.equal(result.scale, 1)
  assert.equal(result.width, 1600)
})

test('computeTargetSize: bad input (zero, negative, NaN) returns zeros instead of throwing', () => {
  assert.deepEqual(computeTargetSize(0, 100, 1600), { width: 0, height: 0, scale: 0 })
  assert.deepEqual(computeTargetSize(100, -50, 1600), { width: 0, height: 0, scale: 0 })
  assert.deepEqual(computeTargetSize(NaN, 100, 1600), { width: 0, height: 0, scale: 0 })
  assert.deepEqual(computeTargetSize(100, 100, 0), { width: 0, height: 0, scale: 0 })
})

test('computeTargetSize: rounds to whole pixels and never rounds down to 0', () => {
  const result = computeTargetSize(10000, 3, 1600)
  // Longest edge 10000 -> scale 0.16 -> other edge 3 * 0.16 = 0.48, must clamp to 1, not 0.
  assert.equal(result.width, 1600)
  assert.equal(result.height, 1)
})

// --- estimateBytes / wouldExceedQuota (storage.js quota arithmetic) --------

test('estimateBytes: counts UTF-8 bytes, not JS string length', () => {
  assert.equal(estimateBytes('abc'), 3)
  assert.equal(estimateBytes(''), 0)
  // '🙂' is 1 UTF-16 code unit pair (length 2 in JS) but 4 bytes in UTF-8.
  assert.equal(estimateBytes('🙂'), 4)
})

test('wouldExceedQuota: false when comfortably under budget', () => {
  assert.equal(wouldExceedQuota(1000, 2000, 10_000), false)
})

test('wouldExceedQuota: true once the sum passes budget', () => {
  assert.equal(wouldExceedQuota(9000, 2000, 10_000), true)
})

test('wouldExceedQuota: exact boundary (sum === budget) does not count as exceeding', () => {
  assert.equal(wouldExceedQuota(8000, 2000, 10_000), false)
})

test('wouldExceedQuota: defaults to the exported LOCAL_BUDGET_BYTES when no budget is passed', () => {
  assert.equal(wouldExceedQuota(0, LOCAL_BUDGET_BYTES + 1), true)
  assert.equal(wouldExceedQuota(0, LOCAL_BUDGET_BYTES - 1), false)
})

test('wouldExceedQuota: a single unresized phone photo (~5 MB) blows a fresh 4.5 MB budget', () => {
  const freshPhoto = 5 * 1024 * 1024 // realistic raw JPEG straight off a phone
  assert.equal(wouldExceedQuota(0, freshPhoto, LOCAL_BUDGET_BYTES), true)
})
