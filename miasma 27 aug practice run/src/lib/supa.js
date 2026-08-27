/**
 * Supabase client singleton for Relief Lens v2 (client + volunteer access).
 *
 * Reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from the environment
 * (see .env.example). When either is missing, `hasSupabase()` returns false
 * and `supabase` is `null` — every other module that needs a backend
 * (`./auth.js`, `./api.js`) checks `hasSupabase()` first and falls back to
 * the localStorage store (`./store.js`) so the app keeps running with zero
 * setup during UI dev, same trick `src/lib/db.js` and the recipes use.
 *
 * SECURITY NOTE: only the ANON key belongs in this file (and in any
 * `VITE_`-prefixed env var, which ships in the browser bundle either way).
 * The anon key is public-by-design — it is safe to expose only because
 * Postgres row-level security (RLS) is the real access boundary for every
 * table it touches. The service_role key bypasses RLS entirely and must
 * NEVER be imported here, referenced in client code, or committed anywhere
 * in this repo.
 *
 * `createClient` is only ever called when both env vars are present, so
 * calling this module with no Supabase configured never throws (an
 * `undefined` URL passed to `createClient` throws immediately).
 */
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True when both Supabase env vars are set. UI/data layers branch on this. */
export function hasSupabase() {
  return Boolean(url && anonKey)
}

/**
 * The shared Supabase client, or `null` when not configured. A single
 * instance is exported (rather than one per caller) to avoid supabase-js's
 * "Multiple GoTrueClient instances" warning — every module that needs
 * Supabase imports this same client instead of calling `createClient` again.
 */
export const supabase = hasSupabase() ? createClient(url, anonKey) : null
