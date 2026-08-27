/**
 * CSV parser.
 *
 * WHY THIS EXISTS
 * "Just split on commas" is a trap that looks fine in a demo and falls over the
 * moment a judge's spreadsheet has a name like `"Doe, John"` or an address with
 * a line break in it. Real CSVs — the ones Excel and Google Sheets actually
 * export — are full of that. Getting it right by hand once, here, is cheaper
 * than debugging a mis-parsed import live on stage.
 *
 * This is a small hand-rolled state machine, not a line-splitter. It reads the
 * file character by character so a comma or newline *inside* a quoted field
 * never gets mistaken for a delimiter.
 *
 * Handles: quoted fields with commas, quoted fields with embedded newlines,
 * `""` as an escaped quote, CRLF and LF line endings (and a stray lone `\r`),
 * a missing or present trailing newline, and a leading BOM (Excel loves to
 * add one). Never throws — a malformed row is reported in `errors`, not a
 * crash.
 *
 * Returns { rows, errors }, same shape convention as db.js's { data, error }.
 * `rows` is an array of arrays of raw strings — the first row is normally the
 * header, but this module doesn't know or care about headers. That mapping is
 * coerce.js's job.
 */

/**
 * Parse CSV text into rows of raw string fields.
 *
 * @param {string} text
 * @returns {{ rows: string[][], errors: { line: number, message: string }[] }}
 */
export function parseCsv(text) {
  try {
    if (typeof text !== 'string') {
      return { rows: [], errors: [{ line: 0, message: 'Input was not text.' }] }
    }

    // Excel (and some Windows tools) prefix UTF-8 CSV exports with a BOM.
    // Left in place, it silently glues itself onto the first header name.
    let s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

    const rows = []
    const errors = []
    let row = []
    let field = ''
    let inQuotes = false
    let line = 1
    const n = s.length
    let i = 0

    const endField = () => {
      row.push(field)
      field = ''
    }
    const endRow = () => {
      endField()
      rows.push(row)
      row = []
    }

    while (i < n) {
      const c = s[i]

      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') {
            // Escaped quote: "" inside a quoted field means a literal ".
            field += '"'
            i += 2
          } else {
            inQuotes = false
            i += 1
          }
        } else {
          // Commas and newlines inside quotes are literal content, not
          // delimiters — that's the entire point of quoting a field.
          if (c === '\n') line += 1
          field += c
          i += 1
        }
        continue
      }

      if (c === '"' && field === '') {
        // A quote only opens a quoted field when it's the first character of
        // the field. Mid-field it's just an odd character — leniently kept
        // as-is rather than throwing on a spreadsheet someone hand-edited.
        inQuotes = true
        i += 1
      } else if (c === ',') {
        endField()
        i += 1
      } else if (c === '\r') {
        // CRLF: consume both bytes as one line ending. A lone \r (old-Mac
        // style) still ends the row, it just doesn't eat a following byte.
        i += s[i + 1] === '\n' ? 2 : 1
        endRow()
        line += 1
      } else if (c === '\n') {
        i += 1
        endRow()
        line += 1
      } else {
        field += c
        i += 1
      }
    }

    // End of input. Anything still buffered needs to be flushed — unless
    // it's genuinely nothing, which is the normal case for a well-formed
    // file ending in a trailing newline (that \n already flushed the last
    // row above; there's no phantom empty row waiting here).
    if (inQuotes) {
      errors.push({
        line,
        message: 'Unterminated quoted field: reached the end of the file before a closing " was found.',
      })
      endRow() // best-effort: still return what was collected, don't drop it
    } else if (field !== '' || row.length > 0) {
      endRow()
    }

    return { rows, errors }
  } catch (e) {
    // Should be unreachable given the logic above, but the contract is
    // "never throws" — so if something surprises us, report it instead.
    return { rows: [], errors: [{ line: 0, message: 'Unexpected parse failure: ' + (e?.message ?? String(e)) }] }
  }
}
