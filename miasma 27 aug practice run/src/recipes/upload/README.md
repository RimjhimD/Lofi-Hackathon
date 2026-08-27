# upload

Photos, documents, receipts, evidence — file upload that works with zero
backend, then upgrades to Supabase Storage the moment you paste in keys.
Same dual-backend pattern as `src/lib/db.js`.

## What's in here

| File | What it does |
|---|---|
| `resize.js` | Client-side image downscale via `<canvas>`. Given a `File` and a max dimension, returns a smaller `Blob` + a data URL for the thumbnail. Handles EXIF orientation, never upscales, never throws. |
| `storage.js` | Dual-backend file storage, same `{ data, error }` contract as `db.js`. No env vars → data URLs in localStorage with an explicit quota check. `VITE_SUPABASE_URL` set → Supabase Storage, returns a public URL. |
| `Upload.jsx` | Drag-and-drop + file picker + camera-capture input, thumbnail previews, per-file progress, per-file remove, running total size, a real empty state. |
| `resize.test.mjs` | `node:test` coverage for the pure logic — see "What isn't tested" below. |

Nothing here imports Supabase eagerly (`storage.js` lazy-loads
`@supabase/supabase-js` only when keys are present, same as `db.js`), and
nothing here imports from another recipe or from `src/lib`.

## How to copy it in

```bash
cp -r src/recipes/upload src/lib/
```

Then in your component:

```jsx
import Upload from './lib/upload/Upload.jsx'

export default function ReceiptsScreen() {
  return <Upload />
}
```

Open `Upload.jsx` and change `BUCKET` to whatever name fits your app
(`'receipts'`, `'evidence'`, `'avatars'`...). If you don't need
camera-capture, drag-and-drop, or the thumbnail grid, delete the markup you
don't need — a half-used recipe left in the tree is dead code (see
`../README.md`).

If you only need the resize step (e.g. you already have your own storage
call), copy `resize.js` alone and call `resizeImage(file, 1600)`.

## The 3 gotchas most likely to bite under time pressure

1. **Public URL comes back but the image is broken (403/400 in the `<img>`
   tag).** This happens when the Supabase bucket exists but isn't public, or
   the RLS policies below aren't in place. `storage.upload()` will report
   success — Supabase Storage accepts the write even when the bucket is
   private — and only the *read* fails, silently, later, when the browser
   tries to load the URL. Test by pasting the returned URL into a new
   private/incognito tab (not your logged-in Supabase dashboard tab) — that's
   the judge's-eye view. See the exact setup below.

2. **The 4.5 MB localStorage budget is per-bucket, not per-origin.** `storage.js`
   checks usage under its own `hack:storage:<bucket>` key before writing, but
   `db.js`'s tables live in `localStorage` too, under separate `hack:<table>`
   keys, and are not counted. Two buckets (say `'uploads'` and `'avatars'`)
   each get their own 4.5 MB budget even though the browser's real ceiling
   (~5 MB) is shared across all of them combined. For a single-bucket demo
   this is fine; if you use more than one bucket, drop `LOCAL_BUDGET_BYTES`
   for each (e.g. to ~2 MB) so they can't add up past the real limit. The
   `writeLocal` try/catch is still there as a backstop either way — a real
   `QuotaExceededError` from the browser is always caught, never thrown into
   the UI.

3. **Only images get resized — everything else goes up at full size.**
   `Upload.jsx` only calls `resizeImage()` when `isImageFile(file)` is
   true. A PDF receipt or a video dropped into the zone goes straight to
   `storage.upload()` unresized, so it's much more likely to trip the
   localStorage quota error, and on Supabase it just uploads slowly. The
   `MAX_RAW_BYTES` guard (20 MB, in `Upload.jsx`) exists specifically to
   reject those before the tab has to read them at all — raise or lower it
   to match what your demo actually needs uploaded.

## Supabase Storage setup (exact steps — public read)

Getting this wrong is what causes gotcha #1: the upload "succeeds" and the
URL looks right, but the image never loads for anyone, including the judge.

1. **Dashboard → Storage → New bucket.**
   - Name: whatever you set `BUCKET` to in `Upload.jsx` (e.g. `uploads`).
   - **Toggle "Public bucket" ON.** This is what makes `getPublicUrl()`
     actually work — without it every URL 400s no matter what else is
     configured.
2. **SQL Editor** — run this once per bucket name. Supabase enables Row Level
   Security on `storage.objects` by default, so without these policies the
   anon key can't upload (insert), remove, or clear, even into a public
   bucket:

   ```sql
   -- Replace 'uploads' with your bucket name. Permissive on purpose — this
   -- is a hackathon demo, not a product. Tighten before it's real.
   create policy "uploads public read"
     on storage.objects for select
     to public
     using ( bucket_id = 'uploads' );

   create policy "uploads public insert"
     on storage.objects for insert
     to public
     with check ( bucket_id = 'uploads' );

   create policy "uploads public delete"
     on storage.objects for delete
     to public
     using ( bucket_id = 'uploads' );
   ```

3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `.env` (same two
   vars `db.js` already uses — one Supabase project covers both). `backend`
   in `storage.js` flips to `'supabase'` automatically; no call site changes.
4. Verify: upload one file, copy the returned URL, open it in a fresh
   private-browsing tab. If it loads there, it loads for the judge.

## What isn't tested (needs a real browser)

`resize.test.mjs` covers everything that doesn't touch the DOM:
`isImageFile`, the `computeTargetSize` scaling maths (no-upscale, aspect
ratio, boundary, bad input), and `storage.js`'s quota arithmetic
(`estimateBytes`, `wouldExceedQuota`). It does **not** — and cannot,
under plain `node --test` — cover:

- `createImageBitmap` decoding and the `imageOrientation: 'from-image'` EXIF
  correction (needs a real image + a real engine).
- The `<img>` fallback path for engines without that option (old Safari) —
  manually verify a sideways phone photo still comes out upright, or accept
  that on very old Safari it may not.
- Actual `<canvas>` / `OffscreenCanvas` drawing and blob export.
- `FileReader`-based data-URL conversion in both `resize.js` and
  `storage.js`.
- The real `localStorage.setItem` quota exception path — the pre-check
  arithmetic is tested, but not the browser actually throwing
  `QuotaExceededError`.
- Drag-and-drop, the file picker, and the `capture="environment"` camera
  input in `Upload.jsx` — capture is phone-only; a desktop browser just
  opens the normal file picker for it, which is expected, not a bug.

Manual check before a demo: drag in a large phone photo (verify it shrinks
and isn't upscaled if already small), drop in a non-image file (verify it
uploads without being resized), fill localStorage close to the budget and
confirm the quota error shows instead of a crash, and remove a file both
before and after it finishes uploading.
