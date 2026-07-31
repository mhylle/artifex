# 109 — The last terminal event decides, and both delivery events count

**Date:** 2026-07-31
**Category:** bug-fix

**What:** Defect `dd2e9d18` partially fixed — the fleet header went **47 → 26 running**, verified in the real browser. Three separate projections keyed "delivered" on `mission.folded` alone and none knew about `mission.delivered`; the fleet also let surrender win any tie, which resume made wrong. ADR-0024. The residue — 26 abandoned runs the ledger has no way to describe — is left open deliberately.

**Why:** The header claimed 47 missions were running while zero were in flight, and the rail and the detail header disagreed about the same mission on the same screen.

**Details:**

**Measured first, and the filed hypothesis was only half right.** The defect said the count "appears to include missions that never reached a terminal state". Separating the candidates rather than assuming either:

    reported running                                    : 47
    delivered but NOT folded -> shown as running        : 21
    no terminal event at all -> genuinely no outcome    : 26
    unaccounted for                                     :  0

Both true, roughly half each. Fixing only the filed hypothesis would have left 21; fixing only the other leaves 26.

**The 21 are find-shape (k) at three sites.** R37 AC-0 added `mission.delivered` as "one terminal event for EVERY delivered mission", because a mission the decompose-or-delegate gate keeps **whole** never folds. `LedgerRepository.listMissions`, `buildMissionTree` and `buildRequesterView` all predate it and were never taught about it. Live, that read as a flat contradiction: **the rail said DELIVERED and the detail header said SURRENDERED for the same mission.**

A second bug rode along in the fleet projection: it accumulated two booleans and let surrender win any tie. Sound while a mission ran exactly once — R41 made *surrendered → answered → delivered* an ordinary history, and there the cheerier outcome is simply the current one. Reporting the older state is the same lie facing the other way.

**The trap the measurement caught.** 46 missions carry `mission.folded`, 42 carry `mission.delivered`, 20 carry both. A straight swap to the newer event would have flipped 26 historical missions back to running and made the number **worse than the defect being fixed**. Both events are honoured, and that anti-regression has its own distractor test so the shortcut cannot be taken later.

Candidate rules were evaluated against the live ledger **before** any code changed:

    CURRENT  {"running":47,"delivered":46,"surrendered":74}
    FIX1     {"running":26,"delivered":67,"surrendered":74}
    FIX1+2   {"running":26,"delivered":68,"surrendered":73}   <- shipped
    22 missions change: 21 running->delivered, 1 surrendered->delivered

Every change moves in the correct direction; none moves the wrong way.

**Outcome:**

808 + **180** (+5) + 71 + 54 + 26 unit, and 170 memory-fabric integration, all green. RED first at all three sites; **7 killing mutants** — drop either delivery event at each site, ASC instead of DESC ordering, the unsafe default when no terminal event exists, and delivery failing to clear the blockers a superseded surrender recorded.

API and worker rebuilt and restarted, verified against the dist mtime (16:09:41 against 16:09:28).

**Verified through the real UI in Chrome via Playwright** — the GOAL's binding clause. The header reads **"167 missions · 26 running"**, and mission `63498d62` reads **DELIVERED** in both the rail and the detail header, with the stale blocker line gone from under it.

Two things the browser pass also surfaced, neither guessed at:

- The attention queue is genuinely rich — objective, rung, dial, criteria, findings and the intake question's own text, with Approve/Reject on each item. Find-shape (o) is clean for the intake events.
- **The cockpit does offer a `Reject` button**, which settles the first branch of the open question logged in entry 108: the label is not moot. What `reject` actually does at the runtime is still unmeasured, and is recorded as such rather than inferred.

**What is deliberately not fixed.** The residual 26 are exactly what the defect originally described: zero with activity in the last 10 minutes, oldest ~19 hours, 9 never picked up off the queue. **Nothing writes an event when a worker dies**, so the ledger cannot distinguish "running" from "abandoned" — not a query problem, and no smarter projection solves it. The candidate is a startup sweep appending a corrective `mission.abandoned` (a mission with no terminal event cannot be in flight once the process that owned it is gone), which invents no threshold and matches the fabric's own guardrail: *never fix a row, append a corrective event*. It needs its own ADR and is left on the defect rather than half-built at the end of an iteration. A staleness threshold on `lastEventAt` was rejected on sight as the hardcoded-constant-standing-in-for-a-measurement shape.
