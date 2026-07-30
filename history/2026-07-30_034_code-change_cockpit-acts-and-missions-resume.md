# 2026-07-30 · 034 · code-change · The cockpit acts, budgets bind, the human is in the loop, and missions resume

**What:** Six iterations covering R17 (cockpit actions), R18 (attention queue), R41 (resume by replaying the trail), and six defects — several of which only existed because the previous fix exposed them.

**Why:** Continuing the R14–R41 build. The thread running through all of it: **a value written to the ledger that nothing reads is not a feature**, and this project keeps producing them.

**Details:**

- **R17 — the cockpit acts.** Pause / resume / cancel / grant budget / turn dial / annotate, each appending a first-class ledger event attributed to the operator. Control state is *derived from the trail on both sides* — the control plane folds it for the UI, the runtime folds the same events for execution — so there is no `isPaused` flag anywhere and the two cannot disagree. The runtime checks only at an attempt boundary, which makes pause graceful by construction rather than by care.
- **R18 — the attention queue.** Derived from the ledger: an item is open because a task reached the human rung and no decision followed. Each carries the objective, rung, dial, the contract's criteria and the reviewer's findings *verbatim*, because "deciding never requires an investigation". The fleet's "needs a human" count had been counting **surrendered missions** — an outcome, not a question — and now counts genuine blocks.
- **R41 — resume by replaying the trail.** The ledger is the checkpoint. `task.contracted` gained the whole contract, `task.executed` gained the deliverable, and intake records task zero's contract — all three things the dossier already said the trail should hold. A resumed mission rebuilds its tree from the trail, skips Gate A for a plan already gated, and never re-executes a verified task.

**Defects, in the order each exposed the next:**

| id | what |
|---|---|
| `9fbee9d6` | The budget ceiling was **recorded and never enforced** — `grep budget.ceiling` returned three hits, all writes. "Effort is a currency" was decoration. The ceiling is now derived (contract + operator grants) so R17's top-up raises a real limit. |
| `607a2468` | `escalationPolicy.humanAt` was inherited by every child and **consulted by nobody** — `human_review` was climbed like any other rung and no human was ever asked, on any mission, under any dial. |
| `0d39d84b` | `operator.dial_turned` was written and never read. Fixed together with the above, because fixing the consumer alone would have moved an unread value into another unread value. |
| `3be8831e` | A mission could not resume: the job completed and nothing held a continuation. Re-enqueuing would re-plan with different task ids, so an operator's decision would refer to nothing. |
| `20878859` | The human rung was honoured on **one of three** escalation paths. A bouncing task climbed straight past it — seen live at seq 520. Rung-climbing had drifted across three branches; now one `stopsForHuman()` they all call. |
| `5236850d` (critical) | Event ids came from a **per-run counter starting at 1**, so a resumed run regenerated the original's ids and every append was rejected by the unique constraint. The mission did a full run's work and recorded **none of it** — the worker logged `surrendered (12 events)` while the ledger stayed at 18. Silent from outside. |

**Outcome:** The human-in-the-loop cycle closes end to end, verified in a browser: an operator clicked Approve, and the ledger shows `operator.decided` → `mission.resumed recovered=2 alreadyVerified=1` → only the unverified task re-run → no `task.contracted` in the resumed run. 402 tests green.

**Two things worth carrying forward.** First, `5236850d` was visible *only* because the worker logs append failures — a line added two iterations earlier for an unrelated reason. Without it, resume would have looked like it worked. Second, mutation-checking caught its **seventh** vacuous test here, and this one passed because a *fixture* was deterministic (`childTaskId` derives ids from the parent, so a re-decompose produced identical ids) rather than because the code was right. Tests can be vacuous for reasons that have nothing to do with the assertion.

Still open: `cd18baa0` (closes when R14–R41 are built), R15 AC-0 (needs dependency edges the planner does not declare — R32), and R17 AC-1, which is left unsatisfied because a browser-driven pause cannot be landed mid-attempt: tier-1 tasks finish in ~10s and the UI round-trip is comparable. Three attempts recorded; the property is unit-proven and the same boundary check is browser-verified for cancel.
