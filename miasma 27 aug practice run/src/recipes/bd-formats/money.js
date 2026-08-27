/**
 * BDT money formatting — lakh/crore grouping, not Western thousands.
 *
 * WHY THIS EXISTS
 * `Intl.NumberFormat('en-IN', ...)` gets close but is India-flavoured and
 * still a gamble to eyeball under pressure; `toLocaleString('bn-BD')` in
 * Node/browsers does NOT reliably give South Asian digit grouping either.
 * Getting this wrong (৳1,234,567 instead of ৳12,34,567) is worse than not
 * bothering — it reads as "translated at 5am", the exact opposite of the
 * thing this recipe exists to signal.
 *
 * CONVENTION IMPLEMENTED (verified by hand, see README):
 * South Asian / Indian digit grouping, used the same way in Bangladesh:
 * the last THREE digits form one group, then every group before that is
 * TWO digits, all the way to the front.
 *   1,234        -> stays  "1,234"          (only one grouping level fires)
 *   12,345       -> "12,345"
 *   1,23,456     (1.23 lakh)
 *   12,34,567    (12.34 lakh)
 *   1,23,45,678  (1.23 crore)
 *   10,00,00,000 (10 crore)
 * 1 lakh = 1,00,000 (6 digits). 1 crore = 1,00,00,000 (8 digits).
 *
 * Every function here returns a plain value and never throws. Formatters
 * return `null` for input that isn't a finite number (so `{formatBDT(x) ??
 * '—'}` works straight in a template). `parseBDTInput`, the one function
 * that takes untrusted free text, follows the `{ value, error }` shape used
 * elsewhere in this kit (see src/lib/db.js) because a parse failure needs a
 * reason, not just a null.
 */

import { toBanglaDigits, toLatinDigits } from './numerals.js'

/**
 * Group a digit string (no sign, no decimal point) using South Asian
 * lakh/crore grouping: last 3 digits as one group, then pairs of 2 outward.
 * @param {string} digits
 * @returns {string}
 */
function groupSouthAsian(digits) {
  if (digits.length <= 3) return digits
  const last3 = digits.slice(-3)
  let rest = digits.slice(0, -3)
  const groups = []
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2))
    rest = rest.slice(0, -2)
  }
  if (rest.length > 0) groups.unshift(rest)
  return `${groups.join(',')},${last3}`
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

/**
 * Format a number as BDT with South Asian lakh/crore grouping.
 *
 * @param {number} amount - whole taka, or with paisa as a fraction (e.g. 1234.5)
 * @param {object} [opts]
 * @param {'latin'|'bangla'} [opts.numerals='latin'] - digit set for the output
 * @param {boolean} [opts.symbol=true] - prefix with ৳
 * @param {'auto'|number} [opts.decimals='auto'] - 'auto' shows 2 decimals only
 *   when the amount has non-zero paisa; a number forces that many decimal places.
 * @returns {string | null} null if `amount` is not a finite number
 */
export function formatBDT(amount, opts = {}) {
  const { numerals = 'latin', symbol = true, decimals = 'auto' } = opts
  if (!isFiniteNumber(amount)) return null

  const negative = amount < 0
  const abs = Math.abs(amount)

  // Round to paisa first so float noise (0.1 + 0.2 style) never leaks into
  // the output, then decide whether to show the decimal part.
  const rounded = Math.round(abs * 100) / 100
  const wholeStr = Math.trunc(rounded).toString()
  const paise = Math.round((rounded - Math.trunc(rounded)) * 100)

  const showDecimals = decimals === 'auto' ? paise !== 0 : true
  const decimalPlaces = decimals === 'auto' ? 2 : decimals

  let out = groupSouthAsian(wholeStr)
  if (showDecimals && decimalPlaces > 0) {
    out += '.' + paise.toString().padStart(2, '0').slice(0, decimalPlaces).padEnd(decimalPlaces, '0')
  }
  if (symbol) out = '৳' + out
  if (negative) out = '-' + out // sign outermost: "-৳1,234", not "৳-1,234"

  return numerals === 'bangla' ? toBanglaDigits(out) : out
}

const LAKH = 100000
const CRORE = 10000000

/**
 * Compact BDT form for large amounts: "1.2 lakh", "3.4 crore". Below one
 * lakh there's nothing to compact, so this falls back to `formatBDT`.
 *
 * @param {number} amount
 * @param {object} [opts]
 * @param {'latin'|'bangla'} [opts.numerals='latin']
 * @param {boolean} [opts.symbol=true]
 * @param {number} [opts.decimalPlaces=1]
 * @returns {string | null}
 */
export function formatCompactBDT(amount, opts = {}) {
  const { numerals = 'latin', symbol = true, decimalPlaces = 1 } = opts
  if (!isFiniteNumber(amount)) return null

  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  const prefix = symbol ? '৳' : ''

  let out
  if (abs >= CRORE) {
    out = `${sign}${prefix}${(abs / CRORE).toFixed(decimalPlaces)} crore`
  } else if (abs >= LAKH) {
    out = `${sign}${prefix}${(abs / LAKH).toFixed(decimalPlaces)} lakh`
  } else {
    return formatBDT(amount, opts)
  }

  return numerals === 'bangla' ? toBanglaDigits(out) : out
}

/**
 * Parse a user-typed BDT amount back into a number. Accepts the ৳ symbol,
 * South Asian OR Western comma grouping (grouping is stripped, not
 * validated — a mistyped comma shouldn't block a form submit), Bangla
 * digits, a leading minus, and a "lakh"/"crore" (or "lac"/"cr") word or
 * unit suffix, e.g. "৳১২,৩৪,৫৬৭.৫০", "-1,200.50", "3.4 crore", "2 lakh".
 *
 * @param {string} input
 * @returns {{ value: number | null, error: string | null }}
 */
export function parseBDTInput(input) {
  if (input === null || input === undefined) return { value: null, error: 'No input given.' }
  const raw = String(input).trim()
  if (raw === '') return { value: null, error: 'Empty input.' }

  let s = toLatinDigits(raw)
    .replace(/৳/g, '')
    .trim()

  let multiplier = 1
  if (/(^|\s)(crore|cr)\b/i.test(s)) {
    multiplier = CRORE
    s = s.replace(/(crore|cr)\b/i, '')
  } else if (/(^|\s)(lakh|lac|l)\b/i.test(s)) {
    multiplier = LAKH
    s = s.replace(/(lakh|lac|l)\b/i, '')
  }

  s = s.replace(/,/g, '').trim()

  if (s === '' || s === '-') return { value: null, error: 'No digits found in input.' }
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    return { value: null, error: `"${raw}" is not a recognizable amount.` }
  }

  const value = Number(s) * multiplier
  if (!Number.isFinite(value)) return { value: null, error: `"${raw}" is out of range.` }

  return { value, error: null }
}
