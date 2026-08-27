# export

Getting data OUT. Receipts, reports, "download this", "print this", "share
this with the judge." Cheap to build, disproportionately convincing in a
demo because it makes the app feel finished. Four independent pieces —
CSV download, print-one-element, a real QR code, and share/copy — use only
the ones you need.

## Files

| File | What |
|---|---|
| `csv-export.js` | Array of objects → downloaded `.csv`. Escapes commas/quotes/newlines, emits a UTF-8 BOM, handles empty arrays and mismatched keys. Never throws. |
| `print.css` | Print stylesheet: hides `.no-print` chrome, sets sane page margins, stops rows/cards splitting across a page break, keeps meaningful backgrounds. |
| `printable.js` | `printElement(target)` — prints one element instead of the whole page, using `print.css`'s reserved container. |
| `qr.js` | Dependency-free QR code encoder (Model 2, byte mode, versions 1-6) → SVG. Real Reed-Solomon error correction, not a lookup table. |
| `share.js` | `share({ title, text, url })` — Web Share API, falling back to clipboard, falling back to a legacy copy trick on insecure origins. Reports which path ran. |
| `ExportBar.jsx` | Toolbar: Download CSV / Print / Show QR / Share. Each button hides itself if you didn't pass the props it needs. |
| `csv-export.test.mjs`, `qr.test.mjs` | `node --test` coverage. |

## Using it

```bash
cp -r src/recipes/export src/lib/export
```

```jsx
import { useState } from 'react'
import ExportBar from '../lib/export/ExportBar.jsx'

const rows = [{ item: 'Rice', qty: 2, total: 240 }, { item: 'Oil', qty: 1, total: 180 }]

function Receipt() {
  // A ref callback (not useRef) so the element is in state by the time
  // ExportBar's first render sees it — useRef's .current wouldn't trigger
  // a re-render once the node attaches.
  const [receiptEl, setReceiptEl] = useState(null)

  return (
    <>
      <div ref={setReceiptEl}>
        {/* the receipt/report markup */}
      </div>

      <ExportBar
        rows={rows}
        filename="receipt.csv"
        printTarget={receiptEl}
        shareUrl="https://your-app.pages.dev/receipt/123"
        shareTitle="Receipt #123"
      />
    </>
  )
}
```

Import `print.css` once, globally — e.g. add to `src/app.css`:

```css
@import "./lib/export/print.css";
```

(adjust the path to wherever you copied the folder). Put `className="no-print"` on
your nav bar, the "Add" form, filter controls — anything that shouldn't show
up on paper.

### Using the pieces separately

```js
import { downloadCsv } from './csv-export.js'
downloadCsv(rows, 'export.csv')

import { printElement } from './printable.js'
printElement('#receipt') // selector or an Element

import { textToQrSvg } from './qr.js'
const { data: svg, error } = textToQrSvg('https://your-app.pages.dev/', { level: 'M' })
// svg is a string — render with dangerouslySetInnerHTML={{ __html: svg }} in a React component

import { share } from './share.js'
const { data, error } = await share({ title: 'My receipt', url: 'https://...' })
// data.method is 'share' | 'clipboard' | 'legacy-copy' | 'cancelled'
```

## PDF export is the browser's print dialog, not a library

There is no PDF export code in this folder, on purpose. Every browser's
print dialog already offers "Save as PDF" as a destination — `printElement()`
+ `print.css` gets you a clean, single-element printout, and the user (or
you, via `window.print()`'s own UI) picks PDF instead of a physical printer.
Pulling in a PDF-generation library would mean laying out the document a
second time in a different engine, for a result no better than what the
browser already produces for free. If a judge asks for a PDF, click Print,
choose "Save as PDF."

## The 3 gotchas

1. **The QR encoder supports versions 1-6 only, not the full spec (versions
   1-40).** Versions 7+ need an extra 18-bit "version information" block
   that this file doesn't implement — shipping that half-right felt riskier
   than just capping the range and returning a clear capacity error instead.
   Version 6 at error-correction level L holds up to 134 bytes, comfortably
   enough for a `*.pages.dev` URL plus a path. If you truly need to encode
   more than that, `encodeQr` fails with a specific message rather than
   emitting a QR code that looks fine and doesn't scan — check `error`
   before assuming `data` is usable. This was verified against a real
   decoder, not just "the code runs": every version (1-6) × every EC level
   (L/M/Q/H) × several payload lengths, including a Bangla URL, was rendered
   to PNG and round-tripped through `zbarimg` (a real QR decoder) during
   development, matching the original text every time. To re-run that
   yourself (needs `rsvg-convert` and `zbarimg` — not part of this repo's
   dependencies):
   ```bash
   node -e "
   const { textToQrSvg } = await import('./qr.js')
   const { data } = textToQrSvg('https://your-app.pages.dev/', { level: 'M' })
   require('fs').writeFileSync('/tmp/test.svg', data)
   " --input-type=module
   rsvg-convert -o /tmp/test.png /tmp/test.svg && zbarimg /tmp/test.png
   ```

2. **`downloadCsv`/`printElement`/`share` need a real browser — they no-op
   with a clear `{ error }` under `node --test` or SSR**, which is exactly
   why `toCsv` (the pure text-building half of `csv-export.js`) is a
   separate exported function from `downloadCsv` (the DOM-touching half).
   Test the CSV *content* against `toCsv`; the download itself only proves
   itself out in a real browser tab.

3. **The BOM (`csv-export.js`) is what makes Bangla text open correctly in
   Excel — do not strip it "to clean up the output."** Without it, Excel
   guesses the file's encoding from its bytes and, for a CSV that starts
   with non-ASCII text, frequently guesses wrong, turning `করিম` into
   mojibake on open even though the underlying bytes were perfectly valid
   UTF-8 the whole time. Google Sheets and every plain-text editor handle
   the BOM transparently, so there's no downside to always emitting it. If
   you see a literal `ï»¿` at the start of an opened file, that's this BOM
   being *mis-decoded* by whatever opened it as something other than UTF-8
   — a viewer problem, not a reason to remove it here.
