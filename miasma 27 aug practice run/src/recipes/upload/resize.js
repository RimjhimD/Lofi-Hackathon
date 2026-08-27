/**
 * Client-side image resize.
 *
 * WHY THIS EXISTS
 * A phone photo straight off the camera is 3-8 MB. Store a couple of those
 * as data URLs and localStorage's ~5 MB per-origin ceiling is gone before
 * the demo even has data in it. This shrinks the pixels *before* anything
 * touches storage — pair it with storage.js in this folder.
 *
 * Canvas API only. No image library, nothing to install.
 *
 * Given a File and a max dimension, returns a smaller Blob plus a data URL
 * for the thumbnail. Never throws — a bad file comes back as { data: null,
 * error }, same contract as src/lib/db.js. Read that file first if you have
 * not.
 */

const DEFAULT_MAX_DIM = 1600
const DEFAULT_QUALITY = 0.82

// --- pure helpers (no DOM — unit-testable with `node --test`) --------------

/** True if `file.type` looks like an image MIME type. Never throws. */
export function isImageFile(file) {
  return !!file && typeof file.type === 'string' && file.type.startsWith('image/')
}

/**
 * Longest-edge-fit maths, shared by the real resize and by resize.test.mjs.
 * Never upscales — a 400px source stays 400px even if maxDim is 1600.
 * Returns integer pixel sizes, minimum 1x1. Bad input (NaN, zero, negative)
 * returns all zeros rather than throwing.
 */
export function computeTargetSize(width, height, maxDim) {
  const finite = [width, height, maxDim].every((n) => Number.isFinite(n))
  if (!finite || width <= 0 || height <= 0 || maxDim <= 0) {
    return { width: 0, height: 0, scale: 0 }
  }
  const longest = Math.max(width, height)
  const scale = longest > maxDim ? maxDim / longest : 1 // 1 = never upscale
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

// --- DOM-dependent work (browser only — not covered by resize.test.mjs) ----

/**
 * Fallback decode path for engines without createImageBitmap's
 * `imageOrientation` option (old Safari). Does NOT reliably correct EXIF
 * rotation on its own — most current browsers paint a plain <img> already
 * upright, but drawImage from that element is not guaranteed to match. Good
 * enough as a last resort, not as the primary path.
 */
function loadImageElementFallback(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not decode this image.'))
    }
    img.src = objectUrl
  })
}

/**
 * Decode a File into something drawImage can use.
 *
 * `imageOrientation: 'from-image'` bakes EXIF rotation into the decoded
 * bitmap, so a photo taken with the phone held sideways comes out upright
 * without hand-parsing EXIF tags. Supported in current Chrome, Firefox and
 * Safari (15+).
 *
 * createImageBitmap decoding is asynchronous and off the main thread in
 * every engine that implements it — that is what keeps a 40-megapixel photo
 * from freezing the tab while it decodes.
 */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      try {
        return await createImageBitmap(file) // engine rejects the option object itself
      } catch {
        // fall through to the <img> fallback
      }
    }
  }
  return loadImageElementFallback(file)
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality })
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed.'))), type, quality)
  })
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Could not read the resized image.'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Downscale an image File to fit within `maxDim` on its longest edge.
 * Returns { data, error } — never throws.
 *
 * data: { blob, dataUrl, width, height, originalWidth, originalHeight, size, type }
 *
 * @param {File} file
 * @param {number} [maxDim] longest edge in pixels, default 1600
 * @param {{ quality?: number, mimeType?: string }} [opts] quality is 0-1 for
 *   JPEG/WebP; mimeType forces the output type instead of the PNG-stays-PNG
 *   default below.
 */
export async function resizeImage(file, maxDim = DEFAULT_MAX_DIM, { quality = DEFAULT_QUALITY, mimeType } = {}) {
  try {
    if (!isImageFile(file)) {
      return {
        data: null,
        error: { message: `Not an image file (got "${file?.type || 'unknown type'}"). Upload it as-is instead of resizing.` },
      }
    }

    const bitmap = await decode(file)
    const sourceWidth = bitmap.width ?? bitmap.naturalWidth
    const sourceHeight = bitmap.height ?? bitmap.naturalHeight
    const { width, height } = computeTargetSize(sourceWidth, sourceHeight, maxDim)
    if (width === 0 || height === 0) {
      return { data: null, error: { message: 'Could not read this image\'s dimensions.' } }
    }

    const canvas = makeCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return { data: null, error: { message: 'Canvas is not available in this environment.' } }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.() // ImageBitmap only — frees decoded pixel memory immediately

    // PNG stays PNG (keeps transparency); everything else becomes JPEG,
    // which is smaller and is what a phone photo already is.
    const outType = mimeType || (file.type === 'image/png' ? 'image/png' : 'image/jpeg')
    const blob = await canvasToBlob(canvas, outType, quality)
    const dataUrl = await blobToDataURL(blob)

    return {
      data: { blob, dataUrl, width, height, originalWidth: sourceWidth, originalHeight: sourceHeight, size: blob.size, type: outType },
      error: null,
    }
  } catch (e) {
    // Anything unexpected (corrupt file, decode failure, out-of-memory on a
    // huge image) lands here instead of throwing into the caller.
    return { data: null, error: { message: e?.message || 'Could not process this image.' } }
  }
}
