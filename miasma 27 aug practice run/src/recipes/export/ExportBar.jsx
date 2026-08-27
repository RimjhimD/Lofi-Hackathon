/**
 * A small toolbar: Download CSV, Print, Show QR, Share. Every button in
 * this recipe is optional independently — pass only the props for the
 * exports you actually want and the rest quietly don't render, rather
 * than showing a button that's guaranteed to error when clicked.
 *
 * States shipped: per-action busy (buttons disable while their own action
 * runs, not each other's), one dismissible error banner, a QR panel that
 * toggles open/closed instead of stacking, and a share confirmation that
 * names which path actually happened (native share sheet vs. clipboard
 * copy vs. the insecure-origin fallback) because those are different
 * enough outcomes that "Shared!" for all three would be misleading.
 */
import { useState } from 'react'
import { downloadCsv } from './csv-export.js'
import { printElement } from './printable.js'
import { textToQrSvg } from './qr.js'
import { share } from './share.js'

const shareStatusLabel = {
  share: 'Shared',
  clipboard: 'Link copied to clipboard',
  'legacy-copy': 'Link copied',
  cancelled: null, // user closed the share sheet — not worth announcing
}

export default function ExportBar({
  rows = [],
  filename = 'export.csv',
  printTarget = null, // element or CSS selector for the thing to print — the Print button hides without it
  shareUrl = '', // also what the QR code encodes
  shareTitle = '',
  shareText = '',
}) {
  const [busy, setBusy] = useState(null) // 'csv' | 'print' | 'qr' | 'share' | null — only the active button disables
  const [error, setError] = useState(null)
  const [showQr, setShowQr] = useState(false)
  const [qrSvg, setQrSvg] = useState(null)
  const [shareStatus, setShareStatus] = useState(null)

  const hasRows = Array.isArray(rows) && rows.length > 0
  const canPrint = Boolean(printTarget)
  const canShare = Boolean(shareUrl || shareText || shareTitle)

  function handleCsv() {
    if (!hasRows || busy) return
    setBusy('csv')
    setError(null)
    const { error: err } = downloadCsv(rows, filename)
    if (err) setError(err.message)
    setBusy(null)
  }

  function handlePrint() {
    if (!canPrint || busy) return
    setBusy('print')
    setError(null)
    const { error: err } = printElement(printTarget)
    if (err) setError(err.message)
    setBusy(null)
  }

  function toggleQr() {
    if (busy) return
    setError(null)
    if (showQr) {
      setShowQr(false)
      return
    }
    if (!shareUrl) {
      setError('No URL to encode — pass shareUrl to ExportBar.')
      return
    }
    setBusy('qr')
    const { data, error: err } = textToQrSvg(shareUrl, { level: 'M' })
    setBusy(null)
    if (err) {
      setError(err.message)
      return
    }
    setQrSvg(data)
    setShowQr(true)
  }

  async function handleShare() {
    if (!canShare || busy) return
    setBusy('share')
    setError(null)
    setShareStatus(null)
    const { data, error: err } = await share({ title: shareTitle, text: shareText, url: shareUrl })
    if (err) {
      setError(err.message)
    } else if (shareStatusLabel[data.method]) {
      setShareStatus(data.method)
    }
    setBusy(null)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-xl border border-ink-300/60 px-4 py-2 text-sm font-medium hover:bg-ink-100 disabled:opacity-40 dark:hover:bg-ink-700/30"
          onClick={handleCsv}
          disabled={!hasRows || busy !== null}
        >
          {busy === 'csv' ? 'Preparing…' : 'Download CSV'}
        </button>

        {canPrint && (
          <button
            type="button"
            className="rounded-xl border border-ink-300/60 px-4 py-2 text-sm font-medium hover:bg-ink-100 disabled:opacity-40 dark:hover:bg-ink-700/30"
            onClick={handlePrint}
            disabled={busy !== null}
          >
            {busy === 'print' ? 'Opening…' : 'Print'}
          </button>
        )}

        {shareUrl && (
          <button
            type="button"
            className="rounded-xl border border-ink-300/60 px-4 py-2 text-sm font-medium hover:bg-ink-100 disabled:opacity-40 dark:hover:bg-ink-700/30"
            onClick={toggleQr}
            disabled={busy !== null}
            aria-expanded={showQr}
          >
            {busy === 'qr' ? 'Building…' : showQr ? 'Hide QR' : 'Show QR'}
          </button>
        )}

        {canShare && (
          <button
            type="button"
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            onClick={handleShare}
            disabled={busy !== null}
          >
            {busy === 'share' ? 'Sharing…' : 'Share'}
          </button>
        )}
      </div>

      {error && (
        // One banner, dismissible, non-blocking. Never an alert().
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          <span className="flex-1">{error}</span>
          <button className="underline" onClick={() => setError(null)}>dismiss</button>
        </p>
      )}

      {shareStatus && (
        <p className="mt-3 rounded-xl bg-ok/10 px-4 py-3 text-sm text-ok">
          {shareStatusLabel[shareStatus]}
          <button className="ml-2 underline" onClick={() => setShareStatus(null)}>dismiss</button>
        </p>
      )}

      {showQr && qrSvg && (
        <div className="mt-4 inline-flex flex-col items-center gap-2 rounded-card border border-ink-300/60 bg-white p-4 dark:bg-ink-900/40">
          {/* Built entirely by qr.js from a boolean module grid — never from raw
              user text — so there's nothing here for dangerouslySetInnerHTML to inject. */}
          <div className="h-40 w-40 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <p className="max-w-40 truncate text-center text-xs text-ink-500" title={shareUrl}>{shareUrl}</p>
        </div>
      )}
    </>
  )
}
