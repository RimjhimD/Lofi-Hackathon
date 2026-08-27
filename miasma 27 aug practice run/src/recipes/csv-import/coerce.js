/**
 * Type coercion for parsed CSV rows.
 *
 * WHY THIS EXISTS
 * parse.js only knows about strings — every field, valid or not, comes out as
 * text. Something has to turn `"42"` into `42` and `"2026-08-14"` into a real
 * Date before the row is fit to insert with db.js. That something needs to
 * fail loudly per-row instead of quietly writing `NaN` or `Invalid Date` into
 * the database, which is how a CSV import bug turns into a support ticket a
 * week later instead of a red banner right now.
 *
 * A row that fails coercion on any column is left out of the returned rows
 * and shows up in `errors` instead — never silently dropped, never defaulted
 * to 0 or "".
 */

const COERCERS = {
  string(raw) {
    if (raw === undefined || raw === null) return { ok: false, message: 'column is missing from this row' }
    return { ok: true, value: raw }
  },
  number(raw) {
    const trimmed = (raw ?? '').trim()
    if (trimmed === '') return { ok: false, message: 'empty value, expected a number' }
    const value = Number(trimmed)
    if (Number.isNaN(value)) return { ok: false, message: `"${trimmed}" is not a number` }
    return { ok: true, value }
  },
  date(raw) {
    const trimmed = (raw ?? '').trim()
    if (trimmed === '') return { ok: false, message: 'empty value, expected a date' }
    const value = new Date(trimmed)
    if (Number.isNaN(value.getTime())) return { ok: false, message: `"${trimmed}" is not a recognizable date` }
    return { ok: true, value }
  },
}

/**
 * Map raw string rows to typed objects, given a column spec.
 *
 * @param {Record<string, string>[]} rows - row objects with raw string values,
 *   keyed by column name (typically built by zipping a parsed header row with
 *   each data row — see CsvImport.svelte for that step).
 * @param {Record<string, 'string' | 'number' | 'date'>} spec - column name -> type.
 *   Columns not listed in spec are ignored; columns listed but absent from a
 *   row are reported as errors, not skipped.
 * @returns {{ rows: object[], errors: { row: number, column: string | null, message: string }[] }}
 */
export function coerce(rows, spec) {
  try {
    if (!Array.isArray(rows)) return { rows: [], errors: [{ row: 0, column: null, message: 'rows was not an array' }] }
    if (!spec || typeof spec !== 'object') {
      return { rows: [], errors: [{ row: 0, column: null, message: 'no column spec given' }] }
    }

    const columns = Object.keys(spec)
    const goodRows = []
    const errors = []

    rows.forEach((raw, i) => {
      const rowNum = i + 1 // 1-based, counting data rows only (header excluded)
      const typed = {}
      let rowFailed = false

      for (const column of columns) {
        const kind = spec[column]
        const coercer = COERCERS[kind]
        if (!coercer) {
          errors.push({ row: rowNum, column, message: `unknown column type "${kind}" in spec` })
          rowFailed = true
          continue
        }
        const result = coercer(raw?.[column])
        if (!result.ok) {
          errors.push({ row: rowNum, column, message: result.message })
          rowFailed = true
        } else {
          typed[column] = result.value
        }
      }

      // A row with any failing column is left out entirely rather than
      // imported half-typed — a partially-coerced row is a worse bug than a
      // missing one, because it looks fine until someone reads that field.
      if (!rowFailed) goodRows.push(typed)
    })

    return { rows: goodRows, errors }
  } catch (e) {
    return { rows: [], errors: [{ row: 0, column: null, message: 'Unexpected coercion failure: ' + (e?.message ?? String(e)) }] }
  }
}
