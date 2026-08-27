/**
 * Pure geo maths — haversine distance, "within N km" filtering, bounding
 * boxes, and a sensible default map view. No DOM, no Leaflet, nothing that
 * needs a browser — safe to `node --test` directly and safe to reuse
 * anywhere lat/lng arithmetic is needed, including outside this recipe.
 *
 * WHY THIS EXISTS
 * The maths here is short but the edge cases are exactly the ones that break
 * a map on stage: an empty list (no data yet — must not divide by zero), a
 * single point (must not zoom to street level as if it were a tight cluster,
 * and must not zoom to the whole planet either), and two points that are
 * literally identical (a zero-size bounding box, which breaks a naive
 * fitBounds). Every function below is written against those first.
 *
 * A point is `{ lat, lng }`. Anything else on the object (id, label, ...) is
 * ignored here and is the map layer's problem, not this file's.
 */

const EARTH_RADIUS_KM = 6371

// Dhaka, Bangladesh — the fallback centre when there is no data to fit to.
// This kit is built for Dhaka-relevant problems (delivery, incident
// reporting, "near me"); opening on the Atlantic Ocean (0,0) is the actual
// failure mode this default prevents.
export const DEFAULT_CENTER = { lat: 23.8103, lng: 90.4125 }
export const DEFAULT_ZOOM = 12 // city-scale — most Dhaka-relevant demos are neighbourhood-sized, not country-sized
export const SINGLE_POINT_ZOOM = 15 // one marker: zoom to street-ish scale, never the map's maximum zoom
const MAX_FIT_ZOOM = 16 // fitBounds-style zoom never goes tighter than this, even for a very tight cluster
const MIN_FIT_ZOOM = 3

function toRad(deg) {
  return (deg * Math.PI) / 180
}

function isPoint(p) {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
}

/** Filter out anything that isn't a usable `{lat, lng}` point. */
function validPoints(points) {
  return (Array.isArray(points) ? points : []).filter(isPoint)
}

/**
 * Great-circle distance between two points, in kilometres.
 * Returns NaN for missing/invalid input rather than throwing — callers that
 * feed it optional data (a row without coordinates yet) get a value they can
 * `Number.isFinite()`-check, not a crash.
 */
export function distanceKm(a, b) {
  if (!isPoint(a) || !isPoint(b)) return NaN

  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  // Clamp to [0, 1]: floating point can push h fractionally over 1 for
  // near-antipodal or identical points, and asin() of anything over 1 is NaN.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))))
}

/**
 * Points within `radiusKm` of `center`, inclusive. Points missing/invalid
 * lat/lng are dropped rather than throwing partway through the list.
 */
export function withinRadius(points, center, radiusKm) {
  if (!isPoint(center) || !Number.isFinite(radiusKm)) return []
  return validPoints(points).filter((p) => distanceKm(center, p) <= radiusKm)
}

/**
 * The smallest box containing every point, as `{ north, south, east, west }`
 * (lat max/min, lng max/min). `null` for an empty/all-invalid list — that's
 * the empty-state signal callers should check for, not a box with Infinity
 * in it.
 */
export function boundingBox(points) {
  const valid = validPoints(points)
  if (valid.length === 0) return null

  let north = -Infinity
  let south = Infinity
  let east = -Infinity
  let west = Infinity
  for (const p of valid) {
    north = Math.max(north, p.lat)
    south = Math.min(south, p.lat)
    east = Math.max(east, p.lng)
    west = Math.min(west, p.lng)
  }
  return { north, south, east, west }
}

/**
 * A sensible `{ center, zoom }` for a set of points — what a map should open
 * on before the user has zoomed or panned themselves.
 *
 *   - no valid points          -> Dhaka, DEFAULT_ZOOM (never (0,0), never a blank ocean)
 *   - one point, or every      -> centred on it, SINGLE_POINT_ZOOM (never the map's max
 *     point identical             zoom — a single marker at zoom 19 reads as "broken", not "found it")
 *   - a real spread of points  -> centred on the bounding-box midpoint, zoom picked to fit
 *     the spread with padding, clamped to [MIN_FIT_ZOOM, MAX_FIT_ZOOM]
 */
export function defaultView(points) {
  const valid = validPoints(points)
  if (valid.length === 0) return { center: { ...DEFAULT_CENTER }, zoom: DEFAULT_ZOOM }

  const box = boundingBox(valid)
  const center = { lat: (box.north + box.south) / 2, lng: (box.east + box.west) / 2 }

  // The diagonal of the bounding box, in km. Zero (or near-zero, from float
  // rounding) means either a single point or a set of points that are
  // effectively on top of each other — both get the same "zoomed to a spot,
  // not a region" treatment.
  const spanKm = distanceKm({ lat: box.south, lng: box.west }, { lat: box.north, lng: box.east })

  if (valid.length === 1 || !Number.isFinite(spanKm) || spanKm < 0.05) {
    return { center, zoom: SINGLE_POINT_ZOOM }
  }

  // Rough log2 zoom-to-fit: halving the span roughly doubles the zoom level
  // needed to fill the same viewport, which is the same relationship a tile
  // map's own zoom levels follow (each level doubles resolution).
  const zoom = Math.round(14 - Math.log2(spanKm + 0.1))
  return { center, zoom: Math.max(MIN_FIT_ZOOM, Math.min(MAX_FIT_ZOOM, zoom)) }
}
