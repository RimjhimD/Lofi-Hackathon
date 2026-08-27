# search-filter

Client-side search and filtering over a plain array — fast enough that a judge
typing in the box feels it land instantly, no backend round trip involved.

- `search.js` — dependency-free fuzzy/substring search. Case- and
  accent-insensitive, multi-word (any order, any field), ranked so a
  prefix/exact hit beats a hit buried mid-word, and it returns the matched
  character ranges so the UI can highlight without raw HTML injection.
- `filters.js` — composable `equals` / `oneOf` / `range` / `dateRange`
  filters (AND together), plus a facet counter that answers "how many
  results would this chip leave?" for live counts on filter buttons.
- `SearchFilter.jsx` — a self-contained demo: debounced search input,
  category chips with live facet counts, a price range, a result count, and
  an empty state that says *why* there are no results and offers to clear
  everything. Ships with 8 rows of inline sample data so it demos the moment
  you drop it in.

## Copy it in

```bash
cp -r src/recipes/search-filter src/lib/search-filter
```

Then in whatever page renders your list:

```jsx
import SearchFilter from './search-filter/SearchFilter.jsx'
import { db } from './db.js'

export default function ProductsScreen({ products }) {
  return <SearchFilter items={products} searchFields={['name', 'description']} chipField="category" />
}

// const { data: products } = await db.list('products')
```

Or use `search.js` / `filters.js` directly if you're not using the chip UI —
they don't know about React or each other's filter shape:

```js
import { search, highlightSegments } from './search-filter/search.js'
import { applyFilters, makeRangeFilter } from './search-filter/filters.js'

const results = search(rows, query, ['title', 'notes'])
// results: [{ item, score, matches: { title: [{start,end}, ...] } }, ...]

const filtered = applyFilters(rows, [makeRangeFilter('price', { min: 0, max: 5000 })])
```

## Filter semantics, pinned

Three choices in `filters.js` are the kind that go subtly wrong on a refactor
if they're not written down. `filters.test.mjs` pins all three.

- **`range` / `dateRange` bounds are inclusive on both ends** — `min`/`max`
  (and `from`/`to`) behave like SQL `BETWEEN`: an item exactly at the
  boundary is kept, not excluded.
- **`oneOf` with an empty values array matches everything**, i.e. "nothing
  picked yet" is treated as "don't restrict" rather than "match nothing".
  This is the one most likely to surprise someone reading the code cold —
  if your chip UI wants "no selection = no results" instead, check
  `values.size === 0` yourself before adding the filter to the array.
- **An item missing the filtered field entirely is excluded, never throws**
  — `undefined`/`null` fails `equals`, `range`, and `dateRange` (they
  `Number()`/`Date()`-coerce to `NaN`, which is always excluded), and fails
  `oneOf` unless `undefined` was explicitly included in the values list.

`facetCounts(items, filters, field)` excludes only the filter(s) on `field`
itself and keeps every other active filter applied — this is a deliberate
convention (counts answer "if I also picked this value, given everything
else I've already picked"), not the only reasonable one. An equally
defensible alternative is counting against the *unfiltered* full list. If
your UI needs that instead, call `facetCounts(items, [], field)`.

## The 3 gotchas

1. **`fields` in `search()` must match your actual property names, and only
   string-ish fields belong in there.** Searching a `price` number field
   works (it gets `String()`-coerced) but never scores usefully — put
   numeric filtering in `filters.js`'s `range` filter instead, not in search.

2. **The result shape is `{ item, score, matches }`, not the row itself.**
   `results.map((r) => ...)` — forgetting `.item` is the single most common
   copy-paste bug when swapping this in for a plain `items.map(...)`. Empty
   query returns the same shape too (`matches: {}`, `score: 0`), so the
   component never needs a separate branch for "no query yet".

3. **Highlight ranges are computed on the *unfolded* source string, not the
   query.** `highlightSegments(item.name, result.matches.name)` — pass the
   original field value, never the lowercased/folded one, or the slice
   indices will point at the wrong characters. `result.matches` is keyed by
   field name and only has keys for fields that actually matched — reading
   `result.matches.description` when only `name` matched is `undefined`,
   which `highlightSegments` treats as "no highlights" (safe default, not a
   crash) but means empty-looking highlighting is a silent bug, not an error.
