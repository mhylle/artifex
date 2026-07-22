**What:** Completed the full SWARM → Artifex rebrand across all content (the `solution/` dossier, the source brainstorm, and the ADRs), finishing the rename started in entry 005.

**Why:** Entry 005 renamed the repo, Tasktracker project, and top-level docs but left the 7-page `solution/` dossier and other docs branded "SWARM". The owner asked to "rebrand everything" for a consistent public identity.

**Details:**
- Context-aware replace (all-caps brand `SWARM` → `Artifex`) across `solution/*.html` (all 7 pages), `docs/brainstorms/2026-07-22-agent-swarm.md`, and both ADRs. Lowercase "swarm" / "Worker Swarm" (common noun — Artifex still runs a swarm of agents) deliberately kept.
- Hand-fixed the dossier's title subtitle: the old `index.html` kicker expanded the SWARM acronym ("Self-organizing Workforce with Adaptive Roles & Memory"); replaced with an Artifex tagline ("Latin for 'the master craftsman' — the workforce that crafts itself"), since Artifex is a word, not an acronym.
- Refreshed now-stale "rebrand pending" notes in `README.md`, `CLAUDE.md`, and `CLAUDE-activeContext.md`; updated the history index title + Phase 0 prose to rebrand-with-accuracy; updated auto memory.
- **Deliberately NOT changed:** the dated `history/` entry files (001–005). They are an append-only record and legitimately reference "SWARM" as the project's name at the time; entry 005 documents the rename itself. Rewriting them would falsify the log.

**Outcome:** `solution/` and `docs/` contain zero "SWARM" brand references; the project reads as Artifex end to end. Remaining "SWARM" mentions are intentional historical notes (CLAUDE.md/active-context/history index) and the immutable dated entries.
