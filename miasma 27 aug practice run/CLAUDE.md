# Hackathon build — read before any work

This is a LofiStack Hackathon 2026 problem repo, built under a 4-hour clock ending
22:00. Scoring facts that override normal instincts:

1. **The 4 MVP bullets in README.md are the spec.** They are pass/fail, checked by a
   judge in under a minute each. Build them in order. Nothing else — no extra feature,
   no refactor, no polish — starts until all four pass on the LIVE deployed URL.
2. **The live URL is the product.** `npm run deploy -- --project-name <name>` after
   every completed bullet. What is live at 22:00 gets screenshotted and judged; local
   work counts for nothing. Verify claims against the deployed URL, not localhost.
3. **After the team calls the code freeze (~21:15), no commits.** Every commit after
   the freeze costs real marks (early-submission bonus). If asked to fix something
   post-freeze, flag the cost first.
4. **UI/UX marks come from states, not decoration:** empty state, loading state, error
   state, usable at phone width, labelled controls, bad input → message not crash.
   Tailwind defaults done consistently are enough; decoration scores zero.
5. **Technical marks come from a clean data model and separation of concerns.** Name
   things after the domain. Keep state in one place (`src/lib/`). Deployed properly
   beats clever.
6. **Every new dependency or asset goes into LICENSES.md immediately.** MIT / Apache-2.0
   / BSD / ISC only. Never GPL, LGPL, AGPL, MPL, SSPL, or non-commercial assets.
7. **Never commit secrets.** `.env` is gitignored; only `VITE_`-prefixed public values
   (Supabase anon key) belong there. No service_role keys anywhere, ever.
8. **`src/recipes/` holds pre-solved capabilities** (csv-import, search-filter, charts,
   auth, upload, map, realtime, llm, bd-formats, export). Copy the needed one into
   `src/lib/` and edit freely; delete unused recipes before the freeze.
9. Seed demo data on first load. A judge must reach the core loop with zero setup —
   no signup wall, or demo credentials printed on the landing page.
10. When a task is done, state what was verified on the live URL. Do not report a
    subagent's claim as fact without checking.

## Four devices, one repo — sync rules

Four team members each run their own Claude Code session on their own machine.
Sessions share nothing except this repo — **if it matters to more than one
device, it goes in a committed file, not in chat.**

- **Start of every session:** `git pull --rebase` first, then read `SPEC.md`
  and `BOARD.md`.
- **`BOARD.md` is the shared canvas.** It shows what every device is doing.
  Update your unit's row on every status change (`todo` → `building` →
  `pushed` → `done-live`), commit (`board: U2 building`), push. Before
  starting anything, pull and read it — that is how you know what the other
  three Claudes are doing.
- **Unit ownership:** `SPEC.md` assigns each unit an owner. Build only your
  unit; never touch another owner's files, even for a quick fix — report the
  problem instead.
- **Shared files** (`src/App.jsx`, the state module, `src/app.css`,
  `index.html`, `package.json`) belong to the integrator (shinzuu). Need a
  change there? Output the exact change as a request; do not make it.
- **Branch per unit.** Code lives on your unit's branch: `u1-map`, `u2-updates`,
  `u3-inventory`, `u4-shortage`, `u5-admin` (`git checkout -b u<N>-<slug>` off
  latest main). Push the branch when your unit's done-when passes — commit
  prefixed with the unit (`U2: …`). The integrator merges into main and
  deploys. Never push code straight to main; never `--force`.
- **Exception — BOARD.md and its Notes are committed on `main` directly**
  (tiny own-row edits, no conflicts): the shared canvas must never fork.
  `git checkout main && git pull --rebase` before a board edit, push, then
  back to your branch.
- **Deploys are the integrator's job** — one device runs `npm run deploy`, after
  every merged unit. Everyone verifies on the live URL it produces.
- **Mid-build discoveries** that affect others (API quirk, deploy trap, licence
  issue) get one line in `NOTES.md`, committed and pushed — chat evaporates,
  files sync.
