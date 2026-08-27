/**
 * Storage adapter.
 *
 * WHY THIS EXISTS
 * At 18:20 on the night you need a live URL, not a database. Waiting on a
 * Supabase project, a schema, and a row-level-security policy before the first
 * feature works is how teams lose the first hour.
 *
 * So this module has two backends and picks automatically:
 *
 *   - no VITE_SUPABASE_URL set  -> localStorage. Works instantly, offline,
 *                                  zero setup. Data is per-browser, which is
 *                                  fine for a single-device demo.
 *   - VITE_SUPABASE_URL set     -> Supabase. Shared, real, survives a phone
 *                                  handed to a judge.
 *
 * Build against localStorage first. Paste the keys later and the app upgrades
 * without a single call-site changing. If the clock runs out, localStorage
 * still demos — "it works" is scored, "it uses Postgres" is not.
 *
 * Every method returns { data, error }. Never throws. A hackathon app that
 * throws on a network blip loses criterion 1 in front of the judge.
 */

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

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

const KEY = (table) => `hack:${table}`

function readLocal(table) {
  try {
    return JSON.parse(localStorage.getItem(KEY(table)) ?? '[]')
  } catch {
    // Corrupt storage should not white-screen the demo.
    return []
  }
}

function writeLocal(table, rows) {
  localStorage.setItem(KEY(table), JSON.stringify(rows))
  return rows
}

// Monotonic enough for a 4-hour demo, and sorts lexically by creation time.
const localId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

// --- public API -------------------------------------------------------------

export const db = {
  /** List rows, newest first. */
  async list(table) {
    if (backend === 'local') {
      const rows = readLocal(table).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      return { data: rows, error: null }
    }
    const sb = await supabase()
    return sb.from(table).select('*').order('created_at', { ascending: false })
  },

  /** Insert one row. Returns the created row. */
  async insert(table, row) {
    if (backend === 'local') {
      const created = { id: localId(), created_at: new Date().toISOString(), ...row }
      writeLocal(table, [created, ...readLocal(table)])
      return { data: created, error: null }
    }
    const sb = await supabase()
    const { data, error } = await sb.from(table).insert(row).select().single()
    return { data, error }
  },

  /** Patch one row by id. */
  async update(table, id, patch) {
    if (backend === 'local') {
      const rows = readLocal(table).map((r) => (r.id === id ? { ...r, ...patch } : r))
      writeLocal(table, rows)
      return { data: rows.find((r) => r.id === id) ?? null, error: null }
    }
    const sb = await supabase()
    const { data, error } = await sb.from(table).update(patch).eq('id', id).select().single()
    return { data, error }
  },

  /** Delete one row by id. */
  async remove(table, id) {
    if (backend === 'local') {
      writeLocal(table, readLocal(table).filter((r) => r.id !== id))
      return { data: null, error: null }
    }
    const sb = await supabase()
    const { error } = await sb.from(table).delete().eq('id', id)
    return { data: null, error }
  },

  /** Wipe a table. Used by the seed button so demos start from a known state. */
  async clear(table) {
    if (backend === 'local') {
      writeLocal(table, [])
      return { data: null, error: null }
    }
    const sb = await supabase()
    const { error } = await sb.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
    return { data: null, error }
  },
}
