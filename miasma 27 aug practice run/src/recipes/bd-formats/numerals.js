/**
 * Bangla <-> Latin digit conversion.
 *
 * WHY THIS EXISTS
 * Bangladeshi users read Bangla numerals (০-৯) as comfortably as Latin ones,
 * and plenty of judges will type a phone number or an amount in Bangla
 * digits without thinking twice about it. An app that only accepts `0-9`
 * looks broken the first time someone pastes ০১৭xxxxxxxx into a field. This
 * module is the single place that maps between the two digit sets so every
 * other file in this recipe (and your app) can normalise input before
 * touching it.
 *
 * Only the ten digit characters are touched — everything else (letters,
 * punctuation, spaces, currency symbols) passes through untouched, so this
 * is safe to run over a whole sentence, not just a bare number.
 */

const LATIN_TO_BANGLA_MAP = {
  0: '০',
  1: '১',
  2: '২',
  3: '৩',
  4: '৪',
  5: '৫',
  6: '৬',
  7: '৭',
  8: '৮',
  9: '৯',
}

const BANGLA_TO_LATIN_MAP = Object.fromEntries(Object.entries(LATIN_TO_BANGLA_MAP).map(([latin, bangla]) => [bangla, latin]))

/**
 * Convert every Latin digit (0-9) in a string to its Bangla equivalent.
 * Non-digit characters (including already-Bangla digits) are left as-is.
 *
 * @param {string | number | null | undefined} input
 * @returns {string}
 */
export function toBanglaDigits(input) {
  const s = input === null || input === undefined ? '' : String(input)
  return s.replace(/[0-9]/g, (d) => LATIN_TO_BANGLA_MAP[d])
}

/**
 * Convert every Bangla digit (০-৯) in a string to its Latin equivalent.
 * Non-digit characters (including already-Latin digits) are left as-is.
 *
 * @param {string | null | undefined} input
 * @returns {string}
 */
export function toLatinDigits(input) {
  const s = input === null || input === undefined ? '' : String(input)
  return s.replace(/[০-৯]/g, (d) => BANGLA_TO_LATIN_MAP[d])
}

/** True if the string contains at least one Bangla digit. Handy for deciding
 *  which keyboard/placeholder a field last saw. */
export function hasBanglaDigits(input) {
  const s = input === null || input === undefined ? '' : String(input)
  return /[০-৯]/.test(s)
}
