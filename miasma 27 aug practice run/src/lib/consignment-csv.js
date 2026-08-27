/**
 * Aid consignment CSV parser + validator — U3 (aid inventory import).
 *
 * Pure module: no npm dependencies, no framework imports. The only project
 * import is `SUPPLY_ITEMS` from `./store.js`, because "is this item real" is
 * a domain fact that must not drift from the fixed 8 items everyone else
 * builds against (SPEC.md).
 *
 * Expected columns (header row, case-insensitive, trimmed, any order, extra
 * columns ignored): `ngo_name,item,quantity,unit,eta_hours`.
 *
 * `parseConsignmentsCsv(text)` never throws — a malformed file/row is always
 * reported in `errors`, never a crash, per CLAUDE.md rule 4 ("bad input ->
 * message not crash"). Two kinds of error live in the same flat array:
 *   - whole-file errors (empty file, unterminated quote, missing required
 *     column) -> `row: null`, `line` points at the header/offending line.
 *   - per-row validation errors -> `row` is the 1-based DATA row number
 *     (header excluded, blank lines excluded — they're skipped, not
 *     errored), `line` is the actual 1-based line in the file that row
 *     starts on. The two numbers diverge once a quoted field embeds a
 *     newline, same gotcha as src/recipes/csv-import/README.md documents.
 *
 * Only one error is reported per bad row (first failing check wins, in the
 * order the columns are listed above) — "one precise error per row", not a
 * pile-up of every problem in that row.
 *
 * `valid` rows come out as `{ ngo, item, qty, unit, etaHours }` — camelCase
 * `etaHours`, NOT the CSV's `eta_hours` header spelling — because that is
 * exactly the shape `api.addConsignments(rows)` documents and destructures
 * (see src/lib/api.js). ImportPanel.jsx passes `valid` straight through with
 * no remapping step.
 */
import { SUPPLY_ITEMS } from './store.js'

const REQUIRED_COLUMNS = ['ngo_name', 'item', 'quantity', 'unit', 'eta_hours']
const VALID_ITEMS = new Set(SUPPLY_ITEMS.map(([value]) => value))

const POSITIVE_INT = /^\d+$/
const NONNEG_INT = /^\d+$/

// --- tokenizer -------------------------------------------------------------
// Adapted from src/recipes/csv-import/parse.js's hand-rolled state machine
// (quoted fields, embedded commas/newlines, "" escapes, CRLF/LF/lone-\r,
// BOM stripping, never throws) — extended to record the 1-based file line
// each ROW starts on, since parse.js only tracks a running line count for
// its own error messages, not per row. Validation errors here need to point
// a commissioner at an exact spreadsheet line.

function tokenizeCsv(text) {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows = []
  const errors = []
  let row = []
  let field = ''
  let inQuotes = false
  let line = 1
  let rowStartLine = 1
  const n = s.length
  let i = 0

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push({ fields: row, line: rowStartLine })
    row = []
  }

  while (i < n) {
    const c = s[i]

    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i += 2
        } else {
          inQuotes = false
          i += 1
        }
      } else {
        if (c === '\n') line += 1
        field += c
        i += 1
      }
      continue
    }

    if (c === '"' && field === '') {
      inQuotes = true
      i += 1
    } else if (c === ',') {
      endField()
      i += 1
    } else if (c === '\r') {
      i += s[i + 1] === '\n' ? 2 : 1
      endRow()
      line += 1
      rowStartLine = line
    } else if (c === '\n') {
      i += 1
      endRow()
      line += 1
      rowStartLine = line
    } else {
      field += c
      i += 1
    }
  }

  if (inQuotes) {
    errors.push({
      line: rowStartLine,
      message: 'Unterminated quoted field: reached the end of the file before a closing " was found.',
    })
    endRow() // best-effort: still return what was collected, don't drop it
  } else if (field !== '' || row.length > 0) {
    endRow()
  }

  return { rows, errors }
}

function isBlankRow(fields) {
  return fields.length === 1 && fields[0] === ''
}

// --- public API --------------------------------------------------------------

/**
 * @param {string} text
 * @returns {{
 *   valid: { ngo: string, item: string, qty: number, unit: string, etaHours: number }[],
 *   errors: { row: number | null, line: number, message: string }[],
 * }}
 */
export function parseConsignmentsCsv(text) {
  try {
    if (typeof text !== 'string' || text.trim() === '') {
      return { valid: [], errors: [{ row: null, line: 1, message: 'File is empty.' }] }
    }

    const { rows: tokenRows, errors: tokenErrors } = tokenizeCsv(text)
    const errors = tokenErrors.map((e) => ({ row: null, line: e.line, message: e.message }))

    if (tokenRows.length === 0) {
      errors.push({ row: null, line: 1, message: 'File has no rows.' })
      return { valid: [], errors }
    }

    const headerRow = tokenRows[0]
    const header = headerRow.fields.map((h) => h.trim().toLowerCase())

    const colIndex = {}
    const missing = []
    for (const col of REQUIRED_COLUMNS) {
      const idx = header.indexOf(col)
      if (idx === -1) missing.push(col)
      else colIndex[col] = idx
    }
    if (missing.length > 0) {
      errors.push({
        row: null,
        line: headerRow.line,
        message: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
      })
      return { valid: [], errors } // no reliable column mapping -> can't validate data rows at all
    }

    const valid = []
    let rowNumber = 0

    for (let i = 1; i < tokenRows.length; i++) {
      const { fields, line } = tokenRows[i]
      if (isBlankRow(fields)) continue // blank lines are skipped, not errors

      rowNumber += 1

      if (fields.length !== header.length) {
        errors.push({ row: rowNumber, line, message: `Expected ${header.length} columns, found ${fields.length}.` })
        continue
      }

      const ngo = (fields[colIndex.ngo_name] ?? '').trim()
      if (ngo === '') {
        errors.push({ row: rowNumber, line, message: 'ngo_name is required.' })
        continue
      }

      const rawItem = (fields[colIndex.item] ?? '').trim()
      const item = rawItem.toLowerCase()
      if (!VALID_ITEMS.has(item)) {
        errors.push({
          row: rowNumber,
          line,
          message: `Unknown item "${rawItem}" — must be one of ${[...VALID_ITEMS].join(', ')}.`,
        })
        continue
      }

      const rawQty = (fields[colIndex.quantity] ?? '').trim()
      if (!POSITIVE_INT.test(rawQty) || Number(rawQty) <= 0) {
        errors.push({ row: rowNumber, line, message: `quantity must be a positive whole number, got "${rawQty}".` })
        continue
      }

      const rawEta = (fields[colIndex.eta_hours] ?? '').trim()
      if (!NONNEG_INT.test(rawEta)) {
        errors.push({ row: rowNumber, line, message: `eta_hours must be a whole number >= 0, got "${rawEta}".` })
        continue
      }

      const unit = (fields[colIndex.unit] ?? '').trim()
      if (unit === '') {
        errors.push({ row: rowNumber, line, message: 'unit is required.' })
        continue
      }

      valid.push({ ngo, item, qty: Number(rawQty), unit, etaHours: Number(rawEta) })
    }

    return { valid, errors }
  } catch (e) {
    // Contract is "never throws" — surface a single whole-file error instead.
    return { valid: [], errors: [{ row: null, line: 0, message: 'Unexpected parse failure: ' + (e?.message ?? String(e)) }] }
  }
}
