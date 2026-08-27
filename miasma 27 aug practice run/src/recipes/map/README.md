# map

Maps for location problems — delivery, "near me", incident reporting,
flood/outage mapping. Dhaka-relevant defaults throughout: the empty-state
centre is Dhaka, not (0,0) in the Atlantic.

## Files

| File | What |
|---|---|
| `leaflet.js` | Lazy-loads Leaflet (the map engine) + its CSS from a CDN at runtime. Not an npm dependency — see "The npm alternative" below. Caches the load so calling it twice never double-loads, and turns a dead CDN into a clear `{ error }` instead of a blank grey box. |
| `geo.js` | Pure functions, no DOM: `distanceKm` (haversine), `withinRadius`, `boundingBox`, `defaultView` (a sensible centre/zoom, defaulting to Dhaka with no data). |
| `MapView.jsx` | Renders markers from plain data, fits bounds to them, opens a popup on marker tap, and an optional `pickMode` that turns the map itself into a location input. Loading/empty/error states included. |
| `LocationPicker.jsx` | "Use my location" via the Geolocation API, with a `MapView` in `pickMode` as the fallback when GPS isn't available or the user says no. This is the component that actually handles the failure paths. Exposes an imperative `locate()` via `ref` (React's equivalent of the Svelte version's exported `locate` binding), though the button inside the component already calls it directly. |
| `geo.test.mjs` | `node --test` coverage of every edge case in `geo.js`, including a real Dhaka→Chittagong distance assertion. |

## Copy it in

```bash
cp -r src/recipes/map src/lib/map
```

```jsx
import MapView from './lib/map/MapView.jsx'
import LocationPicker from './lib/map/LocationPicker.jsx'
import { db } from './lib/db.js'

// const { data: incidents } = await db.list('incidents')
// incidents: [{ id, lat, lng, label, description }, ...]

export default function IncidentsScreen({ incidents }) {
  return (
    <>
      {/* Show existing points */}
      <MapView points={incidents} />

      {/* Let someone report a new one */}
      <LocationPicker onLocate={({ lat, lng }) => db.insert('incidents', { lat, lng, label: 'New report' })} />
    </>
  )
}
```

`MapView` and `LocationPicker` don't know about `db.js` — they take/return
plain `{ lat, lng }` data. Wire the database call yourself at the call site,
same as every other recipe in this kit.

### The npm alternative

If you'd rather install Leaflet for real instead of loading it from a CDN
(offline dev, stricter CSP, no third-party network dependency at all):

```bash
npm install leaflet
```

Then in `leaflet.js`, replace the CDN loader with a static import and drop
the rest of the file:

```js
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export async function loadLeaflet() {
  return { data: L, error: null }
}
```

`MapView.jsx` and `LocationPicker.jsx` both only ever call
`loadLeaflet()` — nothing else in either file needs to change. This is a
one-file swap either direction.

**Do not add `react-leaflet`.** It is not needed here (this recipe talks to
the Leaflet API directly, the same way the Svelte version does) and its
license terms are excluded by this kit's dependency policy — see the root
`LICENSES.md`.

## OpenStreetMap tile usage policy

The tile layer in `MapView.jsx` points at
`tile.openstreetmap.org`, OSM's own free tile server. It's free to use for a
hackathon demo, but their [tile usage
policy](https://operations.osmfoundation.org/policies/tiles/) requires
**visible attribution** — that's the "© OpenStreetMap contributors" control
in the map's bottom-right corner (`L.tileLayer(...).addTo(map)` adds it
automatically). **Don't hide, remove, or CSS-collapse that control** to
"clean up" the UI; it's the one thing standing between "free tiles" and
"policy violation." If this app is going to get real, sustained traffic
past the hackathon (not the judge's five minutes), switch to a paid tile
provider (Mapbox, Stadia Maps, MapTiler) or self-host tiles — OSM's server
is a shared community resource, not a production CDN.

## The 3 gotchas most likely to bite under time pressure

1. **`MapView` needs an explicit height, or it renders 0px tall and looks
   broken.** Leaflet measures its container's actual pixel size on init; a
   `<div>` with no height (the default for a block element with no content)
   gives it 0×0 to work with, and you get a grey box or nothing at all — not
   an error, because from Leaflet's point of view nothing went wrong. The
   `height` prop defaults to `60vh` for exactly this reason. If you nest
   `MapView` inside a flex/grid container, make sure that container isn't
   collapsing it (same class of bug as the charts recipe's "container must
   actually have a width" gotcha).

2. **Geolocation is HTTPS-only, and `localhost` is the *only* exception.**
   `LocationPicker` demos perfectly on `npm run dev` (localhost is
   specially exempted as "secure" by every browser) and then the location
   button silently does nothing useful on a `wrangler pages dev` preview or
   any deploy still serving plain `http://`. Cloudflare Pages serves HTTPS
   by default, so a real deploy is fine — this bites people testing a
   non-localhost preview URL over http, or an old Cloudflare Tunnel /
   ngrok link that dropped to http. `LocationPicker` detects this
   (`window.isSecureContext`) and shows the map-pick fallback with a message
   instead of a dead button, but the *cause* is worth knowing about before
   you're debugging it live.

3. **A dismissed permission prompt and a denied one look identical to your
   code.** If someone closes the "Allow location?" prompt without clicking
   either button (backgrounds the tab, taps outside it, whatever), most
   browsers fire the exact same `PERMISSION_DENIED` (code `1`) callback as
   an explicit "Block." There is no separate "the user hasn't decided yet"
   state to special-case — `LocationPicker` treats both as one outcome
   (show the fallback, offer the map pick) because that's the only outcome
   the API actually gives you. Don't build a UI that promises to
   distinguish "denied" from "dismissed" — you can't, reliably, cross-browser.

## Verifying this recipe

```bash
node --test src/recipes/map/geo.test.mjs
```

21 assertions covering `distanceKm` (including a real Dhaka→Chittagong
figure, ~210–220km straight-line — the ~264km number you'll see quoted
elsewhere is road distance, not this), `withinRadius`, `boundingBox`, and
`defaultView`'s empty/single-point/identical-points/spread cases.

`leaflet.js`, `MapView.jsx`, and `LocationPicker.jsx` need a real
browser (Leaflet touches the DOM directly) — sanity-check those by dropping
`MapView` into a page and confirming: it loads with your wifi on, it shows a
clear error with wifi off (airplane mode, then reload), and a second
`MapView` on the same page doesn't trigger a second Leaflet script tag
(check the Network tab — one request to `unpkg.com/leaflet@...`, not two).
