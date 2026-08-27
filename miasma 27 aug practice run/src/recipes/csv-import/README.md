# csv-import

A drop-zone CSV importer: parse, type-check, preview, emit the good rows.
Dependency-free — the parser is hand-written, not a wrapper around a package.

## Files

| File | What |
|---|---|
| `parse.js` | Dependency-free CSV parser. Text in, `{ rows, errors }` out. Never throws. |
| `coerce.js` | Maps raw string rows to typed objects given a column spec (`{ col: 'string' \| 'number' \| 'date' }`). Bad rows are reported, not defaulted. |
| `CsvImport.jsx` | Drop zone + file picker. Parses, previews the first 10 good rows, lists per-row errors, emits the rest via `onImport`. |
| `parse.test.mjs` | `node --test` coverage of every parser edge case. |

## Using it

```bash
cp -r src/recipes/csv-import src/lib/csv-import
```

Then in a page or another component:

```jsx
import CsvImport from '../lib/csv-import/CsvImport.jsx'
import { db } from '../lib/db.js'

const columns = { name: 'string', qty: 'number', when: 'date' }

async function handleImport(rows) {
  for (const row of rows) await db.insert('items', row)
}

function ImportScreen() {
  return <CsvImport columns={columns} onImport={handleImport} />
}
```

Omit `columns` entirely and every header becomes an unvalidated string column
— useful for a first look at a file before you've decided on types.

`coerce.js`'s `'date'` type returns real `Date` objects, not strings. If
you're inserting straight into `db.js`, either convert with
`row.when.toISOString()` before calling `db.insert`, or store as `'string'`
in the column spec and parse it yourself later — Postgres/Supabase will
happily take an ISO string, `localStorage` needs one either way since
`JSON.stringify` can't round-trip a `Date`.

## The 3 gotchas

1. **`columns` keys must exactly match the CSV header text**, including
   case and whitespace. `"Qty "` in the file and `qty` in your spec is a
   silent 100%-failure row for that column, reported once per row, not a
   crash — check the error list before assuming the file is empty of good
   data. If the export has inconsistent header casing, normalize
   `headerRow` before building your spec rather than fighting the source file.

2. **Rows are reported by data-row number (1 = first row after the header),
   not by file line number.** A quoted field with an embedded newline makes
   those two numbers diverge — row 3 might start on line 5 of the raw file.
   Parser-level errors (from `parse.js`) are labeled `Line N`; coercion
   errors (from `coerce.js`) are labeled `Row N`. If you need exact file
   line numbers for coercion errors too, the mapping to do it yourself is:
   `parseCsv(text).rows` in order, header at index 0, so data row `i` lines
   up with `rows[i + 1]`.

3. **A blank line in the file is not skipped — it parses as one row with a
   single empty-string field**, same as `"".split(',')`. If the export has
   trailing blank rows (common from Excel), they'll show up as failed rows
   under every non-optional column rather than being silently ignored. Filter
   them out before calling `coerce()` if that's not what you want:
   `dataRows.filter(r => r.some(field => field !== ''))`.
