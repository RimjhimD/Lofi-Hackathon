# Miasma — 27 August practice run

Team Miasma's two-hour dry run for the LofiStack Hackathon 2026, kept as a
record of the work rather than as a running project.

## What the drill was

Twelve problems were replaced by one sealed brief, opened on the clock:
**Relief Lens** (Problem 7, Hard tier) — a flood-relief coordination dashboard
for a Deputy Commissioner's office in **Raozan upazila, Chattogram**. Four
pass/fail MVP bullets, two hours, hard stop, deployed to a public URL.

## What is in here

The full application source as it stood at the end of the drill:
`src/` (React 19 + Vite 8 + Tailwind 4), `schema.sql` and `supabase/migrations/`
(Postgres with row-level security), plus the working documents the team ran on —
`SPEC.md`, `PERMISSIONS.md`, `BOARD.md`, `CLAUDE.md`, and the sealed
`PROBLEM.html`.

## Rimjhim's unit — U1

The map, the login, and the shell:

- `src/components/MapView.jsx` — Leaflet map of Raozan, markers colour-coded by
  occupancy, popup with name, union, headcount/capacity, and the three
  most-needed supplies for signed-in staff. The view fits the bounds of whatever
  the API returns, so no geography is hardcoded.
- `src/components/LoginPanel.jsx` — email/password sign-in plus one-tap demo
  accounts, and the `useSession()` hook the rest of the UI reads. Signs in
  against Postgres when keys are present and against an in-memory session when
  they are not, so role behaviour is testable either way.
- `src/components/Dashboard.jsx` — the signed-in district summary.
- `src/App.jsx` — sidebar navigation, top bar, and role-gated views. Locked
  destinations stay visible so the access model is legible.
- `public/raozan-upazila.geojson` — the district outline, simplified from 5,205
  points to 321 (geoBoundaries ADM3, CC BY 3.0 IGO, source BBS / OCHA).

Two defects worth remembering, both found by testing rather than assuming: the
Leaflet init effect ran while the loading skeleton was up and never retried
against the real container, and `subscribeChanges()` shared one fixed-name
Supabase channel across every caller, which threw on the second subscriber and
took the whole React tree down on sign-in.

## How it scored

Judged against the official rubric by the team's own judging harness:
**50.75 / 100** — full breakdown in `SCORECARD.md`, and what to change before
30 August in `IMPROVEMENT-GUIDE.md`.

The short version: the engineering underneath was rated top-decile for a
two-hour build, and the score was middling anyway, because the demo's headline
mechanic was broken, the README asserted it worked, and the team committed to
within 43 seconds of the hard stop and scored 0/10 on speed.

## Running it

```bash
npm install          # Node 20+ required (Vite 8); wrangler needs Node 22
npm run dev
```

It runs on a bundled localStorage seed with no configuration. To point it at a
Supabase project, copy the two `VITE_` values into `.env` — the real ones are
not in this repository.

Live during the drill at `relief-lens.pages.dev`.
