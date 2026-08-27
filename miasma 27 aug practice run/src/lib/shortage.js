/**
 * Shortage matching — U4 (owner: Robiul). MVP bullet 4.
 *
 * Paste target: `src/lib/shortage.js` in the drill repo, replacing the stub.
 * `store.js` already does `import { shortageReport } from './shortage.js'` and
 * re-exports it, so no other file needs to change for this to go live.
 *
 * Contract (verbatim from the stub's JSDoc + SPEC v2 "Severity"):
 *
 *   shortageReport(state) -> Array<{
 *     item, label, unit,
 *     totalNeed,           // Σ shelter need qty for this item, all shelters
 *     totalStock,          // Σ consignment qty for this item, all consignments
 *     gap,                 // totalNeed - totalStock
 *     shelters: Array<{ shelter, needQty, severity }>
 *   }>
 *
 *   - critical only when gap > 0; non-critical items are omitted entirely
 *   - groups sorted by gap descending (worst shortage first)
 *   - shelters within a group sorted by severity descending
 *   - severity = needQty * occupancyRatio, occupancyRatio = headcount / capacity
 *   - pure function of `state`; no side effects, no import of store.js
 *
 * Why the supply catalogue is duplicated here rather than imported: store.js
 * imports THIS file, so importing SUPPLY_ITEMS back from store.js would create
 * a module cycle — and the contract explicitly forbids "reaching into the store
 * module itself". A caller that already has the catalogue (or one loaded from
 * the public `supply_items` table) may pass it as `state.supplyItems` and this
 * copy is ignored; that is the drift-proof path once an api call exists for it.
 */

/** Fallback catalogue — must stay identical to SUPPLY_ITEMS in store.js. */
const SUPPLY_ITEMS = [
  ['rice', 'Rice', 'kg'],
  ['water', 'Drinking water', 'L'],
  ['dryfood', 'Dry food packs', 'packs'],
  ['ors', 'ORS sachets', 'sachets'],
  ['blanket', 'Blankets', 'pcs'],
  ['tarp', 'Tarpaulin', 'pcs'],
  ['babyfood', 'Baby formula', 'tins'],
  ['medkit', 'Medicine kits', 'kits'],
]

/**
 * Accepts either the `[value, label, unit]` tuple form store.js uses or the
 * row form the `supply_items` table returns (`{ value|item, label, unit }`),
 * so a future `fetchSupplyItems()` can be handed straight in.
 */
function buildCatalogue(supplyItems) {
  const source = Array.isArray(supplyItems) && supplyItems.length ? supplyItems : SUPPLY_ITEMS
  const catalogue = new Map()
  source.forEach((entry, index) => {
    if (Array.isArray(entry)) {
      const [value, label, unit] = entry
      if (value != null) catalogue.set(String(value), { label: label ?? String(value), unit: unit ?? '', index })
    } else if (entry && typeof entry === 'object') {
      const value = entry.value ?? entry.item
      if (value != null) {
        catalogue.set(String(value), { label: entry.label ?? String(value), unit: entry.unit ?? '', index })
      }
    }
  })
  return catalogue
}

/** Positive finite quantity, or 0 — keeps one bad row from poisoning a total. */
function qtyOf(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * headcount / capacity, or 0 when capacity is missing/zero/non-numeric.
 * Returning 0 rather than Infinity/NaN is deliberate: a NaN severity would
 * make Array.prototype.sort's comparator inconsistent and silently scramble
 * the whole ranking, which is the one output a judge reads directly.
 */
function occupancyRatio(shelter) {
  const capacity = Number(shelter?.capacity)
  const headcount = Number(shelter?.headcount)
  if (!Number.isFinite(capacity) || capacity <= 0) return 0
  if (!Number.isFinite(headcount) || headcount < 0) return 0
  return headcount / capacity
}

/**
 * Rebuild SPEC's `shelter.needs` from api.js's split reads.
 *
 * `fetchShelters()` returns pins with NO needs (shelters is the one public
 * table); `fetchNeeds()` returns a flat `{shelterId, item, qty}` list behind the
 * approved-session gate. api.js's own doc says the caller groups them back
 * together — this is that step, kept here as a pure function rather than inline
 * in the component so `node --test` can cover it.
 *
 * @param {Array} shelters from fetchShelters()
 * @param {Array} needs    from fetchNeeds()
 * @returns {Array} new shelter objects with `needs` attached, sorted desc by qty
 */
export function attachNeeds(shelters, needs) {
  const list = Array.isArray(shelters) ? shelters : []
  const byShelter = new Map()
  for (const need of Array.isArray(needs) ? needs : []) {
    const key = need?.shelterId
    if (key == null) continue
    const qty = qtyOf(need?.qty)
    const item = need?.item == null ? '' : String(need.item)
    if (!item || qty === 0) continue
    if (!byShelter.has(key)) byShelter.set(key, [])
    byShelter.get(key).push({ item, qty })
  }
  // Sorted desc so a popup or a table can slice(0, 3) for "top needs" without
  // re-sorting, matching the order store.js's local seed already guarantees.
  for (const rows of byShelter.values()) rows.sort((a, b) => b.qty - a.qty)
  return list.map((shelter) => ({ ...shelter, needs: byShelter.get(shelter?.id) ?? [] }))
}

export function shortageReport(state) {
  const shelters = Array.isArray(state?.shelters) ? state.shelters : []
  const consignments = Array.isArray(state?.consignments) ? state.consignments : []
  const catalogue = buildCatalogue(state?.supplyItems)

  // item -> total need, and item -> per-shelter rows. Duplicate need rows for
  // the same shelter+item are summed rather than last-wins: two rows for the
  // same item is bad data, but dropping one understates a real shortage.
  const totalNeed = new Map()
  const perShelter = new Map()

  for (const shelter of shelters) {
    if (!shelter || !Array.isArray(shelter.needs)) continue
    const byItem = new Map()
    for (const need of shelter.needs) {
      const item = need?.item == null ? '' : String(need.item)
      const qty = qtyOf(need?.qty)
      if (!item || qty === 0) continue
      byItem.set(item, (byItem.get(item) ?? 0) + qty)
    }
    const ratio = occupancyRatio(shelter)
    for (const [item, needQty] of byItem) {
      totalNeed.set(item, (totalNeed.get(item) ?? 0) + needQty)
      if (!perShelter.has(item)) perShelter.set(item, [])
      perShelter.get(item).push({ shelter, needQty, severity: needQty * ratio })
    }
  }

  const totalStock = new Map()
  for (const consignment of consignments) {
    const item = consignment?.item == null ? '' : String(consignment.item)
    const qty = qtyOf(consignment?.qty)
    if (!item || qty === 0) continue
    totalStock.set(item, (totalStock.get(item) ?? 0) + qty)
  }

  const groups = []
  for (const [item, need] of totalNeed) {
    const stock = totalStock.get(item) ?? 0
    const gap = need - stock
    if (gap <= 0) continue // not critical — omitted entirely, per contract

    // An item outside the fixed catalogue should never reach here (U3 validates
    // CSV rows against it), but surfacing it under its raw value beats silently
    // dropping a genuine shortage.
    const meta = catalogue.get(item) ?? { label: item, unit: '', index: Number.MAX_SAFE_INTEGER }

    groups.push({
      item,
      label: meta.label,
      unit: meta.unit,
      totalNeed: need,
      totalStock: stock,
      gap,
      shelters: (perShelter.get(item) ?? []).sort(
        (a, b) =>
          b.severity - a.severity ||
          b.needQty - a.needQty ||
          String(a.shelter?.name ?? '').localeCompare(String(b.shelter?.name ?? ''))
      ),
      _order: meta.index,
    })
  }

  // Worst gap first. Ties broken by catalogue order so the board never reorders
  // itself between renders on equal gaps (tests and the demo both depend on a
  // stable sequence).
  groups.sort((a, b) => b.gap - a.gap || a._order - b._order)
  return groups.map(({ _order, ...group }) => group)
}
