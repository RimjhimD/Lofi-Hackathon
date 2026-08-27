/**
 * Search box + filter chips over a plain in-memory list.
 *
 * THE NOUN HERE IS "products" — rename the fields and the sample data and
 * this becomes search over anything: clients, incidents, listings. The
 * three moving parts (debounced query, chip filters, facet counts) don't
 * change.
 *
 * Sample data ships inline so this demos the moment you drop it in — no
 * db.js wiring required. Swap the `items` prop for your real list (from
 * db.js, a fetch, wherever) and the rest keeps working unchanged.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { search, highlightSegments } from './search.js'
import { applyFilters, facetCounts, makeOneOfFilter, makeRangeFilter } from './filters.js'

const SAMPLE = [
  { id: '1', name: 'Café Table', category: 'Furniture', description: 'Small round bistro table', price: 4200 },
  { id: '2', name: 'Cast Iron Pan', category: 'Kitchen', description: 'Pre-seasoned skillet', price: 1800 },
  { id: '3', name: 'Category 5 Cable', category: 'Electronics', description: '10m network cable', price: 350 },
  { id: '4', name: 'Vacation Backpack', category: 'Travel', description: 'Carry-on sized, water resistant', price: 2600 },
  { id: '5', name: 'Naïve Bayes Notebook', category: 'Books', description: 'Intro to probabilistic ML', price: 900 },
  { id: '6', name: 'Résumé Paper', category: 'Office', description: 'Premium cotton stock, 100 sheets', price: 500 },
  { id: '7', name: 'Coffee Grinder', category: 'Kitchen', description: 'Burr grinder, 18 settings', price: 3100 },
  { id: '8', name: 'Desk Lamp', category: 'Office', description: 'Warm LED, dimmable', price: 1600 },
]

export default function SearchFilter({ items = SAMPLE, searchFields = ['name', 'description'], chipField = 'category' }) {
  // --- search: debounced ~150ms, cancelled and applied instantly on submit -
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const debounceTimer = useRef(null)

  function onInput(e) {
    const value = e.target.value
    setQuery(value)
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setDebouncedQuery(value), 150)
  }

  function onSubmit(e) {
    e.preventDefault()
    clearTimeout(debounceTimer.current)
    setDebouncedQuery(query)
  }

  function clearSearch() {
    clearTimeout(debounceTimer.current)
    setQuery('')
    setDebouncedQuery('')
  }

  useEffect(() => () => clearTimeout(debounceTimer.current), [])

  // --- filters: category chips (one-of) + a price range -------------------
  const [selectedCategories, setSelectedCategories] = useState([])
  const [minPrice, setMinPrice] = useState(null)
  const [maxPrice, setMaxPrice] = useState(null)

  function toggleCategory(cat) {
    setSelectedCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]))
  }

  function clearPrice() {
    setMinPrice(null)
    setMaxPrice(null)
  }

  function clearAllFilters() {
    setSelectedCategories([])
    clearPrice()
  }

  const allCategories = useMemo(
    () => [...new Set(items.map((item) => item[chipField]).filter((v) => v != null))].sort(),
    [items, chipField]
  )

  const activeFilters = useMemo(
    () =>
      [
        selectedCategories.length > 0 ? makeOneOfFilter(chipField, selectedCategories) : null,
        minPrice !== null || maxPrice !== null ? makeRangeFilter('price', { min: minPrice, max: maxPrice }) : null,
      ].filter(Boolean),
    [chipField, selectedCategories, minPrice, maxPrice]
  )

  const facets = useMemo(() => facetCounts(items, activeFilters, chipField), [items, activeFilters, chipField])

  const priceLabel = `Price: ${minPrice !== null ? `$${minPrice}` : 'any'}–${maxPrice !== null ? `$${maxPrice}` : 'any'}`

  const chips = [
    ...selectedCategories.map((cat) => ({ key: `cat:${cat}`, label: cat, remove: () => toggleCategory(cat) })),
    ...(minPrice !== null || maxPrice !== null ? [{ key: 'price', label: priceLabel, remove: clearPrice }] : []),
  ]

  // --- pipeline: filter, then search, then rank ----------------------------
  const filteredItems = useMemo(() => applyFilters(items, activeFilters), [items, activeFilters])
  const results = useMemo(
    () => search(filteredItems, debouncedQuery, searchFields),
    [filteredItems, debouncedQuery, searchFields]
  )

  const emptyReason = (() => {
    if (results.length > 0) return null
    const hasQuery = debouncedQuery.trim().length > 0
    const hasFilters = activeFilters.length > 0
    if (hasQuery && hasFilters) return `Nothing matches "${debouncedQuery}" with the active filters.`
    if (hasQuery) return `Nothing matches "${debouncedQuery}".`
    if (hasFilters) return 'No items match the active filters.'
    return 'Nothing here yet.'
  })()

  return (
    <section className="mx-auto w-full max-w-xl px-4 pb-24">
      <form className="flex gap-2" onSubmit={onSubmit}>
        <div className="relative min-w-0 flex-1">
          <input
            className="w-full rounded-xl border border-ink-300/60 bg-white/80 px-4 py-3 text-base
               placeholder:text-ink-500 focus:border-accent dark:bg-ink-900/40"
            type="search"
            value={query}
            onChange={onInput}
            placeholder="Search…"
            aria-label="Search"
            enterKeyHint="search"
          />
          {query && (
            <button
              type="button"
              className="absolute inset-y-0 right-3 text-ink-500 hover:text-danger"
              onClick={clearSearch}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </form>

      {/* Category chips double as toggle buttons; each shows its live facet count. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {allCategories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              selectedCategories.includes(cat) ? 'border-accent bg-accent-soft' : 'border-ink-300'
            }`}
            onClick={() => toggleCategory(cat)}
            aria-pressed={selectedCategories.includes(cat)}
          >
            {cat} <span className="text-ink-500">({facets.get(cat) ?? 0})</span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm">
        <label className="text-ink-500" htmlFor="min-price">
          Price
        </label>
        <input
          id="min-price"
          className="w-20 rounded-lg border border-ink-300/60 bg-white/80 px-2 py-1 dark:bg-ink-900/40"
          type="number"
          inputMode="numeric"
          placeholder="min"
          value={minPrice ?? ''}
          onChange={(e) => setMinPrice(e.target.value === '' ? null : Number(e.target.value))}
          aria-label="Minimum price"
        />
        <span className="text-ink-500">–</span>
        <input
          className="w-20 rounded-lg border border-ink-300/60 bg-white/80 px-2 py-1 dark:bg-ink-900/40"
          type="number"
          inputMode="numeric"
          placeholder="max"
          value={maxPrice ?? ''}
          onChange={(e) => setMaxPrice(e.target.value === '' ? null : Number(e.target.value))}
          aria-label="Maximum price"
        />
      </div>

      {/* Active-filter chips: one visible list, each removable on its own. */}
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <span key={chip.key} className="flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-sm text-ink-900">
              {chip.label}
              <button
                type="button"
                className="text-ink-500 hover:text-danger"
                onClick={chip.remove}
                aria-label={`Remove filter ${chip.label}`}
              >
                ✕
              </button>
            </span>
          ))}
          <button type="button" className="text-sm text-accent underline" onClick={clearAllFilters}>
            Clear all
          </button>
        </div>
      )}

      <p className="mt-4 text-sm text-ink-500">
        {results.length} of {items.length} results
      </p>

      {results.length === 0 ? (
        // Empty state does a job: it explains why and offers the next action.
        <div className="mt-4 rounded-card border border-dashed border-ink-300/70 px-6 py-10 text-center">
          <p className="text-ink-500">{emptyReason}</p>
          {(debouncedQuery || activeFilters.length > 0) && (
            <button
              className="mt-3 text-sm font-medium text-accent underline"
              onClick={() => {
                clearSearch()
                clearAllFilters()
              }}
            >
              Clear search and filters
            </button>
          )}
        </div>
      ) : (
        <ul className="mt-2 space-y-2">
          {results.map((result) => (
            <li key={result.item.id} className="rounded-card bg-white px-4 py-3 shadow-sm dark:bg-ink-900/40">
              <p className="font-medium">
                {highlightSegments(result.item.name, result.matches.name).map((seg, i) =>
                  seg.highlight ? (
                    <mark key={i} className="rounded bg-accent-soft text-ink-900">
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  )
                )}
              </p>
              {result.item.description && (
                <p className="text-sm text-ink-500">
                  {highlightSegments(result.item.description, result.matches.description).map((seg, i) =>
                    seg.highlight ? (
                      <mark key={i} className="rounded bg-accent-soft text-ink-900">
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    )
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
