/**
 * Composable filters over a plain array, plus a facet counter.
 *
 * WHY THIS EXISTS
 * "Filter by category" is one `.filter()` call. "Filter by category AND
 * price range AND date, with chips that show how many results each option
 * would leave" is the part that eats an hour if you build it ad hoc per
 * filter. This module makes every filter the same shape — { type, field,
 * ...params } — so the UI can render, add, and remove them generically, and
 * `facetCounts` can answer "if I also picked X, how many rows survive?"
 * without re-deriving that logic per filter type.
 *
 * Four filter kinds cover the common cases:
 *   equals     - field === value
 *   oneOf      - field is one of a set of values (chip multi-select)
 *   range      - numeric field within [min, max], either end optional
 *   dateRange  - date-ish field within [from, to], either end optional
 */

export function makeEqualsFilter(field, value) {
  return { type: 'equals', field, value }
}

export function makeOneOfFilter(field, values) {
  return { type: 'oneOf', field, values: new Set(values) }
}

export function makeRangeFilter(field, { min = null, max = null } = {}) {
  return { type: 'range', field, min, max }
}

export function makeDateRangeFilter(field, { from = null, to = null } = {}) {
  return { type: 'dateRange', field, from, to }
}

function matchesFilter(item, filter) {
  const value = item[filter.field]

  switch (filter.type) {
    case 'equals':
      return value === filter.value

    case 'oneOf':
      // An empty set means "nothing picked yet" -> don't restrict.
      return filter.values.size === 0 || filter.values.has(value)

    case 'range': {
      const n = Number(value)
      if (Number.isNaN(n)) return false
      if (filter.min != null && n < filter.min) return false
      if (filter.max != null && n > filter.max) return false
      return true
    }

    case 'dateRange': {
      const t = new Date(value).getTime()
      if (Number.isNaN(t)) return false
      if (filter.from != null && t < new Date(filter.from).getTime()) return false
      if (filter.to != null && t > new Date(filter.to).getTime()) return false
      return true
    }

    default:
      return true
  }
}

/** Apply every filter (AND). No filters -> the list unchanged. */
export function applyFilters(items, filters) {
  if (!filters || filters.length === 0) return items
  return items.filter((item) => filters.every((f) => matchesFilter(item, f)))
}

/**
 * For each distinct value of `field` seen in `items`, count how many items
 * would remain if that value were also selected — filters on `field` itself
 * are ignored so a chip can show its own hypothetical count ("Color: Red
 * (12)") rather than only the count for the currently-selected value.
 *
 * @returns {Map<any, number>}
 */
export function facetCounts(items, filters, field) {
  const otherFilters = (filters ?? []).filter((f) => f.field !== field)
  const base = applyFilters(items, otherFilters)

  const counts = new Map()
  for (const item of base) {
    const value = item[field]
    if (value == null) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}
