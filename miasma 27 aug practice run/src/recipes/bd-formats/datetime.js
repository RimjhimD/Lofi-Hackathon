/**
 * Bangladesh-local date/time formatting.
 *
 * WHY THIS EXISTS
 * A judge's laptop, the demo phone, and a Supabase server timestamp can all
 * be in different timezones (or all UTC). `new Date().toLocaleString()`
 * silently renders in whatever timezone the *machine* happens to be set to
 * — fine in dev, wrong the moment the app runs somewhere else. Every
 * function here pins formatting to `Asia/Dhaka` explicitly via `Intl`, so
 * the displayed time is correct regardless of where the code executes, and
 * uses the 12-hour clock BD users expect rather than 24-hour "military" time.
 *
 * Every function accepts a `Date`, an ISO string, or a timestamp number
 * (anything `new Date(x)` accepts), and returns `null` — never throws — for
 * a value that doesn't resolve to a valid date.
 */

import { toBanglaDigits } from './numerals.js'

const TZ = 'Asia/Dhaka'
const DAY_MS = 24 * 60 * 60 * 1000

const BN_MONTHS = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
]

const BN_WEEKDAYS = {
  Sunday: 'রবিবার',
  Monday: 'সোমবার',
  Tuesday: 'মঙ্গলবার',
  Wednesday: 'বুধবার',
  Thursday: 'বৃহস্পতিবার',
  Friday: 'শুক্রবার',
  Saturday: 'শনিবার',
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  weekday: 'long',
})

function coerceDate(input) {
  return input instanceof Date ? input : new Date(input)
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

/** Pull { year, month, day, hour, minute, dayPeriod, weekday } out of a Date,
 *  all already resolved against Asia/Dhaka regardless of system timezone. */
function dhakaParts(date) {
  const parts = partsFormatter.formatToParts(date)
  const map = {}
  for (const p of parts) map[p.type] = p.value
  return map
}

/** Calendar-day number (days since epoch, in Asia/Dhaka) — for day-diff math
 *  that ignores time-of-day, so "23:50" and "00:10" on the same Dhaka date
 *  compare equal. */
function dhakaDayNumber(date) {
  const p = dhakaParts(date)
  return Math.floor(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / DAY_MS)
}

/**
 * Format the time-of-day, 12-hour clock, Asia/Dhaka.
 * @param {Date|string|number} input
 * @param {{ bangla?: boolean }} [opts]
 * @returns {string|null} e.g. "3:45 PM" / "৩:৪৫ PM" (bangla: true also
 *   swaps AM/PM for পূর্বাহ্ণ/অপরাহ্ণ), or null for an invalid date.
 */
export function formatTime(input, opts = {}) {
  const { bangla = false } = opts
  const d = coerceDate(input)
  if (!isValidDate(d)) return null

  const p = dhakaParts(d)
  let out = `${p.hour}:${p.minute} ${p.dayPeriod}`

  if (bangla) {
    out = out.replace(/\bAM\b/, 'পূর্বাহ্ণ').replace(/\bPM\b/, 'অপরাহ্ণ')
    out = toBanglaDigits(out)
  }
  return out
}

/**
 * Format a calendar date, Asia/Dhaka.
 * @param {Date|string|number} input
 * @param {{ bangla?: boolean }} [opts]
 * @returns {string|null} e.g. "14 August 2026" / "১৪ আগস্ট ২০২৬"
 */
export function formatDate(input, opts = {}) {
  const { bangla = false } = opts
  const d = coerceDate(input)
  if (!isValidDate(d)) return null

  const p = dhakaParts(d)
  const monthIndex = Number(p.month) - 1

  if (bangla) {
    return toBanglaDigits(`${p.day} `) + BN_MONTHS[monthIndex] + toBanglaDigits(` ${p.year}`)
  }
  const monthName = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long' }).format(d)
  return `${p.day} ${monthName} ${p.year}`
}

/**
 * Human relative label for a date, Asia/Dhaka: "Today", "Yesterday",
 * "Tomorrow", the weekday name for anything within the surrounding week, or
 * the full formatted date beyond that.
 * @param {Date|string|number} input
 * @param {{ bangla?: boolean, now?: Date }} [opts]
 * @returns {string|null}
 */
export function relativeLabel(input, opts = {}) {
  const { bangla = false, now = new Date() } = opts
  const d = coerceDate(input)
  const nowD = coerceDate(now)
  if (!isValidDate(d) || !isValidDate(nowD)) return null

  const diff = dhakaDayNumber(nowD) - dhakaDayNumber(d) // >0 = in the past

  if (diff === 0) return bangla ? 'আজ' : 'Today'
  if (diff === 1) return bangla ? 'গতকাল' : 'Yesterday'
  if (diff === -1) return bangla ? 'আগামীকাল' : 'Tomorrow'

  if (diff > 1 && diff < 7) {
    const weekday = dhakaParts(d).weekday
    return bangla ? BN_WEEKDAYS[weekday] : weekday
  }
  if (diff < -1 && diff > -7) {
    const weekday = dhakaParts(d).weekday
    return bangla ? BN_WEEKDAYS[weekday] : weekday
  }

  return formatDate(d, { bangla })
}

/**
 * Combined relative-day + time, e.g. "Today, 3:45 PM" / "Sunday, 11:20 AM".
 * @param {Date|string|number} input
 * @param {{ bangla?: boolean, now?: Date }} [opts]
 * @returns {string|null}
 */
export function formatRelativeDateTime(input, opts = {}) {
  const label = relativeLabel(input, opts)
  const time = formatTime(input, opts)
  if (label === null || time === null) return null
  return `${label}, ${time}`
}
