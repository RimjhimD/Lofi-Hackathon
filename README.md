# Lofi-Hackathon

A single-page, unofficial reference for the **LofiStack Hackathon 2026 — 4-Hour Build Sprint**.

Everything the public event site publishes across five separate documents — the Rulebook, the Scoring
Rubric, the Code of Conduct, the Recording & Data Notice and the Guardian Consent Form — pulled into
one scrollable page you can read in a sitting, search with Ctrl-F, and check during the build.

**Live page:** `index.html` (open it locally, or serve it with GitHub Pages)
**Official site:** <https://hackathon.lofistack.com>

---

## The event in one paragraph

Sunday 30 August 2026, 18:00–22:00 Bangladesh Standard Time, entirely online and free. Twelve
problems drop at 18:00 sharp, each tagged Easy / Medium / Hard. Your team of 2–4 picks exactly two
and has four hours to get both live and working. BDT 50,000 in prizes across three teams, plus up to
three three-month internships awarded to individuals on proctor observation rather than on where
their team finished. All AI coding tools are allowed without restriction.

| | |
|---|---|
| Date | Sunday 30 August 2026 |
| Build window | 18:00 → 22:00 BST — hard start, hard stop |
| Team size | 2 to 4, scored identically regardless of size |
| Problems | 12 released, each team picks exactly 2 |
| Prizes | BDT 30,000 winner · BDT 10,000 to each of two runners-up |
| Internships | Up to 3, three months, individual selection |
| Cost | Free |
| Eligibility | Bangladesh-based, minimum age 16 (under 18 needs guardian consent) |
| Results | ~6 September |
| Run by | LofiStack and AskTechGuy |

---

## What's on the page

| Section | What it covers |
|---|---|
| At a glance | Key numbers, the four-step flow, full fact table |
| Dates | Every deadline from registration open to results, with a live countdown |
| Prizes | Cash split, payout mechanics, tax and ID requirements |
| Rules | The nine headline rules, allowed vs. not allowed, prayer/outage handling, violations table |
| Scoring | All 100 marks — every band descriptor, the early-submission table, the difficulty formula, tiebreaks, judging stages |
| Submission | The five required deliverables per problem, and the 22:00 archive |
| Ownership | Section 9 in full — what you assign, what you keep |
| Internships | The six observation signals and how offers are decided |
| Data | What's recorded, who sees it, retention periods |
| Conduct | The standard, what isn't tolerated, consequences ladder |
| Under 18 | Guardian consent requirements and form fields |
| FAQ | All 14 published questions |
| Registration | The five-step process |
| Contacts | Support, conduct reporting, Discord |

---

## Three things worth knowing before you build

**The speed bonus has a gate.** Early submission is worth up to 8.75 marks in practice (1.25 per
complete 30 minutes remaining, measured from your *last commit*, not from a form) — but it pays **0**
unless at least 3 of the 4 required MVP bullets are verified working on **each** of your two
problems. Shipping two fast skeletons scores nothing.

**Difficulty credit is scaled, not flat.** Credit = tier value × (bullets working ÷ total bullets).
Hard is 7.5 at full delivery, but Hard-that-doesn't-run is 0 — worth less than Easy that works.

**22:00 is the only moment that counts.** Repository write access is revoked, every live URL is
health-checked and screenshotted, and judging happens a week later against that archive. A free
instance already asleep at 21:55 is on you; one that sleeps on 3 September can't hurt you.

---

## Ownership notice

Registering assigns **all rights in submitted work** — source code, assets, designs and documentation
— to LofiStack, which may use, modify, publish or commercialise it without further permission or
payment. Participants keep portfolio rights and name credit. Each team member accepts this
individually via their own email link; a team leader cannot accept on anyone else's behalf. This is
Section 9 of the Rulebook and it applies to work built during the event.

That clause covers hackathon submissions. This repository is a reference page *about* the event,
compiled from publicly published information.

---

## Running it

No build step, no dependencies. One self-contained HTML file.

```bash
git clone https://github.com/RimjhimD/Lofi-Hackathon.git
cd Lofi-Hackathon
xdg-open index.html        # or: python3 -m http.server 8000
```

To publish with GitHub Pages: **Settings → Pages → Source: `main` / root**.

---

## Accuracy

Compiled from the public event site on **27 August 2026**. Where this page and the official Rulebook,
Scoring Rubric, Code of Conduct or Recording & Data Notice differ, **the official documents win**.
Unofficial and not endorsed by LofiStack or AskTechGuy.

Corrections: open an issue or a PR.
