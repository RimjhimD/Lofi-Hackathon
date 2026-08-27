/**
 * Bangladeshi mobile number validation and normalisation.
 *
 * WHY THIS EXISTS
 * A form that rejects `017-1234-5678` or `+880 1712 345678` because it only
 * accepts one exact shape loses a real user in the first ten seconds. People
 * paste numbers from contacts apps, WhatsApp, and spreadsheets — spaces,
 * dashes, a leading `+880`, or none of that. This module accepts what people
 * actually type, normalises it to E.164 for storage/SMS APIs, and identifies
 * the operator from the prefix, which BD users expect to see (skin-in-the-
 * game signal: "own SIM, not a demo number").
 *
 * A BD mobile number is 11 digits in local form: `01` + one operator digit
 * (3-9) + 8 more digits. Country code is `+880`; dropping the leading `0`
 * from the local form and prefixing `+880` gives E.164.
 */

import { toLatinDigits } from './numerals.js'

const OPERATORS = {
  3: 'Grameenphone',
  7: 'Grameenphone',
  4: 'Banglalink',
  9: 'Banglalink',
  8: 'Robi',
  6: 'Airtel',
  5: 'Teletalk',
}

/**
 * @param {string} raw
 * @returns {{ valid: boolean, e164: string|null, local: string|null, operator: string|null, reason: string|null }}
 */
export function normalizeBDPhone(raw) {
  const fail = (reason) => ({ valid: false, e164: null, local: null, operator: null, reason })

  if (raw === null || raw === undefined) return fail('No number given.')
  const s = String(raw).trim()
  if (s === '') return fail('Empty input.')

  // Accept Bangla digits, then strip everything that isn't a digit (spaces,
  // dashes, dots, parens). A leading "+" is meaningful (explicit country
  // code) but isn't a digit, so it's just dropped along with the rest —
  // its presence or absence doesn't change how the digit string is read.
  const digits = toLatinDigits(s).replace(/\D/g, '')

  if (digits === '') return fail('No digits found in input.')

  let subscriber // 10 digits: 1 + operator-digit + 8
  if (digits.length === 13 && digits.startsWith('880')) {
    subscriber = digits.slice(3)
  } else if (digits.length === 11 && digits.startsWith('0')) {
    subscriber = digits.slice(1)
  } else if (digits.length === 10 && digits.startsWith('1')) {
    // Bare subscriber number with no leading 0 and no country code — a
    // common paste artifact from spreadsheets that strip leading zeros.
    subscriber = digits
  } else {
    return fail(
      `Wrong length for a Bangladeshi mobile number (got ${digits.length} digit${digits.length === 1 ? '' : 's'}, expected 11 with a leading 0, 13 with 880, or 10 bare).`,
    )
  }

  if (subscriber[0] !== '1') {
    return fail('Does not look like a Bangladeshi mobile number (mobile numbers are 01xxxxxxxxx; this looks like a landline or other line).')
  }

  const operatorDigit = subscriber[1]
  const operator = OPERATORS[operatorDigit]
  if (!operator) {
    return fail(`"01${operatorDigit}" is not a recognised mobile operator prefix (looks like a landline or invalid number).`)
  }

  return {
    valid: true,
    e164: `+880${subscriber}`,
    local: `0${subscriber}`,
    operator,
    reason: null,
  }
}

/** Convenience boolean wrapper around normalizeBDPhone, for a quick check. */
export function isValidBDPhone(raw) {
  return normalizeBDPhone(raw).valid
}
