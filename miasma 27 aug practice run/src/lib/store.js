/**
 * Relief Lens — single state module. Every unit imports from HERE and only
 * here (SPEC.md "Store interface"). It is a plain observable store: one
 * object in memory, a Set of subscriber callbacks, localStorage persistence.
 * No zustand, no new dependencies — the whole thing is ~150 lines because the
 * contract only needs get/subscribe/two mutations.
 *
 * Frozen contract (do not change shapes without updating SPEC.md + telling
 * every other unit — ask the integrator instead of editing):
 *
 *   getState()                                   -> { shelters, updates, consignments }
 *   subscribe(fn)                                -> fn(state) on every change; returns unsubscribe
 *   submitUpdate({ shelterId, headcount, needs, note }) -> applies to the shelter too
 *   addConsignments(rows)                        -> appends CSV rows, each given an id
 *   occupancyLevel(shelter)                      -> 'ok' | 'near-full' | 'over'
 *   shortageReport(state)                        -> re-exported from ./shortage.js (U4's core)
 */
import { shortageReport } from './shortage.js'

// The ONLY allowed need/stock items — [value, label, unit]. Nobody invents fields.
export const SUPPLY_ITEMS = [
  ['rice', 'Rice', 'kg'],
  ['water', 'Drinking water', 'L'],
  ['dryfood', 'Dry food packs', 'packs'],
  ['ors', 'ORS sachets', 'sachets'],
  ['blanket', 'Blankets', 'pcs'],
  ['tarp', 'Tarpaulin', 'pcs'],
  ['babyfood', 'Baby formula', 'tins'],
  ['medkit', 'Medicine kits', 'kits'],
]

const STORAGE_KEY = 'relief-lens-v1'

// --- small helpers -----------------------------------------------------

function sortNeedsDesc(needs) {
  return [...needs].sort((a, b) => b.qty - a.qty)
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function hasLocalStorage() {
  return typeof localStorage !== 'undefined'
}

// --- seed data -----------------------------------------------------------
// 9 shelters across real unions of Raozan upazila, Chattogram district.
// Occupancy mix is exactly 2 over / 3 near-full / 4 ok so the map (U1) and
// board (U4) have something to colour-code from the first paint. 5
// consignments are seeded deliberately short on several items (rice,
// tarpaulin, blankets, baby formula, medicine kits) so a critical gap
// already exists for the U4 demo before anyone imports a CSV.

function buildSeed() {
  const shelters = [
    {
      id: 'raozan-pourashava-high-school',
      name: 'Raozan Pourashava High School Shelter',
      upazila: 'Raozan Pourashava',
      lat: 22.4917,
      lng: 91.935,
      capacity: 320,
      headcount: 412,
      needs: sortNeedsDesc([
        { item: 'rice', qty: 380 },
        { item: 'water', qty: 300 },
        { item: 'tarp', qty: 120 },
      ]),
      updatedAt: '2026-08-27T09:10:00.000Z',
    },
    {
      id: 'gohira-union-parishad',
      name: 'Gohira Union Parishad Shelter',
      upazila: 'Gohira',
      lat: 22.535,
      lng: 91.91,
      capacity: 250,
      headcount: 300,
      needs: sortNeedsDesc([
        { item: 'water', qty: 250 },
        { item: 'ors', qty: 150 },
        { item: 'blanket', qty: 100 },
        { item: 'babyfood', qty: 40 },
      ]),
      updatedAt: '2026-08-27T08:57:00.000Z',
    },
    {
      id: 'noapara-degree-college',
      name: 'Noapara Degree College Shelter',
      upazila: 'Noapara',
      lat: 22.501,
      lng: 91.97,
      capacity: 200,
      headcount: 180,
      needs: sortNeedsDesc([
        { item: 'blanket', qty: 150 },
        { item: 'rice', qty: 120 },
      ]),
      updatedAt: '2026-08-27T08:41:00.000Z',
    },
    {
      id: 'urkirchar-pilot-high-school',
      name: 'Urkirchar Pilot High School Shelter',
      upazila: 'Urkirchar',
      lat: 22.56,
      lng: 91.955,
      capacity: 220,
      headcount: 198,
      needs: sortNeedsDesc([
        { item: 'tarp', qty: 90 },
        { item: 'dryfood', qty: 80 },
        { item: 'medkit', qty: 30 },
      ]),
      updatedAt: '2026-08-27T09:04:00.000Z',
    },
    {
      id: 'binajuri-model-high-school',
      name: 'Binajuri Model High School Shelter',
      upazila: 'Binajuri',
      lat: 22.478,
      lng: 91.895,
      capacity: 180,
      headcount: 153,
      needs: sortNeedsDesc([
        { item: 'water', qty: 140 },
        { item: 'ors', qty: 60 },
      ]),
      updatedAt: '2026-08-27T08:26:00.000Z',
    },
    {
      id: 'kadalpur-community-center',
      name: 'Kadalpur Community Center Shelter',
      upazila: 'Kadalpur',
      lat: 22.605,
      lng: 92.005,
      capacity: 400,
      headcount: 220,
      needs: sortNeedsDesc([
        { item: 'dryfood', qty: 100 },
        { item: 'babyfood', qty: 25 },
        { item: 'medkit', qty: 15 },
      ]),
      updatedAt: '2026-08-27T07:59:00.000Z',
    },
    {
      id: 'chikdair-primary-school',
      name: 'Chikdair Primary School Shelter',
      upazila: 'Chikdair',
      lat: 22.585,
      lng: 91.98,
      capacity: 150,
      headcount: 90,
      needs: sortNeedsDesc([
        { item: 'rice', qty: 70 },
        { item: 'blanket', qty: 50 },
      ]),
      updatedAt: '2026-08-27T07:45:00.000Z',
    },
    {
      id: 'dabua-union-shelter',
      name: 'Dabua Union Shelter',
      upazila: 'Dabua',
      lat: 22.545,
      lng: 92.02,
      capacity: 260,
      headcount: 140,
      needs: sortNeedsDesc([
        { item: 'water', qty: 90 },
        { item: 'tarp', qty: 40 },
        { item: 'ors', qty: 30 },
        { item: 'medkit', qty: 10 },
      ]),
      updatedAt: '2026-08-27T07:30:00.000Z',
    },
    {
      // id kept as the original Sylhet-era slug on purpose: store.test.mjs
      // hardcodes this exact id in its submitUpdate test ("fix seed, not
      // tests" — see CLAUDE.md) — only the geography/content moved to Raozan.
      id: 'jaintiapur-bazar-shelter',
      name: 'Pahartali Bazar Shelter',
      upazila: 'Pahartali',
      lat: 22.615,
      lng: 91.93,
      capacity: 300,
      headcount: 200,
      needs: sortNeedsDesc([
        { item: 'dryfood', qty: 60 },
        { item: 'babyfood', qty: 20 },
      ]),
      updatedAt: '2026-08-27T07:15:00.000Z',
    },
  ]

  // 6 recent updates, newest first, timestamps relative to "now" so the feed
  // always reads as "within the last 2 hours" no matter when the demo runs.
  const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString()
  const updates = [
    {
      id: 'seed-u1',
      shelterId: 'raozan-pourashava-high-school',
      headcount: 412,
      needs: sortNeedsDesc([
        { item: 'rice', qty: 380 },
        { item: 'water', qty: 300 },
        { item: 'tarp', qty: 120 },
      ]),
      note: 'Water rising near school compound, more families arriving by boat.',
      at: minutesAgo(5),
    },
    {
      id: 'seed-u2',
      shelterId: 'gohira-union-parishad',
      headcount: 300,
      needs: sortNeedsDesc([
        { item: 'water', qty: 250 },
        { item: 'ors', qty: 150 },
        { item: 'blanket', qty: 100 },
      ]),
      note: 'Diarrhoea cases reported, ORS needed urgently.',
      at: minutesAgo(18),
    },
    {
      id: 'seed-u3',
      shelterId: 'urkirchar-pilot-high-school',
      headcount: 198,
      needs: sortNeedsDesc([
        { item: 'tarp', qty: 90 },
        { item: 'dryfood', qty: 80 },
      ]),
      note: 'Roof leaking in east wing, tarpaulin needed.',
      at: minutesAgo(34),
    },
    {
      id: 'seed-u4',
      shelterId: 'binajuri-model-high-school',
      headcount: 153,
      needs: sortNeedsDesc([{ item: 'water', qty: 140 }]),
      note: 'Tube well contaminated, drinking water critical.',
      at: minutesAgo(52),
    },
    {
      id: 'seed-u5',
      shelterId: 'noapara-degree-college',
      headcount: 180,
      needs: sortNeedsDesc([{ item: 'blanket', qty: 150 }]),
      note: 'Cold nights, blanket stock running low.',
      at: minutesAgo(77),
    },
    {
      id: 'seed-u6',
      shelterId: 'kadalpur-community-center',
      headcount: 220,
      needs: sortNeedsDesc([{ item: 'babyfood', qty: 25 }]),
      note: 'Infant formula stock almost finished.',
      at: minutesAgo(104),
    },
  ]

  // 5 consignments. Deliberately covers water/dryfood/ors fully but leaves
  // rice/tarp short and blanket/babyfood/medkit uncovered entirely, so a
  // critical gap (totalNeed > totalStock) already exists for several items
  // before any CSV import happens.
  const consignments = [
    { id: 'seed-c1', ngo: 'BRAC', item: 'rice', qty: 300, unit: 'kg', etaHours: 6 },
    { id: 'seed-c2', ngo: 'BDRCS', item: 'water', qty: 800, unit: 'L', etaHours: 4 },
    { id: 'seed-c3', ngo: 'Ahsania Mission', item: 'dryfood', qty: 300, unit: 'packs', etaHours: 10 },
    { id: 'seed-c4', ngo: 'Muslim Aid', item: 'ors', qty: 300, unit: 'sachets', etaHours: 8 },
    { id: 'seed-c5', ngo: 'CARE Bangladesh', item: 'tarp', qty: 100, unit: 'pcs', etaHours: 12 },
  ]

  return { shelters, updates, consignments }
}

// --- persistence ---------------------------------------------------------

function loadPersisted() {
  if (!hasLocalStorage()) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.shelters)) return null
    return parsed
  } catch {
    // Corrupt storage should not white-screen the demo — fall back to seed.
    return null
  }
}

function persist(nextState) {
  if (!hasLocalStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState))
  } catch {
    // Storage full/blocked (private mode etc.) — demo keeps running in memory.
  }
}

// --- the store -------------------------------------------------------------

let state = loadPersisted() ?? buildSeed()
const listeners = new Set()

function emit() {
  persist(state)
  for (const fn of listeners) fn(state)
}

/** Current { shelters, updates, consignments }. */
export function getState() {
  return state
}

/** fn(state) is called on every mutation. Returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Field update entry (bullet 2). Creates an update record and applies its
 * headcount/needs/updatedAt to the matching shelter in the same tick.
 */
export function submitUpdate({ shelterId, headcount, needs, note }) {
  const at = new Date().toISOString()
  const sortedNeeds = sortNeedsDesc(needs)
  const record = { id: makeId('u'), shelterId, headcount, needs: sortedNeeds, note, at }

  const shelters = state.shelters.map((s) =>
    s.id === shelterId ? { ...s, headcount, needs: sortedNeeds, updatedAt: at } : s
  )

  state = { ...state, shelters, updates: [record, ...state.updates] }
  emit()
  return record
}

/** Aid inventory import (bullet 3). Appends valid CSV rows, each given an id. */
export function addConsignments(rows) {
  const withIds = rows.map((row) => ({ id: makeId('c'), ...row }))
  state = { ...state, consignments: [...state.consignments, ...withIds] }
  emit()
  return withIds
}

/** Single source of truth for occupancy colour, used by map AND board. */
export function occupancyLevel(shelter) {
  const ratio = shelter.headcount / shelter.capacity
  if (ratio > 1) return 'over'
  if (ratio >= 0.85) return 'near-full'
  return 'ok'
}

/** Debug helper: wipe persisted state and reload the seed. */
export function resetToSeed() {
  state = buildSeed()
  emit()
  return state
}

// Shortage board (bullet 4) is U4's core — store just re-exports it so every
// unit can import from this one module.
export { shortageReport }
