/**
 * share() — Web Share API, falling back to copy-to-clipboard, falling back
 * further to a legacy copy trick for insecure origins.
 *
 * WHY THIS EXISTS
 * "Share this" only has one truly native implementation (navigator.share,
 * the phone's own share sheet — WhatsApp, SMS, whatever the judge actually
 * uses) and it's only available on HTTPS, and only on some browsers. Every
 * other environment needs a fallback, and the most common accidental
 * demo-night environment — `vite preview --host` on a local IP, not yet
 * deployed — is an insecure origin where `navigator.clipboard` doesn't
 * exist either. That third rung (a hidden-textarea `execCommand('copy')`)
 * is what stops "Share" from silently doing nothing on exactly the setup
 * most likely to be running the night of the hackathon.
 *
 * Reports which path actually ran (`method`) so the caller can show the
 * right confirmation — "Shared" reads wrong after a plain clipboard copy.
 *
 * Never throws. Returns { data, error }, same convention as src/lib/db.js.
 */

/** Hidden-textarea + execCommand('copy'). Works on insecure (http://) origins where the async Clipboard API is unavailable. */
function legacyCopy(text) {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false

  const textarea = document.createElement('textarea')
  textarea.value = text
  // Keep it present in the DOM (some browsers refuse to copy from a
  // display:none node) but out of the visible layout and off-screen.
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)

  const previousFocus = document.activeElement
  textarea.select()
  textarea.setSelectionRange(0, text.length) // iOS Safari needs this in addition to select()

  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }

  textarea.remove()
  if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus()
  return ok
}

/**
 * Share (or, failing that, copy) a title/text/url payload.
 *
 * @param {{ title?: string, text?: string, url?: string }} payload
 * @returns {Promise<{ data: { method: 'share' | 'clipboard' | 'legacy-copy' | 'cancelled', text: string } | null, error: { message: string } | null }>}
 */
export async function share({ title = '', text = '', url = '' } = {}) {
  try {
    const combined = [title, text, url].filter(Boolean).join('\n')
    if (!combined) {
      return { data: null, error: { message: 'Nothing to share.' } }
    }

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url })
        return { data: { method: 'share', text: combined }, error: null }
      } catch (e) {
        // The user closing the native share sheet is not a failure — it's
        // just not "shared", and shouldn't fall through to a clipboard
        // copy the user didn't ask for.
        if (e?.name === 'AbortError') {
          return { data: { method: 'cancelled', text: combined }, error: null }
        }
        // Any other failure (e.g. share() exists but the browser rejects
        // this particular payload) — fall through to the clipboard path.
      }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(combined)
        return { data: { method: 'clipboard', text: combined }, error: null }
      } catch {
        // Permission denied or an insecure origin where the API exists but
        // throws — fall through to the legacy path below.
      }
    }

    if (legacyCopy(combined)) {
      return { data: { method: 'legacy-copy', text: combined }, error: null }
    }

    return {
      data: null,
      error: { message: 'Could not share or copy automatically. Copy this link manually: ' + combined },
    }
  } catch (e) {
    return { data: null, error: { message: e?.message || 'Share failed.' } }
  }
}
