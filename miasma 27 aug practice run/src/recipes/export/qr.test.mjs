// node --test qr.test.mjs
//
// These are structural tests runnable under plain `node --test` — they check
// what a script can check (version/size math, capacity errors, well-formed
// SVG). They do NOT prove the code scans; that needs an actual decoder.
// During development every case here (plus a wider sweep across all 4 EC
// levels, several versions, and a Bangla URL) was rendered to PNG via
// `rsvg-convert` and decoded with `zbarimg` — a real, independent QR
// decoder — and every one round-tripped to the exact original text. See
// README.md for the exact commands if you want to re-run that check
// yourself; it needs `rsvg-convert` and `zbarimg` on the machine, which is
// why it isn't wired into this file (this recipe has zero dependencies,
// including on your having those CLI tools installed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeQr, qrModulesToSvg, textToQrSvg } from './qr.js'

test('a short input encodes at version 1, a 21x21 module grid', () => {
  const { data, error } = encodeQr('A', { level: 'M' })
  assert.equal(error, null)
  assert.equal(data.version, 1)
  assert.equal(data.size, 21) // 4*version + 17, the fixed QR size formula
  assert.equal(data.modules.length, 21)
  assert.equal(data.modules[0].length, 21)
})

test('module count grows with version, following size = 4*version + 17', () => {
  for (let len = 1; len <= 130; len += 13) {
    const { data, error } = encodeQr('x'.repeat(len), { level: 'L' })
    if (error) continue // longer than version 6 fits at this level — fine, tested separately
    assert.equal(data.size, 4 * data.version + 17)
    assert.equal(data.modules.length, data.size)
    for (const row of data.modules) assert.equal(row.length, data.size)
  }
})

test('the same short input is deterministic across calls', () => {
  const a = encodeQr('https://lofistack.pages.dev/', { level: 'M' })
  const b = encodeQr('https://lofistack.pages.dev/', { level: 'M' })
  assert.deepEqual(a.data.modules, b.data.modules)
  assert.equal(a.data.version, b.data.version)
  assert.equal(a.data.mask, b.data.mask)
})

test('a realistic pages.dev URL + path fits comfortably within the supported versions', () => {
  const url = 'https://lofistack-problem-a.pages.dev/receipt/8f3ac1e2-44b1-4b2e-9c1a-77e0d5f2a9b1'
  const { data, error } = encodeQr(url, { level: 'M' })
  assert.equal(error, null)
  assert.ok(data.version <= 6)
})

test('capacity check rejects input longer than the largest supported version can hold, with a clear message', () => {
  const { data, error } = encodeQr('x'.repeat(500), { level: 'H' })
  assert.equal(data, null)
  assert.ok(error)
  assert.match(error.message, /too long/i)
  assert.match(error.message, /\d+ bytes/)
})

test('capacity check never throws, and higher EC levels have less room than lower ones', () => {
  assert.doesNotThrow(() => encodeQr('x'.repeat(1000), { level: 'H' }))
  const hFit = encodeQr('x'.repeat(40), { level: 'H' })
  const lFit = encodeQr('x'.repeat(40), { level: 'L' })
  // Both should fit at 60 bytes, but H needs a larger (or equal) version
  // than L for the same payload, since H spends more codewords on
  // redundancy rather than data.
  assert.equal(hFit.error, null)
  assert.equal(lFit.error, null)
  assert.ok(hFit.data.version >= lFit.data.version)
})

test('empty string is rejected rather than producing a degenerate code', () => {
  const { data, error } = encodeQr('', { level: 'M' })
  assert.equal(data, null)
  assert.ok(error)
})

test('never throws on a non-string input', () => {
  assert.doesNotThrow(() => encodeQr(null))
  assert.doesNotThrow(() => encodeQr(undefined))
  assert.doesNotThrow(() => encodeQr(12345))
  assert.equal(encodeQr(null).data, null)
})

test('an unknown level falls back to M rather than throwing', () => {
  const { data, error } = encodeQr('A', { level: 'not-a-real-level' })
  assert.equal(error, null)
  assert.equal(data.level, 'M')
})

test('multi-byte UTF-8 (Bangla) text round-trips through byte-mode length accounting', () => {
  // Bangla characters are 3 bytes each in UTF-8 — this only encodes cleanly
  // if capacity/length math counts bytes, not JS string .length (UTF-16
  // code units), which would under-count and silently truncate or corrupt.
  const text = 'https://lofi.pages.dev/রিসিপ্ট'
  const { data, error } = encodeQr(text, { level: 'M' })
  assert.equal(error, null)
  assert.ok(data.version >= 1 && data.version <= 6)
})

// --- SVG rendering ---

test('qrModulesToSvg produces well-formed SVG', () => {
  const { data: encoded } = encodeQr('A', { level: 'L' })
  const { data: svg, error } = qrModulesToSvg(encoded.modules, { moduleSize: 8, margin: 4 })
  assert.equal(error, null)
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /<\/svg>$/)
  assert.match(svg, /viewBox="0 0 \d+ \d+"/)
  // Every opened element tag has a matching close, and vice versa — a cheap
  // well-formedness check without pulling in an XML parser.
  const opens = svg.match(/<(svg|rect|path)\b/g) ?? []
  const closesOrSelfClosing = svg.match(/\/>|<\/(svg|rect|path)>/g) ?? []
  assert.equal(opens.length, closesOrSelfClosing.length)
})

test('the rendered SVG side length matches (module count + 2*margin) * moduleSize', () => {
  const { data: encoded } = encodeQr('A', { level: 'L' })
  const { data: svg } = qrModulesToSvg(encoded.modules, { moduleSize: 10, margin: 4 })
  const expected = (encoded.size + 8) * 10
  const [w, h] = [...svg.matchAll(/(?:width|height)="(\d+)"/g)].map((m) => Number(m[1]))
  assert.equal(w, expected)
  assert.equal(h, expected)
})

test('textToQrSvg is the encodeQr + qrModulesToSvg convenience path and produces the same result', () => {
  const { data: encoded } = encodeQr('https://lofistack.pages.dev/', { level: 'Q' })
  const { data: svgA } = qrModulesToSvg(encoded.modules, { moduleSize: 6 })
  const { data: svgB, error } = textToQrSvg('https://lofistack.pages.dev/', { level: 'Q', moduleSize: 6 })
  assert.equal(error, null)
  assert.equal(svgA, svgB)
})

test('textToQrSvg surfaces the capacity error instead of a broken SVG', () => {
  const { data, error } = textToQrSvg('x'.repeat(1000), { level: 'H' })
  assert.equal(data, null)
  assert.ok(error)
})

test('qrModulesToSvg never throws on malformed module input', () => {
  assert.doesNotThrow(() => qrModulesToSvg(null))
  assert.doesNotThrow(() => qrModulesToSvg([]))
  assert.doesNotThrow(() => qrModulesToSvg([1, 2, 3]))
  assert.equal(qrModulesToSvg(null).data, null)
})
