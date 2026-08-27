/**
 * Drag-and-drop / file-picker / camera-capture upload, with thumbnails,
 * per-file progress, per-file remove, a running total, and rejection
 * reasons shown inline rather than as a stack trace.
 *
 * Pairs with resize.js (shrinks images client-side before they touch
 * storage) and storage.js (localStorage-or-Supabase, same { data, error }
 * contract as src/lib/db.js). All three ship together — copy the whole
 * folder in, then trim what you don't need.
 *
 * States shipped: empty, picking, per-file processing/uploading progress,
 * per-file error (oversized file, bad image, storage full), per-file
 * done, and a page-level error banner for a failed remove. Replace BUCKET,
 * the copy, and the styling; keep the states.
 */
import { useRef, useState } from 'react'
import { resizeImage, isImageFile } from './resize.js'
import { storage, backend } from './storage.js'

// Must exist as a Supabase Storage bucket with a public-read policy when
// VITE_SUPABASE_URL is set — see README.md for the exact setup.
const BUCKET = 'uploads'

const MAX_DIM = 1600 // longest edge, px — passed straight to resize.js
const MAX_FILES = 12 // keeps a demo list scrollable, not a hard product limit
const MAX_RAW_BYTES = 20 * 1024 * 1024 // reject outright before reading; guards against a stray video drop freezing the tab

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function nextId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function Upload() {
  const [entries, setEntries] = useState([])
  const [dragging, setDragging] = useState(false)
  const [pageError, setPageError] = useState(null)
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  // Mirrors the current `entries` for use inside async callbacks that were
  // scheduled against an id, without needing to re-derive from stale closures.
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  const totalSize = entries.reduce((sum, e) => sum + (e.size || 0), 0)
  const doneCount = entries.filter((e) => e.status === 'done').length

  function patch(id, changes) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...changes } : e)))
  }

  /** Resize (if it's an image) then upload. Runs per-file so one bad file never blocks the rest. */
  async function processFile(id, file) {
    let payload = file
    const image = isImageFile(file)

    if (image) {
      const { data, error: err } = await resizeImage(file, MAX_DIM)
      if (err) {
        patch(id, { status: 'error', error: err.message, progress: 0 })
        return
      }
      payload = data.blob
      patch(id, { thumbnail: data.dataUrl, size: data.size, type: data.type, progress: 0.4 })
    }

    patch(id, { status: 'uploading' })
    const base = image ? 0.4 : 0.05
    const { data, error: err } = await storage.upload(BUCKET, payload, {
      onProgress: (p) => patch(id, { progress: base + p * (1 - base) }),
    })

    if (err) {
      patch(id, { status: 'error', error: err.message, progress: 0 })
      return
    }
    patch(id, { status: 'done', progress: 1, url: data.url, storageId: data.id, size: data.size })
  }

  async function addFiles(fileList) {
    const incoming = Array.from(fileList ?? [])
    // Count synchronously against a running total rather than re-reading
    // state/ref mid-loop — this loop has no `await` between iterations, so
    // no render has flushed yet and `entries` would still read stale anyway.
    let count = entriesRef.current.length

    for (const file of incoming) {
      if (count >= MAX_FILES) {
        setPageError(`Only ${MAX_FILES} files at a time here — remove one first.`)
        break
      }

      const id = nextId()
      if (file.size > MAX_RAW_BYTES) {
        // Rejected before it is ever read — a 20 MB+ file is what actually
        // freezes a tab, not the resize step, which is why the guard sits
        // here rather than inside resize.js.
        const entry = {
          id,
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          status: 'error',
          progress: 0,
          thumbnail: null,
          url: null,
          storageId: null,
          error: `Too large (${formatSize(file.size)}). Max ${formatSize(MAX_RAW_BYTES)}.`,
        }
        setEntries((prev) => [entry, ...prev])
        count += 1
        continue
      }

      const entry = {
        id,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        status: 'processing',
        progress: 0.05,
        thumbnail: null,
        url: null,
        storageId: null,
        error: null,
      }
      setEntries((prev) => [entry, ...prev])
      count += 1
      processFile(id, file)
    }
  }

  async function removeEntry(entry) {
    const snapshot = entriesRef.current
    setEntries((prev) => prev.filter((e) => e.id !== entry.id))
    if (entry.status === 'done' && entry.storageId) {
      const { error: err } = await storage.remove(BUCKET, entry.storageId)
      if (err) {
        // Put it back rather than silently losing track of a file that is
        // still sitting in storage.
        setEntries(snapshot)
        setPageError(err.message)
      }
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer?.files)
  }
  function onDragOver(e) {
    e.preventDefault()
    setDragging(true)
  }

  return (
    <section className="mx-auto w-full max-w-xl px-4 pb-24">
      <div
        className={`cursor-pointer rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging ? 'border-accent bg-accent-soft' : 'border-ink-300/70'
        }`}
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            fileInputRef.current?.click()
          }
        }}
        role="button"
        tabIndex="0"
        aria-label="Drag files here, or click to browse"
      >
        <p className="text-ink-500">Drag files here, or click to browse</p>
        <p className="mt-1 text-xs text-ink-500">Images are resized in your browser before upload.</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(e.currentTarget.files)
          e.currentTarget.value = '' // lets the same file be re-picked after a remove
        }}
      />

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className="rounded-xl border border-ink-300/60 px-4 py-2 text-sm font-medium hover:bg-ink-100 dark:hover:bg-ink-700/30"
          onClick={() => cameraInputRef.current?.click()}
        >
          Take photo
        </button>
        <span className="text-xs text-ink-500">phones only — desktop opens the file picker instead</span>
      </div>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          addFiles(e.currentTarget.files)
          e.currentTarget.value = ''
        }}
      />

      {pageError && (
        // One banner, dismissible, non-blocking. Never an alert().
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          <span className="flex-1">{pageError}</span>
          <button className="underline" onClick={() => setPageError(null)}>
            dismiss
          </button>
        </p>
      )}

      {entries.length === 0 ? (
        // Empty state does a job: it explains and it names the next action.
        <div className="mt-10 rounded-card border border-dashed border-ink-300/70 px-6 py-10 text-center">
          <p className="text-ink-500">No files yet.</p>
          <p className="mt-1 text-xs text-ink-500">Drag one onto the box above, or use "Take photo" on a phone.</p>
        </div>
      ) : (
        <>
          <ul className="mt-6 space-y-2">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 rounded-card bg-white px-4 py-3 shadow-sm dark:bg-ink-900/40">
                {entry.thumbnail ? (
                  <img src={entry.thumbnail} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div
                    className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-[10px] uppercase text-ink-500 dark:bg-ink-700/30"
                    aria-hidden="true"
                  >
                    {(entry.type.split('/')[1] || 'file').slice(0, 4)}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.name}</p>
                  <p className="text-xs text-ink-500">{formatSize(entry.size)}</p>

                  {entry.status === 'processing' || entry.status === 'uploading' ? (
                    <>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-700/30" aria-hidden="true">
                        <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(entry.progress * 100)}%` }}></div>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-500">{entry.status === 'processing' ? 'Preparing…' : 'Uploading…'}</p>
                    </>
                  ) : entry.status === 'error' ? (
                    <p className="mt-0.5 text-xs text-danger">{entry.error}</p>
                  ) : entry.status === 'done' ? (
                    <p className="mt-0.5 text-xs text-ok">Uploaded</p>
                  ) : null}
                </div>

                <button
                  className="shrink-0 px-2 text-ink-500 hover:text-danger"
                  onClick={() => removeEntry(entry)}
                  aria-label={`Remove "${entry.name}"`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-sm text-ink-500">
            {doneCount} of {entries.length} uploaded · {formatSize(totalSize)} total · stored in{' '}
            {backend === 'supabase' ? 'Supabase' : 'this browser'}
          </p>
        </>
      )}
    </section>
  )
}
