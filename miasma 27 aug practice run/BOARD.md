# Board — who is doing what, right now

**This file is the shared canvas between the four Claude sessions.** Chat and
memory do not sync across devices; this file does. Update your row when your
status changes, commit (`board: U2 building`), push. Pull before reading —
a stale board is worse than no board.

| Unit | Bullet | Owner | Status | Last update (time + note) |
|---|---|---|---|---|
| U0 | foundation | shinzuu | done-live | 16:58 — v2: Supabase DB live, RLS verified E2E, api/auth layer green |
| U1 | 1 | Rimjhim | pushed | 17:41 — map/login/shell on `Rii` (a7b88c9). NOT done-live: deployed map is intermittently empty until that merge lands |
| U2 | 2 | Dip | merged-live | 17:35 — form+feed merged & deployed; realtime probes visible cross-device |
| U3 | 3 | shinzuu | done-live | 17:18 — CSV import verified on live URL: 3 imported/3 rejected with line errors, real Supabase writes |
| U4 | 4 | Robiul | merged-live | 17:35 — shortage board merged & deployed, severity math correct on live data; PR #1 closed as already-integrated |
| U5 | admin panel | shinzuu | done-live | 17:24 — Admin tab (admin-only), approve/revoke + roles verified on live URL against real DB |

Status values: `todo` → `building` → `pushed` → **`done-live`** (verified on
the deployed URL — the only status that counts).

## Blockers / requests to the integrator

One line each, newest on top. The integrator clears these and deletes the line.

- **U1 → shinzuu: merge `Rii` (a7b88c9) — the live map is intermittently empty.** Deployed `MapView.jsx` still has `}, [retryToken])`; the Leaflet init effect fires while the loading skeleton is up, finds a null container ref and never retries, so markers render only when the data race happens to go the other way. Verified on relief-lens.pages.dev: 9 markers on one load, 0 on the next. Fix on `Rii` adds `status` to that effect's deps (verified: 18 tiles, 9 markers, popup opens).

## Notes — things everyone should know

Gotchas found mid-build: API quirks, deploy traps, licence flags. One line each.

- FIXED integration crash: multiple panels calling api.subscribeChanges blew up Supabase realtime ("cannot add postgres_changes after subscribe") — api.js now multiplexes one shared channel. Pull before continuing.
- .env.demo (tracked) = shared drill backend config; `cp .env.demo .env` and restart vite.

- **U4 pushed (`u4-shortage`)** — needs one integrator line in App.jsx: `import ShortageBoard from './components/ShortageBoard.jsx'`, then swap the `tab === 'shortage'` placeholder for `<ShortageBoard />`.
- **`submitUpdate` REPLACES a shelter's whole `needs` array** (store.js, and `apply_field_update_trigger` server-side). U2's form must pre-populate the shelter's existing needs — otherwise a single-item update wipes the rest and visibly re-ranks the shortage board mid-demo (measured: tarp gap 150 → 30, 3rd place → 5th).
- **The live DB seed and the localStorage seed are DIFFERENT data** (SPEC says "the same seed" — it is not). Verified against the live backend just now as all three demo roles: live shortage board is water 9700/5500/**gap 4200**, rice 1640/1200/440, ors 700/500/200, tarp 160/0/160, babyfood 90/0/90, medkit 35/0/35 — **6 critical items topped by Drinking water**. The localStorage seed instead gives 5 items topped by Blankets (300). Shelter names differ too (live has "Gohira A.J.Y.M.S. High School Shelter").
- **Acceptance script step 4 quotes numbers that exist in neither seed:** it says rice 1,200 / 700 / GAP 500; live rice is 1,640 / 1,200 / 440. Narrate the video off whatever the live app shows on the night.
- **RLS verified from a node client (not just the UI):** signed out gets 9 shelters but 0 needs and 0 consignments, so the shortage board is correctly empty rather than showing zero-need items. volunteer/commissioner/admin all get viewShortage; importConsignments is commissioner+admin only.
- **`api.js` / `auth.js` cannot be imported in plain node** — `supa.js:25` reads `import.meta.env` unguarded. Keep `node --test` files on pure modules; `esbuild --define:import.meta.env={}` works if you need a node smoke test.
- The 412/320 acceptance-script shelter is now `raozan-pourashava-high-school` — v2 renamed the seed away from the Sylhet ids.
- SPEC.md now has the shared Supabase testing config (URL + publishable key) + demo creds — copy into your local .env to hit the SAME live backend as everyone.
- Interim login form lives in the App header (integrator shim) — U1's LoginPanel replaces it.
- preflight.sh blocks JWTs: use the sb_publishable_ key (already in SPEC), never paste the eyJ… anon JWT into a tracked file.
- **Branch per unit now:** code on `u<N>-<slug>` branches (u1-map, u2-updates, u3-inventory, u4-shortage, u5-admin), integrator merges to main + deploys. BOARD.md stays on main.
- Live URL: **https://relief-lens.pages.dev** — deploys go there, verify your unit on it.
- Import `shortageReport` and everything else from `src/lib/store.js` only (it re-exports shortage.js) — keep that path stable.
- `needs` arrays arrive sorted desc by qty — MapView popup can just `slice(0,3)`.
- Seed shelter `gowainghat-gc-high-school` is 412/320 on purpose — matches acceptance-script popup numbers.
