/**
 * File storage adapter — same shape as src/lib/db.js, for binary files
 * instead of database rows. Read db.js first; this mirrors it deliberately.
 *
 * WHY THIS EXISTS
 * Two backends, picked automatically:
 *
 *   - no VITE_SUPABASE_URL set  -> localStorage, as data URLs. Works
 *                                  instantly, offline, zero setup.
 *   - VITE_SUPABASE_URL set     -> Supabase Storage. Shared, real, gives you
 *                                  back a public URL that survives a phone
 *                                  handed to a judge.
 *
 * localStorage's real budget is ~5 MB *per origin, across every key* —
 * db.js's tables live in there too. Storing full-size phone photos as data
 * URLs blows through that in one or two files. Resize with resize.js in
 * this folder before calling upload() with anything that came from a
 * camera. This module also checks the budget itself and returns a clear
 * error before the browser gets a chance to throw QuotaExceededError
 * mid-demo — that uncaught exception is the actual failure mode this file
 * exists to prevent.
 *
 * Every method returns { data, error } (or just { error } where there is no
 * row to hand back). Never throws.
 */

// Guarded with `?.` rather than db.js's bare `import.meta.env.X` so this
// file's pure exports (estimateBytes, wouldExceedQuota) can be imported and
// unit-tested under plain `node --test`, outside of Vite, where
// `import.meta.env` does not exist at all.
const url = import.meta.env?.VITE_SUPABASE_URL
const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY

export const backend = url && anonKey ? 'supabase' : 'local'

let client = null
async function supabase() {
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js')
    client = createClient(url, anonKey)
  }
  return client
}

// --- localStorage backend ---------------------------------------------------

const KEY = (bucket) => `hack:storage:${bucket}`

// Conservative: leaves headroom under the real ~5 MB ceiling for whatever
// db.js is also keeping in localStorage under other keys.
export const LOCAL_BUDGET_BYTES = 4.5 * 1024 * 1024

function readLocal(bucket) {
  try {
    return JSON.parse(localStorage.getItem(KEY(bucket)) ?? '[]')
  } catch {
    // Corrupt storage should not white-screen the demo.
    return []
  }
}

function writeLocal(bucket, rows) {
  localStorage.setItem(KEY(bucket), JSON.stringify(rows)) // may throw QuotaExceededError — callers catch it
  return rows
}

const localId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/**
 * UTF-8 byte length of a string. Pure, no DOM required — TextEncoder exists
 * in both Node and every browser this kit targets.
 */
export function estimateBytes(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length
  return str.length * 2 // rough UTF-16 fallback if TextEncoder is somehow missing
}

/** True if adding `addBytes` to `currentBytes` would cross `budget`. */
export function wouldExceedQuota(currentBytes, addBytes, budget = LOCAL_BUDGET_BYTES) {
  return currentBytes + addBytes > budget
}

function localBucketBytes(bucket) {
  const raw = localStorage.getItem(KEY(bucket))
  return raw ? estimateBytes(raw) : 0
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Could not read this file.'))
    reader.readAsDataURL(file)
  })
}

// --- public API --------------------------------------------------------------

export const storage = {
  /**
   * Store one file. `bucket` namespaces the same way `table` does in
   * db.js. With Supabase it must already exist as a Storage bucket with a
   * public-read policy — see README.md for the exact setup.
   *
   * Returns { data: { id, name, type, size, url, created_at }, error }.
   * `id` is what you pass back into remove().
   */
  async upload(bucket, file, { onProgress } = {}) {
    if (backend === 'local') {
      try {
        onProgress?.(0.1)
        const dataUrl = await fileToDataURL(file)
        onProgress?.(0.6)

        const addBytes = estimateBytes(dataUrl)
        const current = localBucketBytes(bucket)
        if (wouldExceedQuota(current, addBytes)) {
          return {
            data: null,
            error: {
              message: `This browser's storage is full (~${(LOCAL_BUDGET_BYTES / 1024 / 1024).toFixed(1)} MB limit for the demo). Remove a file, or add Supabase keys to go to real storage.`,
            },
          }
        }

        const row = {
          id: localId(),
          name: file.name ?? 'file',
          type: file.type || 'application/octet-stream',
          size: file.size ?? addBytes,
          url: dataUrl,
          created_at: new Date().toISOString(),
        }

        try {
          writeLocal(bucket, [row, ...readLocal(bucket)])
        } catch {
          // Backstop: the pre-check above passed but the browser's actual
          // budget (or whatever else already lives in localStorage) says
          // otherwise. This is what stands between a full disk and an
          // uncaught exception mid-demo.
          return {
            data: null,
            error: { message: "This browser's storage is full. Remove a file, or add Supabase keys to go to real storage." },
          }
        }

        onProgress?.(1)
        return { data: row, error: null }
      } catch (e) {
        return { data: null, error: { message: e?.message || 'Could not store this file.' } }
      }
    }

    try {
      const sb = await supabase()
      const path = `${Date.now().toString(36)}-${(file.name ?? 'file').replace(/[^a-zA-Z0-9_.-]/g, '_')}`
      onProgress?.(0.1)
      // supabase-js's storage upload does not expose byte-level progress
      // (see README gotcha #2) — this is staged, not measured.
      const { error: upErr } = await sb.storage.from(bucket).upload(path, file, {
        contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
        upsert: false,
      })
      if (upErr) return { data: null, error: upErr }
      onProgress?.(0.9)

      const { data: pub } = sb.storage.from(bucket).getPublicUrl(path)
      onProgress?.(1)
      return {
        data: {
          id: path,
          name: file.name ?? 'file',
          type: file.type || 'application/octet-stream',
          size: file.size ?? 0,
          url: pub?.publicUrl ?? null,
          created_at: new Date().toISOString(),
        },
        error: null,
      }
    } catch (e) {
      return { data: null, error: { message: e?.message || 'Upload failed.' } }
    }
  },

  /** Remove one file by the id returned from upload(). */
  async remove(bucket, id) {
    if (backend === 'local') {
      writeLocal(bucket, readLocal(bucket).filter((r) => r.id !== id))
      return { error: null }
    }
    const sb = await supabase()
    const { error } = await sb.storage.from(bucket).remove([id])
    return { error }
  },

  /** List stored files, newest first. */
  async list(bucket) {
    if (backend === 'local') {
      const rows = readLocal(bucket).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      return { data: rows, error: null }
    }
    const sb = await supabase()
    const { data, error } = await sb.storage.from(bucket).list('', { sortBy: { column: 'created_at', order: 'desc' } })
    if (error) return { data: null, error }
    const rows = (data ?? []).map((f) => ({
      id: f.name,
      name: f.name,
      type: f.metadata?.mimetype ?? 'application/octet-stream',
      size: f.metadata?.size ?? 0,
      url: sb.storage.from(bucket).getPublicUrl(f.name).data?.publicUrl ?? null,
      created_at: f.created_at,
    }))
    return { data: rows, error: null }
  },

  /** Wipe a bucket. Handy to reset a demo to a known state. */
  async clear(bucket) {
    if (backend === 'local') {
      writeLocal(bucket, [])
      return { error: null }
    }
    const sb = await supabase()
    const { data, error: listErr } = await sb.storage.from(bucket).list()
    if (listErr) return { error: listErr }
    const names = (data ?? []).map((f) => f.name)
    if (names.length === 0) return { error: null }
    const { error } = await sb.storage.from(bucket).remove(names)
    return { error }
  },
}
