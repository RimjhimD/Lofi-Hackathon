# Official Scorecard — Relief Lens (Problem 7, Hard) — miasma-drill-27aug @ 48d4f96

## 1. Score table

| Category | Score / Max | Band | One-line reason |
|---|---|---|---|
| Functionality | 12 / 25 | Weak (top of band) | Bullets 3 and 4 pass with real depth; bullet 1 half-credit (top-3 needs hidden behind a login in the cold-load state the bullet's own text anchors to); bullet 2's headline "without a page reload" requirement reproducibly broken with a root-caused console error. |
| Demo & Documentation | 12 / 20 (video at midpoint 3/8; honest range 11–13) | Mixed | LICENSES.md perfect (4/4, every sampled claim verified); README loses 2.5 for stating "No page reloads anywhere" as fact when live evidence disproves it; video unviewable and rubric-capped at ≤4/8 because the acceptance script's no-reload moment cannot be confirmed live; submission checklist left unticked at the freeze. |
| Problem difficulty | 3.75 / 15 | Auto (mechanical) | Hard tier (7.5) × 2/4 bullets literally working = 3.75; bullets 1 and 2 fail the literal spec reading the rubric mandates. |
| Technical execution | 12 / 15 | Strong | Excellent schema, unusually thorough RLS, clean module separation, 66 passing tests — but the realtime defect was known and shipped with an inconsistently-applied try/catch band-aid, the failing layer has zero test coverage, and a raw SUPABASE_DB_PASSWORD is committed beyond the documented drill exception. |
| UI / UX | 11 / 15 | Strong (top of band) | Real loading/error/empty/locked states everywhere and sensible mobile collapse; capped by silent stale data across four widgets after a green "Update filed" success message, plus a mobile table hiding columns with no scroll affordance. |
| Early Submission / Speed | 0 / 10 | Zero | Last commit at 17:59:17 — 43 seconds before the hard stop, 19 minutes past the team's own 17:40 freeze target; zero complete blocks under the rubric arithmetic, and the 3/4-verified gate was in genuine doubt at freeze time regardless. |

**Total: 50.75 / 100** (range 49.75–51.75 depending on where the unviewed video actually lands in its 2–4 band).

## 2. The five most expensive marks lost, ranked

**1. The Supabase realtime bug (bullet 2) — roughly 15–17 marks across five categories.** Full bullet-2 loss plus the Weak-band cap in Functionality, 1.875 in Problem difficulty, the README's −2.5 and the video's ≤4 cap in Demo & Docs, ~1.5 of Technical execution's deduction, ~3 in UI/UX. This is one bug billed five times. The exact fix is the one the team's own MapView.jsx comment names: give each subscriber a unique channel name in api.js's `subscribeChanges` (or attach every `postgres_changes` listener before calling `.subscribe()`) and delete the `safeSubscribe` band-aid. Failing that, a dumb 5-second poll behind the same interface satisfies the bullet's literal wording. The team diagnosed this at 17:32 and shipped the wrong fix; the right one was ~30 minutes of work they spent on docs commits instead.

**2. Speed bonus forfeited — 10 marks.** The fix was purely behavioral: stop committing at the 17:40 freeze written in the repo's own CLAUDE.md (worth 1.25 under the block math); freezing at 17:10, when feature work had effectively ended, banks 2.5. The full 10 was structurally out of reach in a 2-hour window, but 1.25–2.5 was on the table and they banked zero by trickling docs and badge commits to within 43 seconds of the wall.

**3. Bullet 1's auth-gated popup — ~5 marks.** Half-credit in Functionality (~3.1 plus its share of the two-defects band cap) and a full literal FAIL worth 1.875 in Problem difficulty. Exact fix: a public read-only aggregated view (shelter name, headcount, capacity, top-3 needed items only) rendered in the logged-out marker popup. That preserves the RLS privacy split for everything else while meeting the bullet verbatim — the spec has no auth carve-out and explicitly anchors to "a judge opening the URL cold."

**4. The unverifiable video — ~5 marks at the compiled midpoint (3/8; judge's range −4 to −6).** Exact fix: record the 60-second acceptance script against the frozen build and commit the file or link in the repo so a judge can actually view it. Note the ceiling: even a viewable, polished video caps at 4/8 because the >4 tier requires the no-reload claim to confirm live — so the complete fix is item 1 first, then record.

**5. The README's false claim — 2.5 marks.** Exact fix: mark bullet 2 as partial in the MVP table with the known bug noted, and delete "No page reloads anywhere; every screen is driven by one realtime subscription." The document was otherwise the strongest prose artifact in the submission; the marks were lost specifically to asserting a disproven claim as fact on the single most judge-checkable line.

Next in line: the committed raw Postgres password and the silent duplicate-CSV double-count (both inside Technical execution's −3), and the unticked SUBMISSION.md checklist (−0.5).

## 3. The perfect build

The ideal two-hour submission ships the same schema, RLS, and pure modules — that part was right — and makes three different calls. First, realtime: one channel per subscriber (or a 5-second poll behind the same `subscribeChanges` interface) chosen at minute 20, plus a 10-line smoke test that submits an update and asserts the marker recolours without reload — the acceptance script's exact moment, automated, so the 17:32 "FIXED" note could never contradict production. Second, a public read model: a `needs_public` view exposing name, headcount, capacity, and top-3 needs, so the cold-load popup meets bullet 1 verbatim while writes stay behind RLS. Third, process artifacts: `npm test` wired into package.json; an idempotency key on consignment imports; .env carrying only the anon key, DB password never committed; BOARD.md rows flipped to done-live only after live-URL verification of the literal bullet text; code freeze at 17:30 with a tagged commit, ticked SUBMISSION.md checklist, and the 60-second video recorded 17:30–17:45 following SPEC.md's own script; README claims mirroring verified behavior only. That build scores roughly 22–24 Functionality, 7.5 Difficulty, 16–17 Demo/Docs, 13–14 Tech, 12–13 UX, 1.25–2.5 Speed — mid-70s to low 80s.

## 4. Placement

Against typical hackathon competition this lands mid-table, and the reason is structural, not bad luck. The engineering hygiene is top-decile for a 2-hour build — deployed and seeded, zero dead ends, 66 passing tests, a genuinely verified license audit, RLS design most teams never attempt — but judges score outcomes, and 50.75/100 with the demo's central advertised mechanic broken is a middling outcome. A merely competent team that ships 4/4 bullets on a Medium problem with an honest README beats this on Functionality and roughly matches it on Difficulty credit; any team that gets realtime working on this same Hard problem beats it outright. The failure pattern is the classic strong-engineer hackathon loss: deep infrastructure underneath, a broken headline feature on top, documentation that oversells the exact thing a judge checks first, and zero clock discipline at the end. Judges open the URL cold, click a marker, submit an update, watch nothing move, and discount everything else the repo contains. Until the core loop survives a cold open and the team actually stops committing when green, this build places in the middle of the pack; the components for a podium finish are demonstrably present and were donated to two known, diagnosed, unfixed problems.

---

## Addendum — the demo video, judged from its transcript

The Loom (89 seconds) was submitted separately and became available after the
judges filed. Judged from its transcript against the acceptance script:

- **Length**: 89s — satisfies the "no less than 60 seconds" reading of the live
  rules page with margin. Fine.
- **Coverage**: all four bullets plus the admin panel are walked in the right
  order, with the role story (public -> volunteer -> commissioner -> admin) told
  clearly. This is the structure the acceptance script prescribed. Good.
- **One overclaim**: at 1:29 the narration says admin can "**add** users" — the
  shipped panel approves and re-roles *existing* accounts only. A judge who
  tries to add a user from the panel and fails holds the video's claim against
  the submission. Same class of error as the README's no-reload line.
- **The cap stands**: the video cannot rescue bullet 2 — the >4/8 rubric tier
  requires the no-reload moment to be confirmable on the live URL, and it is
  not. Transcript quality puts the video at **3/8, the assumed midpoint** — so
  the compiled total **50.75/100 stands unchanged**.

*Judged against `48d4f96` (frozen 17:59:17) and the live bundle deployed from
it. Next documents: the retrospective and the 10/10 improvement plan.*
