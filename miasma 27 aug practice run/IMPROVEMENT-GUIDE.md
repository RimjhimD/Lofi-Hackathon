# What to change before 30 August

Written from the 27 August drill scorecard (50.75/100, `SCORECARD.md`) and the
team's own playbook. The drill did its job: it found the failure pattern while
it was still cheap.

The headline is not "we suck". The judge's own words are that the engineering
hygiene was *top-decile for a two-hour build* — deployed and seeded, zero dead
ends, 66 passing tests, a verified licence audit, row-level security most teams
never attempt. The score was middling anyway, and the reason is worth
memorising: **judges score outcomes, and the outcome had a broken headline
feature, a README that oversold it, and no clock discipline.**

Everything below follows from that one sentence.

---

## 1. One broken mechanic costs five categories, not one

The realtime bug — one shared Supabase channel name, so the second subscriber
threw and the map never recoloured — cost roughly **15–17 marks** on its own:
the whole of bullet 2, a band cap on Functionality, 1.875 of Difficulty, 2.5
off the README, the video's hard ceiling, part of Technical execution, and
about 3 of UI/UX. One bug, billed six times.

Nothing else on the board has that blast radius. So:

**Rule: the demo's central mechanic gets fixed before anything else, and it
gets an automated check.** Not a comment, not a `try/catch`, not a note in
BOARD.md — a test that performs the acceptance-script action and asserts the
visible result. Ten lines is enough: submit an update, assert the marker
recolours without a reload. If that test is red, nothing else ships.

The deeper mistake was subtler and worth naming: the bug was diagnosed
correctly at 17:32, and then the *wrong fix* shipped. `safeSubscribe` stopped
the crash without restoring the behaviour the bullet required — it converted a
loud failure into a silent one. **A workaround that hides a symptom is worth
zero marks; assume it is worth negative, because it also makes the failure
harder to see.**

## 2. Read every bullet like a lawyer, then satisfy it verbatim

Bullet 1 said the popup shows the three most-needed supplies to *"a judge
opening the URL cold"*. The build put needs behind a login — defensible
product design, and it still scored half credit plus a literal FAIL on
difficulty, roughly **5 marks**, because the bullet has no auth carve-out.

**Rule: at 18:22 each bullet is copied verbatim into the README, and each is
turned into one sentence that starts "a judge who is not logged in can…". If
the sentence needs a caveat, the bullet is not met.**

Where a design instinct fights a bullet, satisfy the bullet with the narrowest
possible carve-out — here, a read-only public view exposing only name,
headcount, capacity and top-3 needs, leaving every write and everything else
behind RLS. That is minutes of work and it keeps both the marks and the
privacy story.

## 3. Freeze means freeze — 10 marks were sitting on the table

Last commit landed **43 seconds** before the hard stop, 19 minutes past the
team's own written freeze. Speed scored **0/10**.

The full 10 was never reachable in a two-hour window, but 1.25–2.5 was, and it
required no code at all — only stopping. What burned the clock was doc and
badge commits after feature work had effectively ended.

**Rule: the freeze time goes in a visible countdown, and one person owns
calling it.** After freeze: no commits, at all, including README fixes and
typos. Write them down and let them go. On the real night the block arithmetic
is worth 1.25 marks per 30 minutes, so a 21:15 freeze against a 22:00 stop is
worth ~6 marks over freezing at 21:59 — bigger than most features anyone is
tempted to add at 21:30.

Corollary: **do the paperwork before the freeze, not after.** README, LICENCES
and the submission checklist should be complete by the time the last feature
merges, so the freeze costs nothing.

## 4. Never claim in prose what the live URL cannot prove

The README said *"No page reloads anywhere; every screen is driven by one
realtime subscription."* Live evidence disproved it. That sentence alone cost
**2.5 marks**, and it did the damage on the single most judge-checkable line in
the document. The video repeated the pattern at 1:29 by saying admin can "add"
users when the panel only approves and re-roles existing ones.

**Rule: every claim in the README, the video script and the submission form is
either (a) demonstrated on the live URL in the last ten minutes, or (b)
deleted.** Honest partial-credit language costs nothing — "bullet 2 works on
first load; live refresh is a known issue" would have cost far less than the
false claim did.

An unticked `SUBMISSION.md` checklist cost another 0.5. That is free money.

## 5. "Done" means verified on the live URL, by someone who did not build it

The board carried rows marked done before the deployed bundle actually
contained the work — twice. Local success is not evidence: the drill's own map
bug only appeared against the real database, because localStorage answered fast
enough to hide the race.

**Rule: `done-live` requires the builder's *pair* to open the deployed URL,
perform the bullet's literal action, and say the words out loud.** The pairing
matters — the person who wrote it knows where not to click.

Add one more habit: **hard-reload twice.** Both of the drill's worst defects —
the empty map and the sign-in white screen — were intermittent, and a single
happy load hid them.

## 6. Secrets

A raw `SUPABASE_DB_PASSWORD` was committed, beyond the documented drill
exception. `scripts/preflight.sh` exists precisely to catch this and was not run
before that push.

**Rule: `bash scripts/preflight.sh` runs before every push. No exceptions.** On
the night the repo becomes the property of the organisers and is archived
permanently — a leaked credential cannot be un-leaked, only rotated.

---

## The night, minute by minute — what changes

| Clock | Change from the drill |
|---|---|
| 18:00–18:22 | Unchanged: read all twelve silently, score, pick two on *can we get 4/4*, not on tier. |
| 18:22 | Copy all eight bullets verbatim into the two READMEs. Write each one's "a judge who is not logged in can…" sentence. Anything that needs a caveat gets redesigned now, not at 21:00. |
| 18:25 | Both repos deployed, both URLs open on a phone. Same as the drill — this part worked. |
| **18:40** | **New: the acceptance-script smoke test is written before the feature it tests.** One test per bullet, asserting the visible outcome. |
| 18:40–20:30 | Build in bullet order. A bullet is not done until its smoke test is green *and* its pair confirmed it on the deployed URL. |
| **20:30** | **New: gate check.** 3/4 on both problems, verified live. If a headline mechanic is broken here, everything else stops until it is fixed — it is worth more than any remaining feature. |
| 20:30–21:15 | Fourth bullets and states. **All documentation finished in this window**, including README, LICENCES, submission checklist. |
| **21:15** | **FREEZE. Tag the commit. No commits after this, for any reason.** One person calls it aloud. |
| 21:15–21:40 | Record both videos against the frozen build, following the acceptance script. Every sentence must be visible on screen as it is spoken. |
| 21:40–22:00 | Phone smoke test on mobile data, both URLs, hard-reload twice each. Submit. Do not commit. |

## Before the night — this week

- Wire `npm test` in `package.json` so a bullet's check is one command.
- Write the acceptance-script smoke-test helper once, now, so it is a template
  on the night rather than an invention.
- Everyone runs `preflight.sh` once so it is muscle memory.
- Confirm every teammate is on **Node 22** — the drill lost time to Node 18
  refusing Vite 8 and wrangler.
- Agree who calls the freeze, and who verifies whose unit.

## For Rimjhim specifically

The map, login and shell all landed and UI/UX scored 11/15 — the loading,
error, empty and locked states were explicitly credited, and so was the mobile
collapse. Two habits to carry forward, both already demonstrated during the
drill:

- Reading the deployed bundle rather than trusting the board is what caught
  that `main` had been merged but never redeployed. Keep doing exactly that.
- Both map defects were found by opening a browser and counting tiles and
  markers, not by assuming the build output meant it worked. That instinct is
  the one that pays on the night.

The thing to change: when a fix has to happen in someone else's file, escalate
loudly and immediately rather than shipping a defensive wrapper in your own.
The `safeSubscribe` guard kept the page alive and cost the team the bullet.
