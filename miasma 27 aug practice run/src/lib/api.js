/**
 * Data access layer for Relief Lens v2 — the ONE module every screen/job
 * imports from for shelters/needs/updates/consignments. It mirrors the
 * localStorage store's contract (see ./store.js, SPEC.md "Store interface")
 * but splits the single embedded `shelter.needs` array into its own fetch,
 * because the Supabase schema keeps that split for row-level security:
 * `shelters` is public (anon-readable — map pin, capacity, headcount only,
 * NOTHING else), `shelter_needs` requires an authenticated + approved
 * session. Callers that want a shelter with its needs attached (e.g. a map
 * popup) combine `fetchShelters()` + `fetchNeeds()` client-side, grouping
 * needs by `shelterId`.
 *
 * Every exported function returns/throws the same way regardless of
 * backend:
 *   - hasSupabase() true  -> talks to Postgres via ./supa.js. RLS is the
 *     real access wall — a rejected write surfaces as a thrown error here,
 *     not a silent no-op.
 *   - hasSupabase() false -> delegates to ./store.js (localStorage), so the
 *     app and every component work with zero setup during UI dev — the
 *     same trick db.js / auth.js / live.js use in src/recipes/.
 *
 * Errors are never swallowed: a Supabase error becomes
 * `throw new Error(readableMessage)`. A bad input, a network blip, or an
 * RLS rejection should surface as a message a component can show.
 *
 * SCHEMA COLUMN NAMES (see schema.sql / PERMISSIONS.md — the authoritative
 * source; keep these mappings in sync with it):
 *   shelters(id, name, union_name, upazila, district, lat, lng, capacity,
 *     headcount, updated_at) — `union_name` is the per-shelter locality
 *     label (e.g. "Gohira"); `upazila`/`district` are constants ("Raozan" /
 *     "Chattogram"), so the JS-facing `upazila` field below is sourced from
 *     `union_name`, matching what store.js's local seed puts in that field.
 *   shelter_needs(id, shelter_id, item, qty)
 *   updates(id, shelter_id, author, headcount, needs jsonb, note, created_at)
 *     — `author` defaults to auth.uid() server-side; never sent from here.
 *   consignments(id, ngo, item, qty, unit, eta_hours, created_by, created_at)
 *     — `created_by` defaults to auth.uid() server-side; never sent from here.
 */
import { supabase, hasSupabase } from './supa.js'
import * as store from './store.js'

function fail(error, fallbackMessage) {
  throw new Error(error?.message || fallbackMessage)
}

function sortNeedsDesc(needs) {
  return [...needs].sort((a, b) => b.qty - a.qty)
}

// --- row <-> JS shape mapping (Supabase branch only — store.js already
// speaks the JS shape natively) ---------------------------------------------

function mapShelterRow(row) {
  return {
    id: row.id,
    name: row.name,
    upazila: row.union_name,
    lat: row.lat,
    lng: row.lng,
    capacity: row.capacity,
    headcount: row.headcount,
    updatedAt: row.updated_at,
  }
}

function mapNeedRow(row) {
  return { shelterId: row.shelter_id, item: row.item, qty: row.qty }
}

function mapUpdateRow(row) {
  return {
    id: row.id,
    shelterId: row.shelter_id,
    headcount: row.headcount,
    needs: row.needs ?? [],
    note: row.note,
    at: row.created_at,
  }
}

function mapConsignmentRow(row) {
  return { id: row.id, ngo: row.ngo, item: row.item, qty: row.qty, unit: row.unit, etaHours: row.eta_hours }
}

// --- public reads (shelters table only — no login required) ----------------

/** Shelter pins for the map: id/name/location/capacity/headcount. No needs. */
export async function fetchShelters() {
  if (!hasSupabase()) {
    return store.getState().shelters.map(({ id, name, upazila, lat, lng, capacity, headcount, updatedAt }) => ({
      id,
      name,
      upazila,
      lat,
      lng,
      capacity,
      headcount,
      updatedAt,
    }))
  }
  const { data, error } = await supabase
    .from('shelters')
    .select('id, name, union_name, lat, lng, capacity, headcount, updated_at')
  if (error) fail(error, 'Could not load shelters.')
  return (data ?? []).map(mapShelterRow)
}

// --- authenticated + approved reads -----------------------------------------

/**
 * Every shelter's needs as a flat list of `{ shelterId, item, qty }`, sorted
 * desc by qty within each shelter (group by `shelterId` client-side to
 * reconstruct SPEC.md's `shelter.needs` for a popup / the shortage board).
 */
export async function fetchNeeds() {
  if (!hasSupabase()) {
    return store
      .getState()
      .shelters.flatMap((s) => sortNeedsDesc(s.needs).map((n) => ({ shelterId: s.id, item: n.item, qty: n.qty })))
  }
  const { data, error } = await supabase
    .from('shelter_needs')
    .select('shelter_id, item, qty')
    .order('qty', { ascending: false })
  if (error) fail(error, 'Could not load shelter needs.')
  return (data ?? []).map(mapNeedRow)
}

/** Most recent 50 field updates, newest first. */
export async function fetchUpdates() {
  if (!hasSupabase()) {
    return store.getState().updates.slice(0, 50)
  }
  const { data, error } = await supabase
    .from('updates')
    .select('id, shelter_id, headcount, needs, note, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) fail(error, 'Could not load updates.')
  return (data ?? []).map(mapUpdateRow)
}

/** All consignments (seeded + CSV-imported). */
export async function fetchConsignments() {
  if (!hasSupabase()) {
    return store.getState().consignments
  }
  const { data, error } = await supabase.from('consignments').select('id, ngo, item, qty, unit, eta_hours')
  if (error) fail(error, 'Could not load consignments.')
  return (data ?? []).map(mapConsignmentRow)
}

// --- authenticated + approved writes ----------------------------------------

/**
 * Field update entry. Volunteers/commissioners/admins only — enforced by
 * RLS, not by this function (see auth.js's `can('submitUpdate', …)` for the
 * UX-only gate). On Supabase this is a plain INSERT into `updates`; a
 * SECURITY DEFINER trigger applies the headcount/needs to the matching
 * shelter and bumps its `updated_at` server-side, so this function does
 * NOT (and must not) touch the `shelters` table directly — volunteers never
 * get UPDATE on shelters. `author` is never sent; it is forced to
 * `auth.uid()` server-side.
 */
export async function submitUpdate({ shelterId, headcount, needs, note }) {
  const sortedNeeds = sortNeedsDesc(needs)
  if (!hasSupabase()) {
    return store.submitUpdate({ shelterId, headcount, needs: sortedNeeds, note })
  }
  const { data, error } = await supabase
    .from('updates')
    .insert({ shelter_id: shelterId, headcount, needs: sortedNeeds, note })
    .select('id, shelter_id, headcount, needs, note, created_at')
    .single()
  if (error) fail(error, 'Could not submit update.')
  return mapUpdateRow(data)
}

/**
 * Aid inventory import. Commissioners/admins only — enforced by RLS. `rows`
 * are already-validated CSV rows: `{ ngo, item, qty, unit, etaHours }`.
 */
export async function addConsignments(rows) {
  if (!hasSupabase()) {
    return store.addConsignments(rows)
  }
  const payload = rows.map(({ ngo, item, qty, unit, etaHours }) => ({
    ngo,
    item,
    qty,
    unit,
    eta_hours: etaHours,
  }))
  const { data, error } = await supabase
    .from('consignments')
    .insert(payload)
    .select('id, ngo, item, qty, unit, eta_hours')
  if (error) fail(error, 'Could not import consignments.')
  return (data ?? []).map(mapConsignmentRow)
}

// --- realtime ----------------------------------------------------------------

/**
 * One realtime subscription covering shelters/updates/consignments.
 * `cb({ table, eventType, row, old })` fires per change:
 *   - Supabase: one `postgres_changes` channel with a listener per table;
 *     `row`/`old` are mapped to this module's JS shape for that table
 *     (`old` is only populated on UPDATE/DELETE, per Postgres replica
 *     identity).
 *   - Local (no Supabase): there is no per-table diff to report, so `cb`
 *     fires with `{ table: 'local', eventType: 'change', row: null, old:
 *     null }` on every store mutation — treat that as "something changed,
 *     refetch what you show," the same way the local tiers in
 *     src/recipes/realtime/live.js work.
 * Returns an unsubscribe function either way.
 */
// Supabase forbids adding `postgres_changes` callbacks to a named channel
// after `.subscribe()`, and several panels subscribe independently — so ONE
// shared channel fans out to a listener set instead of a channel per caller.
const changeListeners = new Set()
let changeChannel = null

export function subscribeChanges(cb) {
  if (!hasSupabase()) {
    return store.subscribe(() => cb({ table: 'local', eventType: 'change', row: null, old: null }))
  }

  changeListeners.add(cb)

  if (!changeChannel) {
    const mappers = { shelters: mapShelterRow, updates: mapUpdateRow, consignments: mapConsignmentRow }
    const emit = (table, payload) => {
      const map = mappers[table]
      const event = {
        table,
        eventType: payload.eventType,
        row: payload.new ? map(payload.new) : null,
        old: payload.old ? map(payload.old) : null,
      }
      for (const listener of [...changeListeners]) listener(event)
    }
    changeChannel = supabase
      .channel('relief-lens-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shelters' }, (p) => emit('shelters', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'updates' }, (p) => emit('updates', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consignments' }, (p) => emit('consignments', p))
      .subscribe()
  }

  return () => {
    changeListeners.delete(cb)
    if (changeListeners.size === 0 && changeChannel) {
      supabase.removeChannel(changeChannel)
      changeChannel = null
    }
  }
}
