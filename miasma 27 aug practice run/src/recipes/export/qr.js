/**
 * QR code encoder — Model 2, byte mode, versions 1-6, SVG output.
 *
 * WHY THIS EXISTS
 * A QR code on screen that a judge scans with their own phone to open the
 * live app is one of the cheapest, most convincing demo moves there is. Every
 * "just pull it from a CDN" option either needs a network call at demo time
 * (dead if the venue wifi drops) or a new dependency. So this is a real,
 * from-scratch implementation of the QR spec: Reed-Solomon error correction
 * over GF(256), the actual module-placement algorithm, mask selection by the
 * ISO penalty rules, format-info BCH encoding — not a lookup of pre-rendered
 * codes and not a wrapper around anyone else's package.
 *
 * Scope: byte mode only (fine for a URL — the only thing this recipe is
 * really for), versions 1-6. Version 6 at error-correction level L holds up
 * to 134 bytes, which comfortably covers a `*.pages.dev` URL plus a path.
 * Versions 7+ need an additional 18-bit "version information" block on top
 * of everything below; skipping it keeps this file small enough to actually
 * get right and verify, rather than shipping something plausible-looking
 * that fails to scan. If your payload doesn't fit, `encodeQr` returns a
 * clear `{ data: null, error }` — never a corrupt code.
 *
 * Verified against a real decoder, not just "it runs": every code this
 * module can produce (all 6 versions x all 4 EC levels x a range of payload
 * lengths) was rendered to PNG and round-tripped through `zbarimg` during
 * development. See qr.test.mjs for the structural tests that run under
 * `node --test`; the zbar round-trip itself needs system tools this repo
 * doesn't depend on, so it isn't part of the automated suite, but the
 * generator has not changed since that verification passed.
 *
 * Never throws. Returns { data, error }, same convention as src/lib/db.js.
 */

// --- Galois Field GF(256), primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d) ---

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
;(function initGaloisField() {
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
})()

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

/** Multiply two GF(256) polynomials, coefficients highest-degree first. */
function polyMul(a, b) {
  const result = new Array(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      result[i + j] ^= gfMul(a[i], b[j])
    }
  }
  return result
}

/** The Reed-Solomon generator polynomial for `degree` EC codewords. */
function rsGeneratorPoly(degree) {
  let g = [1]
  for (let i = 0; i < degree; i++) {
    g = polyMul(g, [1, GF_EXP[i]])
  }
  return g
}

/** EC codewords for one block of data codewords, via polynomial long division in GF(256). */
function rsComputeEcCodewords(dataCodewords, ecCount) {
  const generator = rsGeneratorPoly(ecCount) // length ecCount + 1, generator[0] === 1
  const remainder = new Array(ecCount).fill(0)
  for (const d of dataCodewords) {
    const factor = d ^ remainder[0]
    for (let i = 0; i < ecCount - 1; i++) {
      remainder[i] = remainder[i + 1] ^ gfMul(generator[i + 1], factor)
    }
    remainder[ecCount - 1] = gfMul(generator[ecCount], factor)
  }
  return remainder
}

// --- Per-version tables (versions 1-6 only — see file header) ---

// Error-correction block structure. `groups` is [[blockCount, dataCodewordsPerBlock], ...].
// Table 9 of ISO/IEC 18004. Cross-checked internally: for every row,
// sum(blockCount * (dataLen + ec)) equals the version's fixed total codeword
// count (26/44/70/100/134/172 for versions 1-6), which only holds if both the
// EC counts and the group split are correct together.
const RS_BLOCKS = {
  1: { L: { ec: 7, groups: [[1, 19]] }, M: { ec: 10, groups: [[1, 16]] }, Q: { ec: 13, groups: [[1, 13]] }, H: { ec: 17, groups: [[1, 9]] } },
  2: { L: { ec: 10, groups: [[1, 34]] }, M: { ec: 16, groups: [[1, 28]] }, Q: { ec: 22, groups: [[1, 22]] }, H: { ec: 28, groups: [[1, 16]] } },
  3: { L: { ec: 15, groups: [[1, 55]] }, M: { ec: 26, groups: [[1, 44]] }, Q: { ec: 18, groups: [[2, 17]] }, H: { ec: 22, groups: [[2, 13]] } },
  4: { L: { ec: 20, groups: [[1, 80]] }, M: { ec: 18, groups: [[2, 32]] }, Q: { ec: 26, groups: [[2, 24]] }, H: { ec: 16, groups: [[4, 9]] } },
  5: { L: { ec: 26, groups: [[1, 108]] }, M: { ec: 24, groups: [[2, 43]] }, Q: { ec: 18, groups: [[2, 15], [2, 16]] }, H: { ec: 22, groups: [[2, 11], [2, 12]] } },
  6: { L: { ec: 18, groups: [[2, 68]] }, M: { ec: 16, groups: [[4, 27]] }, Q: { ec: 24, groups: [[4, 19]] }, H: { ec: 28, groups: [[4, 15]] } },
}

// Alignment pattern center coordinates (used as both row and column, in every
// combination except the three that overlap a finder pattern). None for v1.
const ALIGNMENT_POSITIONS = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] }

// Extra zero-bits appended after all codewords, before drawing — versions 1-6 only.
const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7 }

const EC_LEVELS = ['L', 'M', 'Q', 'H']
const FORMAT_LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 } // ISO/IEC 18004 Table 25

const MAX_VERSION = 6

// --- Bit stream helpers ---

function appendBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
}

/** Build the padded, EC-block-sized data codeword list for one version+level, or null if it doesn't fit. */
function buildDataCodewords(bytes, version, level) {
  const block = RS_BLOCKS[version][level]
  const totalDataCodewords = block.groups.reduce((sum, [count, len]) => sum + count * len, 0)
  const capacityBits = totalDataCodewords * 8

  const bits = []
  appendBits(bits, 0b0100, 4) // byte-mode indicator
  appendBits(bits, bytes.length, 8) // character count indicator is 8 bits for versions 1-9
  for (const b of bytes) appendBits(bits, b, 8)

  if (bits.length > capacityBits) return null

  const terminatorLen = Math.min(4, capacityBits - bits.length)
  for (let i = 0; i < terminatorLen; i++) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)

  const codewords = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]
    codewords.push(byte)
  }

  const padBytes = [0xec, 0x11]
  let p = 0
  while (codewords.length < totalDataCodewords) {
    codewords.push(padBytes[p % 2])
    p++
  }

  return codewords
}

/** Split data codewords into per-block groups, run Reed-Solomon, interleave data then EC. */
function buildFinalCodewords(dataCodewords, version, level) {
  const block = RS_BLOCKS[version][level]
  const blocks = []
  let offset = 0
  for (const [count, len] of block.groups) {
    for (let i = 0; i < count; i++) {
      const data = dataCodewords.slice(offset, offset + len)
      offset += len
      const ec = rsComputeEcCodewords(data, block.ec)
      blocks.push({ data, ec })
    }
  }

  const final = []
  const maxDataLen = Math.max(...blocks.map((b) => b.data.length))
  for (let i = 0; i < maxDataLen; i++) {
    for (const b of blocks) if (i < b.data.length) final.push(b.data[i])
  }
  for (let i = 0; i < block.ec; i++) {
    for (const b of blocks) final.push(b.ec[i])
  }
  return final
}

// --- Format info (15-bit BCH(15,5), generator 0x537, mask 0x5412 — ISO/IEC 18004 Annex C) ---

function computeFormatBits(level, mask) {
  const data = (FORMAT_LEVEL_BITS[level] << 3) | mask
  let rem = data << 10
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10)
  }
  return ((data << 10) | rem) ^ 0x5412
}

// --- Matrix construction ---

function makeMatrix(version, level, dataCodewords) {
  const size = version * 4 + 17
  const dark = Array.from({ length: size }, () => new Array(size).fill(false))
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false))

  function set(r, c, value) {
    dark[r][c] = value
    isFunction[r][c] = true
  }

  function drawFinder(r0, c0) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr
        const c = c0 + dc
        if (r < 0 || r >= size || c < 0 || c >= size) continue
        let value = false
        if (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6) {
          const onOuterRing = dr === 0 || dr === 6 || dc === 0 || dc === 6
          const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4
          value = onOuterRing || inCenter
        }
        set(r, c, value)
      }
    }
  }
  drawFinder(0, 0)
  drawFinder(0, size - 7)
  drawFinder(size - 7, 0)

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isFunction[6][i]) set(6, i, i % 2 === 0)
    if (!isFunction[i][6]) set(i, 6, i % 2 === 0)
  }

  // Alignment patterns — skip the three combinations that would overlap a finder pattern.
  const positions = ALIGNMENT_POSITIONS[version]
  const first = positions[0]
  const last = positions[positions.length - 1]
  for (const r of positions) {
    for (const c of positions) {
      if ((r === first && c === first) || (r === first && c === last) || (r === last && c === first)) continue
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const value = Math.max(Math.abs(dr), Math.abs(dc)) !== 1
          set(r + dr, c + dc, value)
        }
      }
    }
  }

  // Reserve format-info areas (drawn for real after masking, once the mask is chosen).
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      isFunction[8][i] = true
      isFunction[i][8] = true
    }
  }
  for (let i = size - 8; i < size; i++) {
    isFunction[8][i] = true
    isFunction[i][8] = true
  }

  // Dark module — always on, at (row 8, col 4*version + 9).
  set(8, 4 * version + 9, true)

  // Data placement: zigzag in 2-module-wide columns from the bottom-right,
  // alternating direction, skipping the vertical timing column entirely.
  const bits = []
  for (const byte of dataCodewords) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1)
  for (let i = 0; i < REMAINDER_BITS[version]; i++) bits.push(0)

  let bitIndex = 0
  let upward = true
  for (let colPair = size - 1; colPair > 0; colPair -= 2) {
    if (colPair === 6) colPair-- // never place data in the timing column
    const rowRange = upward ? range(size - 1, -1, -1) : range(0, size, 1)
    for (const row of rowRange) {
      for (const col of [colPair, colPair - 1]) {
        if (isFunction[row][col]) continue
        dark[row][col] = bitIndex < bits.length ? bits[bitIndex] === 1 : false
        bitIndex++
      }
    }
    upward = !upward
  }

  return { size, dark, isFunction }
}

function range(start, end, step) {
  const out = []
  for (let i = start; i !== end; i += step) out.push(i)
  return out
}

function applyMask(matrix, maskId) {
  const { size, dark, isFunction } = matrix
  const maskFn = MASK_FNS[maskId]
  const masked = dark.map((row) => row.slice())
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isFunction[r][c]) continue
      if (maskFn(r, c)) masked[r][c] = !masked[r][c]
    }
  }
  return masked
}

const MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
]

/** ISO/IEC 18004 Annex D penalty score — lower is better. Only affects which of the 8 valid masks is chosen, never correctness. */
function penaltyScore(size, grid) {
  let score = 0

  // Rule 1: runs of 5+ same-color modules in a row or column.
  const scoreLine = (get) => {
    let runColor = null
    let runLen = 0
    for (let i = 0; i < size; i++) {
      const v = get(i)
      if (v === runColor) {
        runLen++
      } else {
        if (runLen >= 5) score += 3 + (runLen - 5)
        runColor = v
        runLen = 1
      }
    }
    if (runLen >= 5) score += 3 + (runLen - 5)
  }
  for (let r = 0; r < size; r++) scoreLine((c) => grid[r][c])
  for (let c = 0; c < size; c++) scoreLine((r) => grid[r][c])

  // Rule 2: 2x2 blocks of the same color.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = grid[r][c]
      if (grid[r][c + 1] === v && grid[r + 1][c] === v && grid[r + 1][c + 1] === v) score += 3
    }
  }

  // Rule 4: overall dark-module ratio deviation from 50%, in 5% steps.
  let darkCount = 0
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r][c]) darkCount++
  const percentDark = (darkCount / (size * size)) * 100
  score += Math.floor(Math.abs(percentDark - 50) / 5) * 10

  return score
}

function drawFormatInfo(matrix, level, maskId) {
  const { size, dark } = matrix
  const bits = computeFormatBits(level, maskId)
  // Placement position i=0 holds the MOST significant bit of the 15-bit
  // value (i.e. the top bit of the level+mask field), not the least — the
  // reverse of the natural (bits >> i) reading. Getting this backwards
  // produces a matrix that still round-trips through this file's own
  // inverse logic (so a self-check misses it) but is unreadable by any
  // real decoder, since it derives a different, wrong mask/level.
  const bit = (i) => (bits >> (14 - i)) & 1

  // Copy A — around the top-left finder.
  for (let i = 0; i <= 5; i++) dark[8][i] = bit(i) === 1
  dark[8][7] = bit(6) === 1
  dark[8][8] = bit(7) === 1
  dark[7][8] = bit(8) === 1
  for (let i = 9; i <= 14; i++) dark[14 - i][8] = bit(i) === 1

  // Copy B — split between the bottom-left and top-right finders.
  for (let i = 0; i <= 7; i++) dark[size - 1 - i][8] = bit(i) === 1
  for (let i = 8; i <= 14; i++) dark[8][size - 15 + i] = bit(i) === 1
}

// --- Public API ---

/**
 * Encode `text` as a QR code. Picks the smallest version (1-6) that fits at
 * the requested error-correction level, then the best-scoring mask.
 *
 * @param {string} text
 * @param {{ level?: 'L'|'M'|'Q'|'H' }} [options]
 * @returns {{ data: { version: number, size: number, level: string, mask: number, modules: boolean[][] } | null, error: { message: string } | null }}
 */
export function encodeQr(text, options = {}) {
  try {
    if (typeof text !== 'string' || text.length === 0) {
      return { data: null, error: { message: 'Nothing to encode — text is empty.' } }
    }
    const level = EC_LEVELS.includes(options.level) ? options.level : 'M'
    const bytes = Array.from(new TextEncoder().encode(text))

    let version = null
    let dataCodewords = null
    for (let v = 1; v <= MAX_VERSION; v++) {
      const codewords = buildDataCodewords(bytes, v, level)
      if (codewords) {
        version = v
        dataCodewords = codewords
        break
      }
    }

    if (version === null) {
      const maxCodewords = RS_BLOCKS[MAX_VERSION][level].groups.reduce((sum, [count, len]) => sum + count * len, 0)
      const maxBytes = Math.max(0, Math.floor((maxCodewords * 8 - 12) / 8))
      return {
        data: null,
        error: {
          message: `Too long to encode at level ${level}: ${bytes.length} bytes, max is ${maxBytes} bytes (QR version ${MAX_VERSION}). Try a shorter URL, or pass { level: 'L' } for more room.`,
        },
      }
    }

    const finalCodewords = buildFinalCodewords(dataCodewords, version, level)
    const base = makeMatrix(version, level, finalCodewords)

    let bestMask = 0
    let bestScore = Infinity
    let bestGrid = null
    for (let m = 0; m < 8; m++) {
      const grid = applyMask(base, m)
      const score = penaltyScore(base.size, grid)
      if (score < bestScore) {
        bestScore = score
        bestMask = m
        bestGrid = grid
      }
    }

    const final = { size: base.size, dark: bestGrid, isFunction: base.isFunction }
    drawFormatInfo(final, level, bestMask)

    return {
      data: { version, size: final.size, level, mask: bestMask, modules: final.dark },
      error: null,
    }
  } catch (e) {
    return { data: null, error: { message: e?.message || 'Could not build a QR code for this input.' } }
  }
}

/**
 * Render an already-encoded matrix (from `encodeQr`) as an SVG string.
 *
 * @param {boolean[][]} modules
 * @param {{ moduleSize?: number, margin?: number, foreground?: string, background?: string }} [options]
 * @returns {{ data: string | null, error: { message: string } | null }}
 */
export function qrModulesToSvg(modules, options = {}) {
  try {
    if (!Array.isArray(modules) || modules.length === 0 || !Array.isArray(modules[0])) {
      return { data: null, error: { message: 'No QR modules to render.' } }
    }
    const size = modules.length
    const moduleSize = Number.isFinite(options.moduleSize) ? options.moduleSize : 8
    const margin = Number.isFinite(options.margin) ? options.margin : 4 // quiet zone, in modules — the spec asks for >= 4
    const fg = options.foreground || '#000000'
    const bg = options.background || '#ffffff'

    const total = (size + margin * 2) * moduleSize
    let path = ''
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!modules[r][c]) continue
        const x = (c + margin) * moduleSize
        const y = (r + margin) * moduleSize
        path += `M${x},${y}h${moduleSize}v${moduleSize}h${-moduleSize}z`
      }
    }

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total}" height="${total}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
      `<rect width="${total}" height="${total}" fill="${bg}"/>` +
      (path ? `<path d="${path}" fill="${fg}"/>` : '') +
      `</svg>`

    return { data: svg, error: null }
  } catch (e) {
    return { data: null, error: { message: e?.message || 'Could not render this QR code.' } }
  }
}

/**
 * Encode `text` straight to an SVG string. Convenience wrapper over
 * `encodeQr` + `qrModulesToSvg` for the common case.
 *
 * @param {string} text
 * @param {{ level?: 'L'|'M'|'Q'|'H', moduleSize?: number, margin?: number, foreground?: string, background?: string }} [options]
 */
export function textToQrSvg(text, options = {}) {
  const { data: encoded, error } = encodeQr(text, options)
  if (error) return { data: null, error }
  return qrModulesToSvg(encoded.modules, options)
}
