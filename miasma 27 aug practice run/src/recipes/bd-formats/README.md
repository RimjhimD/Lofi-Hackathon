# bd-formats

Bangladeshi money, phone number, Bangla-digit, and date/time formatting.
Pure functions, dependency-free, `{ data, error }`-style return values where
the operation can genuinely fail (parsing free text, validating a phone
number) — plain values elsewhere, matching `src/lib/db.js`'s conventions.

The whole point of this recipe is a cheap, highly visible "built for BD, not
translated at 5am" signal: correct lakh/crore grouping, phone numbers that
accept what people actually type, and dates that don't silently render in
the server's timezone instead of Dhaka's.

## Files

| File | What |
|---|---|
| `numerals.js` | Convert digits between Latin (`0-9`) and Bangla (`০-৯`) in either direction. Non-digit characters pass through untouched. |
| `money.js` | `formatBDT`, `formatCompactBDT`, `parseBDTInput` — BDT formatting with South Asian lakh/crore grouping (see below), not Western thousands. |
| `phone.js` | `normalizeBDPhone`, `isValidBDPhone` — validate and normalise Bangladeshi mobile numbers, identify the operator. |
| `datetime.js` | `formatDate`, `formatTime`, `relativeLabel`, `formatRelativeDateTime` — 12-hour clock, Asia/Dhaka timezone, optional Bangla month/digit output. |
| `formats.test.mjs` | `node --test` coverage for every "must handle" case in all four modules — this file is the proof, not an afterthought. |

`money.js` and `datetime.js` import from `numerals.js` (same folder, so `cp
-r` still gets everything in one shot). Nothing here imports from another
recipe or from `src/lib`.

## Using it

```bash
cp -r src/recipes/bd-formats src/lib/bd-formats
```

```js
import { formatBDT, formatCompactBDT, parseBDTInput } from '../lib/bd-formats/money.js'
import { normalizeBDPhone } from '../lib/bd-formats/phone.js'
import { formatDate, formatTime, relativeLabel } from '../lib/bd-formats/datetime.js'
import { toBanglaDigits } from '../lib/bd-formats/numerals.js'

formatBDT(1234567)                          // "৳12,34,567"
formatBDT(1234567, { numerals: 'bangla' })  // "৳১২,৩৪,৫৬৭"
formatCompactBDT(3400000)                   // "৳34.0 lakh"
parseBDTInput('৳১,২৩,৪৫৬')                  // { value: 123456, error: null }

normalizeBDPhone('017-1234-5678')
// { valid: true, e164: '+8801712345678', local: '01712345678', operator: 'Grameenphone', reason: null }

formatDate(new Date())                      // "14 August 2026"
relativeLabel(someDate)                     // "Today" / "Yesterday" / "Tuesday" / "14 August 2026"
```

## The grouping rule this implements — verify before you trust it

**South Asian / Indian digit grouping**, which Bangladesh uses the same way:
the last **three** digits form one group; every group before that is **two**
digits, all the way to the front. This is not the same as Western
thousands-grouping (`1,234,567`) or the `en-IN` `Intl` locale grouping,
which is close but not guaranteed identical across engines — this recipe
hand-rolls the grouping instead of trusting either.

| Digits | Grouped | Note |
|---|---|---|
| 5 | `12,345` | only one grouping boundary — looks the same as Western |
| 6 | `1,23,456` | 1 lakh territory begins |
| 7 | `12,34,567` | |
| 8 | `1,23,45,678` | 1 crore territory begins |

1 lakh = `1,00,000` (6 digits). 1 crore = `1,00,00,000` (8 digits). Both are
covered explicitly in `formats.test.mjs`, along with 5-, 7-, and very-large
values, because the boundary is exactly where a hand-rolled grouping
function is most likely to be off by one digit.

## The 3 gotchas

1. **`formatBDT` hides the decimal part by default when the amount is a
   whole number.** `formatBDT(1234)` → `"৳1,234"`, not `"৳1,234.00"`. This
   is deliberate (BD taka amounts are usually whole numbers and the extra
   `.00` reads as noise), but if you're displaying a price list next to
   values that *do* have paisa, the inconsistent decimal count looks
   sloppy side by side. Pass `{ decimals: 2 }` to force it everywhere.

2. **`parseBDTInput` strips commas without validating their placement.**
   `"1,2,3,4,5"` parses to `12345` — a fat-fingered comma doesn't block a
   form submit, which is the right call for a hackathon demo, but it means
   this function will never catch a genuinely malformed grouping as a user
   error. If you need to *reject* bad grouping (not just accept anything
   with commas removed), add that check at the call site.

3. **`normalizeBDPhone`'s landline rejection is prefix-based, not a real
   landline directory.** It rejects anything that isn't `01[3-9]...`
   because that's the entire mobile number space — a real Dhaka landline
   (`02-XXXXXXXX`) or district code will always fail this check for the
   right reason, but so will a mistyped `011...` or `012...` mobile number;
   both come back with `reason: '...operator prefix...'`, and the message
   is a best-effort guess, not a certainty, about *why* it's invalid.

## One more thing worth knowing

`datetime.js` pins every format to `Asia/Dhaka` via `Intl`'s explicit
`timeZone` option — it does **not** read `process.env.TZ` or the host
machine's local timezone at all. That's what makes "a date in another
timezone" a non-issue: the same `Date` object formats identically whether
the code runs on a Dhaka server, a UTC CI runner, or a judge's laptop set to
whatever. If you ever need a *different* city's local time in the same app,
don't reuse these functions with a different `TZ` env var — they'll ignore
it. Change the hard-coded `TZ` constant instead.
