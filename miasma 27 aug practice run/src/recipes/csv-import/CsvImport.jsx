/**
 * Drop-zone / file-picker CSV importer.
 *
 * WHY THIS EXISTS
 * "Import your data" always sounds like a five-minute feature until someone
 * uploads a spreadsheet with a blank trailing row, a currency column that's
 * actually text, and a date column Excel formatted three different ways.
 * This component owns the whole path — pick or drop a file, parse it,
 * coerce it, show what's wrong — so the only thing left for you to write is
 * the column spec and what to do with `onImport`'s rows.
 *
 * Works with zero configuration: without a `columns` prop every header
 * becomes a `'string'` column, so a random CSV just previews as-is. Pass
 * `columns` to get real types and per-row validation.
 */
import { useRef, useState } from 'react'
import { parseCsv } from './parse.js'
import { coerce } from './coerce.js'

const PREVIEW_LIMIT = 10

export default function CsvImport({
  // (rows: object[]) => void — called once per file with the successfully
  // coerced rows. Not called if the file produced zero good rows.
  onImport = () => {},
  // Column name -> 'string' | 'number' | 'date'. Omit to import every
  // header column as a string with no validation.
  columns = null,
  // Cosmetic only — narrows the file picker, does not block drag-and-drop.
  accept = '.csv,text/csv',
}) {
  /** @type {'idle' | 'loading' | 'preview' | 'empty' | 'error'} */
  const [phase, setPhase] = useState('idle')
  const [fileName, setFileName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [headerRow, setHeaderRow] = useState([])
  const [previewRows, setPreviewRows] = useState([])
  const [rowErrors, setRowErrors] = useState([]) // [{ label, message }] — parse + coercion errors, combined for display
  const [totalRows, setTotalRows] = useState(0) // data rows seen (excludes header)
  const [goodCount, setGoodCount] = useState(0)
  const [readError, setReadError] = useState(null)
  const fileInputEl = useRef(null)

  const badCount = totalRows - goodCount

  async function handleFiles(fileList) {
    const file = fileList?.[0]
    if (!file) return

    setPhase('loading')
    setReadError(null)
    setFileName(file.name)

    let text
    try {
      // file.text() over FileReader — same result, far less ceremony, and
      // it rejects into a catch instead of firing an onerror callback.
      text = await file.text()
    } catch (e) {
      setReadError(`Could not read "${file.name}": ${e?.message ?? String(e)}`)
      setPhase('error')
      return
    }

    const { rows, errors: parseErrors } = parseCsv(text)

    if (rows.length === 0) {
      // Either a genuinely empty file, or nothing but parse errors.
      setHeaderRow([])
      setPreviewRows([])
      setTotalRows(0)
      setGoodCount(0)
      const errs = parseErrors.map((e) => ({ label: `Line ${e.line}`, message: e.message }))
      setRowErrors(errs)
      setPhase(errs.length ? 'error' : 'empty')
      return
    }

    const header = rows[0]
    const dataRows = rows.slice(1)
    setHeaderRow(header)

    // No spec supplied: treat every column as an unvalidated string so the
    // component is useful before anyone has written a column spec.
    const spec = columns ?? Object.fromEntries(header.map((h) => [h, 'string']))

    const objectRows = dataRows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
    const { rows: typedRows, errors: coerceErrors } = coerce(objectRows, spec)

    setTotalRows(dataRows.length)
    setGoodCount(typedRows.length)
    setPreviewRows(typedRows.slice(0, PREVIEW_LIMIT))

    setRowErrors([
      ...parseErrors.map((e) => ({ label: `Line ${e.line}`, message: e.message })),
      ...coerceErrors.map((e) => ({
        label: e.column ? `Row ${e.row} · ${e.column}` : `Row ${e.row}`,
        message: e.message,
      })),
    ])

    setPhase(dataRows.length === 0 ? 'empty' : 'preview')

    if (typedRows.length > 0) onImport(typedRows)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer?.files)
  }

  function onPick(e) {
    handleFiles(e.target.files)
    e.target.value = '' // clear so picking the same file twice still fires change
  }

  function openPicker() {
    fileInputEl.current?.click()
  }

  function onZoneKeydown(e) {
    // Drop zones aren't natively focusable/activatable — wire Enter/Space by
    // hand so keyboard-only use isn't a second-class path.
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openPicker()
    }
  }

  function reset() {
    setPhase('idle')
    setFileName('')
    setHeaderRow([])
    setPreviewRows([])
    setRowErrors([])
    setTotalRows(0)
    setGoodCount(0)
    setReadError(null)
  }

  return (
    <section className="mx-auto w-full max-w-2xl px-4 pb-24">
      {(phase === 'idle' || phase === 'loading') && (
        <>
          <div
            role="button"
            tabIndex={0}
            aria-label="Drop a CSV file here, or choose a file"
            className={`cursor-pointer rounded-card border-2 border-dashed px-4 py-10 text-center transition-colors
             ${dragOver ? 'border-accent bg-accent-soft' : 'border-ink-300/70 hover:border-ink-300'}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={openPicker}
            onKeyDown={onZoneKeydown}
          >
            {phase === 'loading' ? (
              <div className="space-y-2" aria-busy="true">
                <p className="text-ink-500">Reading {fileName}…</p>
                <div className="mx-auto h-3 w-40 animate-pulse rounded-full bg-ink-100 dark:bg-ink-700/30"></div>
              </div>
            ) : (
              <>
                <p className="text-ink-700 dark:text-ink-100">Drop a CSV file here</p>
                <p className="mt-1 text-sm text-ink-500">or tap to choose one from your phone or computer</p>
              </>
            )}
          </div>
          <input
            ref={fileInputEl}
            type="file"
            accept={accept}
            className="hidden"
            onChange={onPick}
            aria-hidden="true"
            tabIndex={-1}
          />
        </>
      )}

      {phase === 'error' && (
        <div className="rounded-card border border-dashed border-danger/40 px-6 py-8 text-center">
          <p className="text-danger">{readError ?? 'That file could not be parsed.'}</p>
          {rowErrors.length > 0 && (
            <ul className="mx-auto mt-3 max-w-sm space-y-1 text-left text-sm text-danger">
              {rowErrors.map((e, i) => (
                <li key={i}>
                  <span className="font-medium">{e.label}:</span> {e.message}
                </li>
              ))}
            </ul>
          )}
          <button className="mt-4 text-sm font-medium text-accent underline" onClick={reset}>
            Try a different file
          </button>
        </div>
      )}

      {phase === 'empty' && (
        <div className="mt-6 rounded-card border border-dashed border-ink-300/70 px-6 py-10 text-center">
          <p className="text-ink-500">"{fileName}" has a header row but no data rows.</p>
          <button className="mt-3 text-sm font-medium text-accent underline" onClick={reset}>
            Try a different file
          </button>
        </div>
      )}

      {phase === 'preview' && (
        <div className="mt-6 space-y-4">
          {/* Summary banner does the job the empty state does for Loop.jsx:
              it tells the user, in one line, whether the import is clean. */}
          {badCount > 0 ? (
            <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger" aria-live="polite">
              {badCount} of {totalRows} row{totalRows === 1 ? '' : 's'} could not be imported.
            </p>
          ) : (
            <p className="rounded-xl bg-ok/10 px-4 py-3 text-sm text-ok" aria-live="polite">
              All {totalRows} row{totalRows === 1 ? '' : 's'} imported.
            </p>
          )}

          <div className="overflow-x-auto rounded-card border border-ink-300/50">
            <table className="w-full min-w-max text-left text-sm">
              <thead className="bg-ink-100 dark:bg-ink-700/30">
                <tr>
                  {headerRow.map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i} className="border-t border-ink-300/30">
                    {headerRow.map((h) => (
                      <td key={h} className="whitespace-nowrap px-3 py-2">
                        {String(row[h] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-500">
            Showing the first {previewRows.length} of {goodCount} good row{goodCount === 1 ? '' : 's'}.
          </p>

          {rowErrors.length > 0 && (
            <div>
              <p className="text-sm font-medium text-ink-700 dark:text-ink-100">Rows with problems</p>
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm text-danger">
                {rowErrors.map((e, i) => (
                  <li key={i}>
                    <span className="font-medium">{e.label}:</span> {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button className="text-sm font-medium text-accent underline" onClick={reset}>
            Import a different file
          </button>
        </div>
      )}
    </section>
  )
}
