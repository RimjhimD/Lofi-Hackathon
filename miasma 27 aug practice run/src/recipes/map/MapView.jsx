/**
 * Marker map: plain data in, fit-to-bounds, popup on tap, and an optional
 * "pick a location" mode. Leaflet loads from the CDN via leaflet.js in
 * this folder - nothing renders until that resolves, and a failed load
 * becomes a real error state with a retry button, never a blank grey box.
 *
 * PICK MODE
 * Set `pickMode` to let the map itself be the location input: tapping
 * anywhere drops (or moves, if dragged) a single "chosen" marker and calls
 * `onPick` with `{lat, lng}`. `points` still renders alongside it for
 * context ("pick where the leak is — here's where past reports were").
 *
 * States shipped: loading (skeleton), error (message + retry, not a stack
 * trace), empty ("no locations yet", map still shown at the Dhaka
 * default so it never opens on a blank box), and normal (markers +
 * fit-to-bounds). Zoom control sits bottom-right so it's reachable with a
 * thumb while holding the phone one-handed; the OpenStreetMap attribution
 * control is left in place — see this recipe's README for why that one
 * isn't optional.
 */
import { useEffect, useRef, useState } from 'react'
import { loadLeaflet } from './leaflet.js'
import { defaultView, boundingBox } from './geo.js'

export default function MapView({ points = [], pickMode = false, onPick = null, initialPick = null, height = '60vh' }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const lRef = useRef(null)
  const markersLayerRef = useRef(null)
  const pickMarkerRef = useRef(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  const [retryToken, setRetryToken] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [picked, setPicked] = useState(initialPick)

  const validPoints = points.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
  // Effects below key their re-run off a JSON snapshot of validPoints so a
  // new-but-equal array from the parent doesn't tear the map down needlessly.
  const validPointsKey = JSON.stringify(validPoints)

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  }

  function renderMarkers() {
    const L = lRef.current
    const markersLayer = markersLayerRef.current
    if (!L || !markersLayer) return
    markersLayer.clearLayers()
    for (const p of validPoints) {
      const marker = L.marker([p.lat, p.lng])
      if (p.label || p.description) {
        marker.bindPopup(
          `<strong>${escapeHtml(p.label ?? '')}</strong>${p.description ? `<br>${escapeHtml(p.description)}` : ''}`
        )
      }
      marker.addTo(markersLayer)
    }
  }

  function fitToPoints() {
    const map = mapRef.current
    if (!map) return
    if (validPoints.length > 1) {
      const box = boundingBox(validPoints)
      map.fitBounds(
        [
          [box.south, box.west],
          [box.north, box.east],
        ],
        { padding: [32, 32], maxZoom: 16 }
      )
    } else {
      const { center, zoom } = defaultView(validPoints)
      map.setView([center.lat, center.lng], zoom)
    }
  }

  function setPickedMarker(lat, lng) {
    const L = lRef.current
    const map = mapRef.current
    if (!L || !map) return
    setPicked({ lat, lng })
    if (pickMarkerRef.current) {
      pickMarkerRef.current.setLatLng([lat, lng])
    } else {
      const marker = L.marker([lat, lng], { draggable: true }).addTo(map)
      marker.on('dragend', () => {
        const pos = marker.getLatLng()
        setPicked({ lat: pos.lat, lng: pos.lng })
        onPickRef.current?.({ lat: pos.lat, lng: pos.lng })
      })
      pickMarkerRef.current = marker
    }
  }

  function retry() {
    setRetryToken((t) => t + 1)
  }

  // Mount/teardown the Leaflet map itself - reruns on retry only.
  useEffect(() => {
    let cancelled = false

    async function init() {
      setLoading(true)
      setError(null)

      const { data, error: err } = await loadLeaflet()
      if (cancelled) return
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      const L = data
      lRef.current = L

      const map = L.map(containerRef.current, { tap: true, zoomControl: false })
      mapRef.current = map
      L.control.zoom({ position: 'bottomright' }).addTo(map)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        // Required by OSM's tile usage policy — keep this visible. See README.
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map)

      const markersLayer = L.layerGroup().addTo(map)
      markersLayerRef.current = markersLayer
      renderMarkers()
      fitToPoints()

      if (pickMode) {
        if (initialPick) setPickedMarker(initialPick.lat, initialPick.lng)
        map.on('click', (e) => {
          setPickedMarker(e.latlng.lat, e.latlng.lng)
          onPickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng })
        })
      }

      setLoading(false)
    }

    init()

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      markersLayerRef.current = null
      pickMarkerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken])

  // Keep markers (and, absent a manual pick, the fitted view) in sync if
  // `points` changes after the map is already up — e.g. a new incident
  // arrives from db.js while the map is open.
  useEffect(() => {
    if (mapRef.current && markersLayerRef.current) {
      renderMarkers()
      if (!pickMode) fitToPoints()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validPointsKey])

  return (
    <div className="relative w-full overflow-hidden rounded-card" style={{ height }}>
      {loading ? (
        <div className="flex h-full items-center justify-center bg-ink-100 dark:bg-ink-700/30" aria-busy="true">
          <p className="text-sm text-ink-500">Loading map…</p>
        </div>
      ) : error ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 border border-dashed border-ink-300/70 px-6 text-center">
          <p className="text-sm text-danger">{error}</p>
          <button type="button" className="text-sm font-medium text-accent underline" onClick={retry}>
            Try again
          </button>
        </div>
      ) : null}

      {/* Kept in the DOM (just hidden) rather than conditionally rendered, so Leaflet
          always has a real container to measure and attach to once it loads. */}
      <div ref={containerRef} className={`h-full w-full ${loading || error ? 'hidden' : ''}`}></div>

      {!loading && !error && validPoints.length === 0 && !pickMode && (
        <div className="pointer-events-none absolute inset-x-3 top-3 rounded-xl bg-white/95 px-4 py-2 text-center text-sm text-ink-500 shadow-lg dark:bg-ink-900/90">
          No locations yet — showing Dhaka.
        </div>
      )}

      {!loading && !error && pickMode && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-xl bg-white/95 px-4 py-3 text-sm shadow-lg dark:bg-ink-900/90">
          {picked ? (
            <>
              <p className="font-medium">Picked location</p>
              <p className="text-ink-500">
                {picked.lat.toFixed(5)}, {picked.lng.toFixed(5)}
              </p>
            </>
          ) : (
            <p className="text-ink-500">Tap anywhere on the map to choose a location.</p>
          )}
        </div>
      )}
    </div>
  )
}
