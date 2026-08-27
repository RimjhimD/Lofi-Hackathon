# SPEC v2 — Relief Lens (roles + Supabase)

Read `CLAUDE.md` first, then this file, then `PERMISSIONS.md`, then your row in
`BOARD.md`. Build only your unit. Update `BOARD.md` on every status change.

**v2 supersedes v1.** What changed: real database (Supabase Postgres + RLS),
three login roles, public-vs-private data split, geography moved to **Raozan
upazila, Chattogram**, and a new admin unit (U5). The unit shapes U1–U4 are the
same jobs as v1 — only their data source and auth gates changed.

## The product

A flood-relief coordination dashboard for a Deputy Commissioner's office.

- **Public (no login):** interactive map of Raozan's shelters — location,
  capacity, headcount, occupancy colour. Nothing else.
- **Logged-in staff (approved):** shelter needs, field updates, aid inventory,
  and the shortage board. Volunteers and commissioners "give and take info";
  commissioners additionally import aid consignments.
- **Admin:** everything above plus account management (approve users, set roles).

Roles: `admin` · `commissioner` · `volunteer`. The full capability matrix and
which RLS policy enforces each cell: `PERMISSIONS.md`. Client-side `can()`
checks are UX only — Postgres RLS is the real wall.

## Data — Supabase is the source of truth

Schema, RLS policies, triggers, and Raozan seed data: `schema.sql` (applied to
the live project). Tables: `profiles`, `supply_items` (fixed 8), `shelters`,
`shelter_needs`, `updates`, `consignments`. Field updates INSERT into `updates`;
a trigger applies headcount/needs to the shelter — nobody writes `shelters`
directly except admin.

**All client data access goes through `src/lib/api.js`. No component imports
supabase directly.** The api layer:

```js
fetchShelters(filter?)   // public; optional {district, upazila} — default all
fetchNeeds() fetchUpdates() fetchConsignments()   // authenticated + approved
submitUpdate({shelterId, headcount, needs, note})
addConsignments(rows)
subscribeChanges(cb)     // one realtime channel; cb per change; returns unsubscribe
```

Auth (`src/lib/auth.js`): `getSession()`, `onAuthChange(cb)`,
`signInWithPassword(email, password)`, `signOut()`, `fetchMyProfile()`,
`can(profile, action)` with actions `viewMap · viewShortage · submitUpdate ·
importConsignments · manageAccounts`.

No `.env` on your machine = api.js silently falls back to the localStorage
store with the same seed — UI work never blocks on keys. To hit the shared
live backend instead, use the Testing config below.

## Testing config — everyone uses the SAME backend (drill-only, rotated later)

Copy into your `.env` (file stays gitignored; these two values are
public-by-design — they ship in the browser bundle anyway):

```
VITE_SUPABASE_URL=<shared drill project URL — see the team channel>
VITE_SUPABASE_ANON_KEY=<shared drill publishable key — see the team channel>
```

Demo logins (all approved) — password **relief-demo-2026**:
`admin@relieflens.demo` · `commissioner@relieflens.demo` ·
`volunteer@relieflens.demo`. Real security is Postgres RLS; these creds are
throwaway and get rotated after the drill. The DB password and service key
are NOT in the repo and never will be.

## Units

Build order inside a unit = its list order. One unit, one person, own files
only. `App.jsx`, `store.js`, `app.css`, `index.html`, `package.json` =
integrator (shinzuu) only — request changes, don't make them.

| Unit | Owner | Files | Done when (verified on https://relief-lens.pages.dev) |
|---|---|---|---|
| **U0** | shinzuu | schema, `src/lib/{api,auth,supa}.js`, shell | ✅ done — DB live, RLS verified, api layer green |
| **U1** | Rimjhim | `src/components/MapView.jsx`, `LoginPanel.jsx` | Map shows all 9 Raozan shelters, occupancy colours, popup with name/union/headcount/capacity (+ top-3 needs ONLY when logged in + approved); login/logout works with the demo users; logged-out users see map only |
| **U2** | Dip | `src/components/UpdateForm.jsx`, `UpdatesFeed.jsx` | Logged in as volunteer: submit update → marker/popup change with no reload (store refresh via subscribeChanges), entry in feed as "just now"; logged out or unapproved: form hidden |
| **U3** | shinzuu | `src/components/ImportPanel.jsx`, `public/sample-aid.csv` | Logged in as commissioner: upload sample CSV → rows land in consignments table; malformed row → visible per-row error, app alive; search filters; sample downloadable; volunteer sees table but no upload |
| **U4** | Robiul | `src/lib/shortage.js` (+`node --test` tests), `src/components/ShortageBoard.jsx` | Logged-in board groups critical items (gap>0) worst-first, shelters ranked by severity `needQty × occupancyRatio` with numbers shown; changes when an update or import lands. Implement `shortage.js` per its JSDoc contract FIRST, tests green, then UI |
| **U5** | shinzuu | `src/components/AdminPanel.jsx`, `src/lib/admin-api.js` | ✅ done — admin lists/approves/sets roles, self-demotion blocked, non-admin never sees the tab |

U1's map: **derive center/zoom by fitting bounds of fetched shelters** — no
hardcoded coordinates (extensibility rule below).

## Extensibility — multi-upazila (design rule, NOT built today)

Later: a country → zila → upazila drill-down where each upazila shows its own
dashboard. The codebase must not fight that:

1. Never hardcode "Raozan"/"Chattogram" in components — all display text comes
   from row data (`union_name`, `upazila`, `district`).
2. Map fits bounds of whatever shelters the api returns.
3. `fetchShelters(filter?)` already takes `{district, upazila}` — the future
   selector is one component + this filter.
4. Adding a region = INSERT shelter rows with new `upazila` values. Zero schema
   or code change.

## Out of scope (nobody builds these)

Multi-upazila selector, routing/multi-page, password reset, signup UI (accounts
are made by admin/demo script), dark mode, PDF export, Bengali toggle,
consignment ETA logic, editing shelters in UI. Stretch only after every claimed
unit is done-live.

## Acceptance script (= the 60-second video, write nothing new at record time)

1. Open live URL logged out → Raozan map, 9 markers, occupancy colours; popup
   shows capacity but no needs. No private tabs visible.
2. Log in `volunteer@relieflens.demo` → needs appear in popup; submit update
   (headcount + Rice 400 kg) → marker recolours live, feed shows "just now".
3. Log in `commissioner@relieflens.demo` → Inventory: download sample CSV,
   upload it → table fills; upload bad row → per-row error, app alive.
4. Shortage tab → critical items ranked with gap numbers → the update from
   step 2 is reflected. Log in `admin@relieflens.demo` → approve a pending
   user, change a role. Done.
