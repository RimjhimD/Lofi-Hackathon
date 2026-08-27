/**
 * "Where am I" the honest way: try navigator.geolocation, and when that
 * fails for any of the four real reasons it fails in production, fall back
 * to letting the person pick their own spot on a map instead of dead-ending
 * on an error.
 *
 * THIS IS THE WHOLE POINT OF THE RECIPE — every one of these is a real,
 * common failure, not a hypothetical:
 *   - permission denied        the person taps "Block"
 *   - permission dismissed     the person closes/ignores the browser
 *                              prompt without answering it — most browsers
 *                              report this as PERMISSION_DENIED too, same
 *                              handling, same message
 *   - timeout                  GPS cold-start indoors/underground; a fix
 *                              can take longer than getCurrentPosition's
 *                              default wait
 *   - insecure origin          geolocation is HTTPS-only. `localhost` (and
 *                              `127.0.0.1`) is specially exempted by every
 *                              browser as "secure" for local dev — a
 *                              plain http:// deploy is NOT exempted and
 *                              will refuse before the permission prompt
 *                              ever appears
 */
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import MapView from './MapView.jsx'

function isSecureContext() {
  if (typeof window === 'undefined') return false
  if ('isSecureContext' in window) return window.isSecureContext
  // Fallback for the rare browser without the flag: mirror the same rule
  // browsers apply — https, or localhost/127.0.0.1 for local dev.
  return window.location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(window.location.hostname)
}

/**
 * `onLocate` fires on GPS success AND on a manual map pick.
 * A ref exposes `.locate()` for a parent that wants to trigger it manually,
 * mirroring the Svelte version's exported `locate` binding.
 */
const LocationPicker = forwardRef(function LocationPicker({ onLocate = null, autoStart = true }, ref) {
  const [status, setStatus] = useState('idle') // idle | locating | granted | fallback
  const [errorMessage, setErrorMessage] = useState(null)
  const [coords, setCoords] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [showManualPicker, setShowManualPicker] = useState(false)

  function offerFallback(message) {
    setErrorMessage(message)
    setStatus('fallback')
    setShowManualPicker(true)
  }

  function locate() {
    setErrorMessage(null)

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      offerFallback('This browser has no location support. Pick your location on the map instead.')
      return
    }

    if (!isSecureContext()) {
      offerFallback(
        'Location needs a secure connection (https://) — this page is loaded over plain http. Pick your location on the map instead.'
      )
      return
    }

    setStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setCoords(next)
        setAccuracy(pos.coords.accuracy)
        setStatus('granted')
        setErrorMessage(null)
        onLocate?.({ ...next, accuracy: pos.coords.accuracy })
      },
      (err) => {
        // GeolocationPositionError codes: 1 PERMISSION_DENIED (also what
        // most browsers report when the prompt is dismissed unanswered),
        // 2 POSITION_UNAVAILABLE, 3 TIMEOUT.
        if (err.code === 1) {
          offerFallback('Location permission was denied or dismissed. Pick your location on the map instead.')
        } else if (err.code === 3) {
          offerFallback('Location took too long to find (weak signal or indoors is common). Pick your location on the map instead.')
        } else {
          offerFallback('Could not determine your location. Pick your location on the map instead.')
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  useImperativeHandle(ref, () => ({ locate }))

  function handleManualPick({ lat, lng }) {
    setCoords({ lat, lng })
    setAccuracy(null)
    setStatus('granted')
    onLocate?.({ lat, lng, accuracy: null })
  }

  useEffect(() => {
    if (autoStart) locate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="mx-auto w-full max-w-xl px-4 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-xl bg-accent px-5 py-3 font-medium text-white disabled:opacity-40"
          onClick={locate}
          disabled={status === 'locating'}
        >
          {status === 'locating' ? 'Finding you…' : 'Use my location'}
        </button>
        <button
          type="button"
          className="rounded-xl border border-ink-300/60 px-5 py-3 text-sm font-medium hover:bg-ink-100 dark:hover:bg-ink-700/30"
          onClick={() => setShowManualPicker(!showManualPicker)}
        >
          {showManualPicker ? 'Hide map' : 'Pick on map'}
        </button>
      </div>

      {errorMessage && (
        // One banner, dismissible, non-blocking. Never an alert().
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          <span className="flex-1">{errorMessage}</span>
          <button type="button" className="underline" onClick={() => setErrorMessage(null)}>
            dismiss
          </button>
        </p>
      )}

      {coords && (
        <p className="mt-3 text-sm text-ink-500">
          {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
          {accuracy ? <>&nbsp;· accurate to ~{Math.round(accuracy)}m</> : null}
        </p>
      )}

      {showManualPicker && (
        <div className="mt-3">
          <MapView
            pickMode
            points={coords ? [{ id: 'me', lat: coords.lat, lng: coords.lng, label: 'You' }] : []}
            initialPick={coords}
            onPick={handleManualPick}
            height="50vh"
          />
        </div>
      )}
    </section>
  )
})

export default LocationPicker
