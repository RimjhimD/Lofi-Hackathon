# Lofi-Hackathon

Working repository for the **LofiStack Hackathon 2026 — 4-Hour Build Sprint**
(Sunday 30 August 2026, 18:00–22:00 Bangladesh time, online).

Everything for the event lives here — the reference material now, the two builds and their
supporting files on the day. Each thing gets its own folder.

---

## Repository layout

| Folder | Contents | Status |
|---|---|---|
| [`docs/`](docs/) | Single-page reference for the whole event — dates, prizes, all nine rules, the full 100-mark rubric, submission requirements, ownership terms, internship signals, FAQ. Self-contained HTML, no dependencies. | Done |
| `solutions/problem-01-<slug>/` | First chosen problem — source, README, LICENSES.md, demo video link. | Event day |
| `solutions/problem-02-<slug>/` | Second chosen problem — same shape. | Event day |
| `notes/` | Planning, problem picks, division of work, anything the team writes down. | As needed |

Folders are created when there is something real to put in them, not before.

---

## Folder conventions

**One folder per deliverable.** Nothing loose at the repository root except this README.

**Solution folders** are named `problem-NN-<short-slug>` — for example
`solutions/problem-03-invoice-splitter`. `NN` is the problem number as released at 18:00, not the
order you picked them. Each one carries the five things a complete submission needs:

```
solutions/problem-NN-<slug>/
├── README.md          what it does, how to run it, what is mocked, what is next
├── LICENSES.md        every third-party dependency, template and asset, with its licence
├── src/               the code
└── DEMO.md            link to the demo video (60s minimum) and the live URL
```

The README and LICENSES.md are worth **10 of the 20 documentation marks** between them, so they are
part of the build, not paperwork to do afterwards.

---

## Event facts, short version

| | |
|---|---|
| Build window | 30 Aug 2026, 18:00 → 22:00 BST — hard start, hard stop |
| Problems | 12 released at 18:00, each team picks exactly 2 |
| Team size | 2 to 4, scored identically regardless of size |
| Prizes | BDT 30,000 winner · BDT 10,000 to each of two runners-up |
| Internships | Up to 3, three months, individual selection on proctor observation |
| Results | ~6 September |
| AI tools | All allowed, no limits, nothing to declare |

Full detail in [`docs/`](docs/). Official site: <https://hackathon.lofistack.com>

---

## Three rules that decide marks

**The speed bonus has a gate.** Up to 8.75 marks in practice (1.25 per complete 30 minutes
remaining, measured from your *last commit*), but it pays **0** unless at least 3 of the 4 required
MVP bullets are verified working on **each** of the two problems.

**Difficulty credit is scaled, not flat.** Credit = tier value × (bullets working ÷ total bullets).
Hard is 7.5 delivered in full, but Hard-that-doesn't-run is 0 — worth less than Easy that works.

**22:00 is the only moment that counts.** Write access is revoked, every live URL is health-checked
and screenshotted, and judging happens a week later against that archive.

---

## Ownership

Work submitted to the hackathon is assigned to LofiStack under Section 9 of the Rulebook — they may
use, modify, publish or commercialise it without further permission or payment. Participants keep
portfolio rights and name credit. Each team member accepts this individually via their own email
link. Read `docs/` before pushing anything you are not willing to assign.
