/**
 * Lazy CDN loader for Leaflet — the actual map-rendering engine behind
 * MapView.svelte / LocationPicker.svelte in this folder.
 *
 * WHY THIS EXISTS
 * Leaflet is deliberately NOT in package.json (see this recipe's README for
 * the npm alternative, if you'd rather install it for real). This module
 * injects Leaflet's script + stylesheet straight into the page at runtime,
 * the first time a map actually needs to render, and caches the in-flight
 * promise so:
 *
 *   - two MapView instances mounting at once (or one remounting under HMR)
 *     never race to insert two <script> tags fighting over `window.L`
 *   - a second call after the first one already succeeded is instant — it
 *     just returns the same `window.L`, no new network request
 *
 * A CDN can be unreachable — a judge's mobile data, a locked-down venue
 * wifi, one bad DNS answer. That must never render as a grey empty box with
 * no explanation. Every path through loadLeaflet() resolves (never throws)
 * with the same `{ data, error }` shape as db.js, so the calling component
 * can render a real error state instead.
 */

const LEAFLET_VERSION = '1.9.4'
const JS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`
const CSS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`
const LOAD_TIMEOUT_MS = 12000

export const LEAFLET_CDN = { js: JS_URL, css: CSS_URL, version: LEAFLET_VERSION }

// Module-level, not component-level: this must survive across every
// MapView/LocationPicker instance in the page, which is what makes "don't
// load twice" actually hold.
let loadPromise = null

function injectCss() {
  if (document.querySelector('link[data-leaflet-css]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = CSS_URL
  link.setAttribute('data-leaflet-css', 'true')
  document.head.appendChild(link)
}

function injectScript() {
  return new Promise((resolve, reject) => {
    // Something (an earlier call in this same session) already inserted the
    // tag — attach to it instead of adding a second one.
    const existing = document.querySelector('script[data-leaflet-js]')
    if (existing) {
      if (window.L) {
        resolve(window.L)
        return
      }
      existing.addEventListener('load', () => (window.L ? resolve(window.L) : reject(new Error('load-failed'))))
      existing.addEventListener('error', () => reject(new Error('load-failed')))
      return
    }

    const script = document.createElement('script')
    script.src = JS_URL
    script.async = true
    script.setAttribute('data-leaflet-js', 'true')

    const timer = setTimeout(() => {
      script.remove()
      reject(new Error('timeout'))
    }, LOAD_TIMEOUT_MS)

    script.onload = () => {
      clearTimeout(timer)
      window.L ? resolve(window.L) : reject(new Error('load-failed'))
    }
    script.onerror = () => {
      clearTimeout(timer)
      script.remove()
      reject(new Error('load-failed'))
    }

    document.head.appendChild(script)
  })
}

/**
 * Load Leaflet from the CDN, once, no matter how many times or how many
 * components call this.
 *
 * @returns {Promise<{ data: object|null, error: {message:string}|null }>}
 *   `data` is the global `L` namespace on success.
 */
export async function loadLeaflet() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { data: null, error: { message: 'The map needs a browser to render — this ran outside one.' } }
  }
  if (window.L) return { data: window.L, error: null }

  if (!loadPromise) {
    injectCss()
    loadPromise = injectScript().catch((e) => {
      // A failed load must not be cached forever — the judge's wifi can come
      // back, or a retry button can fire this again. Only a *successful*
      // load is worth remembering module-wide.
      loadPromise = null
      throw e
    })
  }

  try {
    const L = await loadPromise
    return { data: L, error: null }
  } catch (e) {
    const message =
      e?.message === 'timeout'
        ? `The map library took too long to load (over ${Math.round(LOAD_TIMEOUT_MS / 1000)}s). Check your connection and try again.`
        : 'Could not load the map library from the CDN. Check your connection and try again.'
    return { data: null, error: { message } }
  }
}
