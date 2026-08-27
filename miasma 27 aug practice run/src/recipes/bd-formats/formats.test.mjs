// node --test formats.test.mjs
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { toBanglaDigits, toLatinDigits, hasBanglaDigits } from './numerals.js'
import { formatBDT, formatCompactBDT, parseBDTInput } from './money.js'
import { normalizeBDPhone, isValidBDPhone } from './phone.js'
import { formatTime, formatDate, relativeLabel, formatRelativeDateTime } from './datetime.js'

// ---------------------------------------------------------------------------
// numerals.js
// ---------------------------------------------------------------------------

describe('numerals: toBanglaDigits / toLatinDigits', () => {
  test('converts every Latin digit to Bangla', () => {
    assert.equal(toBanglaDigits('0123456789'), '০১২৩৪৫৬৭৮৯')
  })

  test('converts every Bangla digit to Latin', () => {
    assert.equal(toLatinDigits('০১২৩৪৫৬৭৮৯'), '0123456789')
  })

  test('round-trips', () => {
    const s = '4207'
    assert.equal(toLatinDigits(toBanglaDigits(s)), s)
  })

  test('non-digit characters are left untouched', () => {
    assert.equal(toBanglaDigits('Room 12, Floor-4!'), 'Room ১২, Floor-৪!')
    assert.equal(toLatinDigits('কক্ষ ১২, তলা-৪!'), 'কক্ষ 12, তলা-4!')
  })

  test('mixed Bangla and Latin digits in one string', () => {
    assert.equal(toLatinDigits('017১২৩45৬৭৮'), '01712345678')
    assert.equal(toBanglaDigits('017১২৩45৬৭৮'), '০১৭১২৩৪৫৬৭৮')
  })

  test('empty input', () => {
    assert.equal(toBanglaDigits(''), '')
    assert.equal(toLatinDigits(''), '')
  })

  test('null/undefined input does not throw', () => {
    assert.equal(toBanglaDigits(null), '')
    assert.equal(toBanglaDigits(undefined), '')
    assert.equal(toLatinDigits(null), '')
  })

  test('accepts a number, not just a string', () => {
    assert.equal(toBanglaDigits(2026), '২০২৬')
  })

  test('hasBanglaDigits', () => {
    assert.equal(hasBanglaDigits('০১৭'), true)
    assert.equal(hasBanglaDigits('017'), false)
    assert.equal(hasBanglaDigits(''), false)
  })
})

// ---------------------------------------------------------------------------
// money.js — lakh/crore grouping is the make-or-break piece
// ---------------------------------------------------------------------------

describe('money: formatBDT grouping boundaries (5, 6, 7, 8 digits)', () => {
  test('5 digits: only one grouping level fires', () => {
    assert.equal(formatBDT(12345, { decimals: 0 }), '৳12,345')
  })

  test('6 digits: crosses into 1 lakh grouping', () => {
    assert.equal(formatBDT(123456, { decimals: 0 }), '৳1,23,456')
  })

  test('exactly 1 lakh (100000)', () => {
    assert.equal(formatBDT(100000, { decimals: 0 }), '৳1,00,000')
  })

  test('7 digits', () => {
    assert.equal(formatBDT(1234567, { decimals: 0 }), '৳12,34,567')
  })

  test('8 digits', () => {
    assert.equal(formatBDT(12345678, { decimals: 0 }), '৳1,23,45,678')
  })

  test('exactly 1 crore (10000000)', () => {
    assert.equal(formatBDT(10000000, { decimals: 0 }), '৳1,00,00,000')
  })

  test('4 digits and below: identical to Western grouping (nothing to disambiguate)', () => {
    assert.equal(formatBDT(1234, { decimals: 0 }), '৳1,234')
    assert.equal(formatBDT(999, { decimals: 0 }), '৳999')
  })

  test('very large value keeps grouping in pairs all the way to the front', () => {
    assert.equal(formatBDT(123456789012, { decimals: 0 }), '৳1,23,45,67,89,012')
  })
})

describe('money: formatBDT must-handle cases', () => {
  test('zero', () => {
    assert.equal(formatBDT(0), '৳0')
  })

  test('negative amount', () => {
    assert.equal(formatBDT(-1234), '-৳1,234')
    assert.equal(formatBDT(-100000), '-৳1,00,000')
  })

  test('non-integer paisa: shown when present, rounded to 2 places', () => {
    assert.equal(formatBDT(1234.5), '৳1,234.50')
    assert.equal(formatBDT(1234.567), '৳1,234.57')
  })

  test('non-integer paisa: omitted by default when the amount is a whole number', () => {
    assert.equal(formatBDT(1234.0), '৳1,234')
  })

  test('forced decimals option always shows the decimal part', () => {
    assert.equal(formatBDT(1234, { decimals: 2 }), '৳1,234.00')
  })

  test('very large value does not lose precision or throw', () => {
    assert.doesNotThrow(() => formatBDT(999999999999))
    assert.equal(formatBDT(999999999999, { decimals: 0 }), '৳9,99,99,99,99,999')
  })

  test('Bangla numerals output', () => {
    assert.equal(formatBDT(123456, { numerals: 'bangla', decimals: 0 }), '৳১,২৩,৪৫৬')
    assert.equal(formatBDT(-1234.5, { numerals: 'bangla' }), '-৳১,২৩৪.৫০')
  })

  test('symbol can be suppressed', () => {
    assert.equal(formatBDT(1234, { symbol: false, decimals: 0 }), '1,234')
  })

  test('invalid input returns null, never throws', () => {
    assert.doesNotThrow(() => formatBDT(NaN))
    assert.equal(formatBDT(NaN), null)
    assert.equal(formatBDT(Infinity), null)
    assert.equal(formatBDT('not a number'), null)
    assert.equal(formatBDT(undefined), null)
    assert.equal(formatBDT(null), null)
  })
})

describe('money: formatCompactBDT', () => {
  test('below 1 lakh falls back to full grouped form', () => {
    assert.equal(formatCompactBDT(45000), '৳45,000')
  })

  test('lakh range', () => {
    assert.equal(formatCompactBDT(150000), '৳1.5 lakh')
    assert.equal(formatCompactBDT(120000), '৳1.2 lakh')
  })

  test('crore range', () => {
    assert.equal(formatCompactBDT(34000000), '৳3.4 crore')
  })

  test('negative compact amount', () => {
    assert.equal(formatCompactBDT(-150000), '-৳1.5 lakh')
  })

  test('Bangla numerals in compact form', () => {
    assert.equal(formatCompactBDT(150000, { numerals: 'bangla' }), '৳১.৫ lakh')
  })

  test('invalid input returns null', () => {
    assert.equal(formatCompactBDT(NaN), null)
  })
})

describe('money: parseBDTInput', () => {
  test('plain number string', () => {
    assert.deepEqual(parseBDTInput('1234'), { value: 1234, error: null })
  })

  test('with symbol and lakh/crore grouping', () => {
    assert.deepEqual(parseBDTInput('৳১,২৩,৪৫৬'), { value: 123456, error: null })
  })

  test('with Western-style grouping (tolerated, not required)', () => {
    assert.deepEqual(parseBDTInput('1,234,567'), { value: 1234567, error: null })
  })

  test('negative amount', () => {
    assert.deepEqual(parseBDTInput('-1,200.50'), { value: -1200.5, error: null })
  })

  test('lakh/crore word suffix', () => {
    assert.deepEqual(parseBDTInput('2 lakh'), { value: 200000, error: null })
    assert.deepEqual(parseBDTInput('3.4 crore'), { value: 34000000, error: null })
  })

  test('Bangla digits with a bangla-typed number', () => {
    assert.deepEqual(parseBDTInput('৫০০'), { value: 500, error: null })
  })

  test('whitespace-only or empty input errors with a reason', () => {
    const { value, error } = parseBDTInput('   ')
    assert.equal(value, null)
    assert.equal(typeof error, 'string')
  })

  test('garbage input errors with a reason, never throws', () => {
    assert.doesNotThrow(() => parseBDTInput('taka please'))
    const { value, error } = parseBDTInput('taka please')
    assert.equal(value, null)
    assert.match(error, /not a recognizable amount/)
  })

  test('null/undefined input', () => {
    assert.equal(parseBDTInput(null).error !== null, true)
    assert.equal(parseBDTInput(undefined).error !== null, true)
  })
})

// ---------------------------------------------------------------------------
// phone.js — every operator prefix, every input shape
// ---------------------------------------------------------------------------

describe('phone: operator identification, one per prefix', () => {
  const cases = [
    ['01712345678', 'Grameenphone'],
    ['01312345678', 'Grameenphone'],
    ['01912345678', 'Banglalink'],
    ['01412345678', 'Banglalink'],
    ['01812345678', 'Robi'],
    ['01612345678', 'Airtel'],
    ['01512345678', 'Teletalk'],
  ]
  for (const [input, operator] of cases) {
    test(`${input} -> ${operator}`, () => {
      const result = normalizeBDPhone(input)
      assert.equal(result.valid, true)
      assert.equal(result.operator, operator)
      assert.equal(result.e164, `+880${input.slice(1)}`)
    })
  }
})

describe('phone: accepted input shapes', () => {
  test('local form with leading 0', () => {
    assert.equal(normalizeBDPhone('01712345678').e164, '+8801712345678')
  })

  test('+880 international form', () => {
    assert.equal(normalizeBDPhone('+8801712345678').e164, '+8801712345678')
  })

  test('880 form without the plus', () => {
    assert.equal(normalizeBDPhone('8801712345678').e164, '+8801712345678')
  })

  test('spaces anywhere', () => {
    assert.equal(normalizeBDPhone('017 1234 5678').e164, '+8801712345678')
    assert.equal(normalizeBDPhone('+880 1712 345 678').e164, '+8801712345678')
  })

  test('dashes anywhere', () => {
    assert.equal(normalizeBDPhone('017-1234-5678').e164, '+8801712345678')
    assert.equal(normalizeBDPhone('+880-17-1234-5678').e164, '+8801712345678')
  })

  test('mixed spaces and dashes', () => {
    assert.equal(normalizeBDPhone('017 -1234- 5678').e164, '+8801712345678')
  })

  test('bare 10-digit subscriber number, no leading 0 or country code', () => {
    assert.equal(normalizeBDPhone('1712345678').e164, '+8801712345678')
  })

  test('Bangla digits', () => {
    assert.equal(normalizeBDPhone('০১৭১২৩৪৫৬৭৮').e164, '+8801712345678')
  })

  test('local form is also returned', () => {
    assert.equal(normalizeBDPhone('+8801712345678').local, '01712345678')
  })
})

describe('phone: rejections carry a reason, not just false', () => {
  test('landline (02 Dhaka number) is rejected with a reason', () => {
    const result = normalizeBDPhone('0212345678')
    assert.equal(result.valid, false)
    assert.equal(result.e164, null)
    assert.equal(typeof result.reason, 'string')
    assert.ok(result.reason.length > 0)
  })

  test('01-prefixed but invalid operator digit (landline-ish) is rejected with a reason', () => {
    const result = normalizeBDPhone('01123456789')
    assert.equal(result.valid, false)
    assert.match(result.reason, /operator prefix/i)
  })

  test('too short is rejected with a reason mentioning length', () => {
    const result = normalizeBDPhone('01712345')
    assert.equal(result.valid, false)
    assert.match(result.reason, /length/i)
  })

  test('too long is rejected with a reason mentioning length', () => {
    const result = normalizeBDPhone('017123456789999')
    assert.equal(result.valid, false)
    assert.match(result.reason, /length/i)
  })

  test('empty string', () => {
    const result = normalizeBDPhone('')
    assert.equal(result.valid, false)
    assert.match(result.reason, /empty/i)
  })

  test('null/undefined never throws', () => {
    assert.doesNotThrow(() => normalizeBDPhone(null))
    assert.doesNotThrow(() => normalizeBDPhone(undefined))
    assert.equal(normalizeBDPhone(null).valid, false)
  })

  test('letters instead of digits', () => {
    const result = normalizeBDPhone('not-a-phone')
    assert.equal(result.valid, false)
  })

  test('isValidBDPhone convenience wrapper', () => {
    assert.equal(isValidBDPhone('01712345678'), true)
    assert.equal(isValidBDPhone('0212345678'), false)
  })
})

// ---------------------------------------------------------------------------
// datetime.js
// ---------------------------------------------------------------------------

describe('datetime: formatDate / formatTime', () => {
  test('formats a known instant in Asia/Dhaka, 12-hour clock', () => {
    // 2026-08-14T09:30:00Z is 2026-08-14 15:30 in Asia/Dhaka (UTC+6)
    const d = new Date('2026-08-14T09:30:00Z')
    assert.equal(formatDate(d), '14 August 2026')
    assert.equal(formatTime(d), '3:30 PM')
  })

  test('Bangla month name and digits', () => {
    const d = new Date('2026-08-14T09:30:00Z')
    assert.equal(formatDate(d, { bangla: true }), '১৪ আগস্ট ২০২৬')
    assert.equal(formatTime(d, { bangla: true }), '৩:৩০ অপরাহ্ণ')
  })

  test('AM time, Bangla', () => {
    // 2026-08-14T01:15:00Z is 2026-08-14 07:15 in Asia/Dhaka
    const d = new Date('2026-08-14T01:15:00Z')
    assert.equal(formatTime(d), '7:15 AM')
    assert.equal(formatTime(d, { bangla: true }), '৭:১৫ পূর্বাহ্ণ')
  })

  test('a UTC instant that falls on a different calendar day once converted to Asia/Dhaka', () => {
    // 2026-08-13T19:30:00Z (UTC) -> 2026-08-14 01:30 in Asia/Dhaka (+6h):
    // the date rolls over even though the UTC calendar day has not.
    const d = new Date('2026-08-13T19:30:00Z')
    assert.equal(formatDate(d), '14 August 2026')
  })

  test('a UTC instant that has NOT yet rolled over in Asia/Dhaka', () => {
    // 2026-08-13T17:30:00Z -> 2026-08-13 23:30 in Asia/Dhaka: still the 13th.
    const d = new Date('2026-08-13T17:30:00Z')
    assert.equal(formatDate(d), '13 August 2026')
  })

  test('invalid date returns null, never throws', () => {
    assert.doesNotThrow(() => formatDate('not a date'))
    assert.equal(formatDate('not a date'), null)
    assert.equal(formatTime(new Date('garbage')), null)
    assert.equal(formatDate(undefined), null)
  })

  test('accepts an ISO string and a timestamp number, not just a Date', () => {
    assert.equal(formatDate('2026-08-14T09:30:00Z'), '14 August 2026')
    assert.equal(formatDate(new Date('2026-08-14T09:30:00Z').getTime()), '14 August 2026')
  })
})

describe('datetime: relativeLabel', () => {
  const now = new Date('2026-08-14T09:00:00Z') // 2026-08-14 15:00 Asia/Dhaka

  test('today', () => {
    assert.equal(relativeLabel(new Date('2026-08-14T02:00:00Z'), { now }), 'Today')
  })

  test('yesterday', () => {
    assert.equal(relativeLabel(new Date('2026-08-13T02:00:00Z'), { now }), 'Yesterday')
  })

  test('tomorrow', () => {
    assert.equal(relativeLabel(new Date('2026-08-15T02:00:00Z'), { now }), 'Tomorrow')
  })

  test('within the past week falls back to a weekday name', () => {
    // 2026-08-14 is a Friday -> 3 days back is Tuesday 2026-08-11
    const label = relativeLabel(new Date('2026-08-11T02:00:00Z'), { now })
    assert.equal(label, 'Tuesday')
  })

  test('more than a week away falls back to the full date', () => {
    const label = relativeLabel(new Date('2026-07-01T02:00:00Z'), { now })
    assert.equal(label, '1 July 2026')
  })

  test('Bangla relative labels', () => {
    assert.equal(relativeLabel(new Date('2026-08-14T02:00:00Z'), { now, bangla: true }), 'আজ')
    assert.equal(relativeLabel(new Date('2026-08-13T02:00:00Z'), { now, bangla: true }), 'গতকাল')
  })

  test('invalid date returns null', () => {
    assert.equal(relativeLabel('not a date', { now }), null)
  })

  test('formatRelativeDateTime combines label and time', () => {
    assert.equal(formatRelativeDateTime(new Date('2026-08-14T09:30:00Z'), { now }), 'Today, 3:30 PM')
  })
})
