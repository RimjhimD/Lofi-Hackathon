# About this folder

This is a **mirror**, not the working copy.

| | |
|---|---|
| Project | Relief Lens — flood-relief coordination dashboard for a Deputy Commissioner's office (SPEC v2) |
| What it is | Team Miasma's practice drill for the LofiStack Hackathon 2026, run 27 August 2026 |
| Working repo | `github.com/Shinzuu/miasma-drill-27aug` (private) — **build and push there, not here** |
| Taken from | branch `u1-map`, commit `07efeb7` — "U1: fix map init race; guard shared realtime channel" |
| Mirrored on | 27 August 2026 |

Team Miasma is four people, each running their own session against the shared repo above. That repo
is the source of truth for the drill: work done in this folder would be invisible to the rest of the
team and would never merge. Treat this copy as an archive of what was built on the day.

## What was left out, and why

Only files tracked by git were copied — no `node_modules/`, no `dist/`, no local `.env`.

Two things in the team repo are deliberately absent here, because **this repository is public and
that one is private**:

- **`.env.demo`** — carries the Supabase project URL and anon key for the team's shared drill
  backend. Its own header calls those values "public-by-design", which is a fair call inside a
  private repo. Publishing them next to the full `schema.sql` is a different exposure: the anon key
  is meant to reach browsers, but pairing it publicly with the complete schema shortens the distance
  between a curious reader and whatever RLS happens to permit.
- **`supabase/.temp/`** — Supabase CLI scratch state. `pooler-url` in there is a live Postgres
  connection string including credentials. It must not reach a public repository under any
  circumstances.

To run this locally, copy `.env.example` and fill it from the team repo.

## The unit split

Work was divided into five units, one per teammate — see `BOARD.md` for the assignment table and
`SPEC.md` for the product definition.

| Unit | Scope |
|---|---|
| U1 · map | Public, no-login map of Raozan upazila shelters — location, capacity, headcount, occupancy colour |
| U2 · updates | Field updates feed |
| U3 · inventory | Aid inventory |
| U4 · shortage | Shortage board |
| U5 · admin | Account management — approve users, set roles |

Rimjhim built **U1 (map)** on branch `u1-map`.

Integrator-owned files — `src/App.jsx`, `src/lib/store.js`, `src/app.css`, `package.json` — are
present because they are part of the build, but unit owners did not edit them directly. Changes to
those went to the integrator as requests.

## Running it

```bash
cp .env.example .env      # fill in the Supabase values from the team repo
npm install
npm run dev
```

Needs Node 20+ (22 for wrangler). `DEPLOY.md` has the deploy path, `PERMISSIONS.md` the role and RLS
model, `PROBLEM.html` the drill problem statement as issued.
