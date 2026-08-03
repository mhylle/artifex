# 116 — The answer reaches the screen

**Date:** 2026-08-03
**Category:** bug-fix

**What:** A delivered mission now shows **what it delivered**. Reported by the owner of the only mission in the system: *"it is set as delivered. but there is no place where I can see what was delivered."* Three faults behind one sentence — one of them an invariant violation, one of them mine from the day before.

**Details:**

**Fault 1 — the delivery event did not carry the delivery (invariant #1).** `mission.delivered` recorded the objective and the pedigree: everything *about* the delivery except the delivery. For a mission kept whole the answer could still be dug out of `task.executed`; for a **decomposed** mission the reconciled result existed only in `runMission`'s return value and reached **no event at all**. A replay could say a mission delivered and never say what.

That is the exact shape of defect `aa6948ee`, where an event named everything about a hot-fix except what the instructions were patched to, and was fixed by the same argument. `mission.delivered` now carries `deliverable`.

**Fault 2 — no lens read it.** Find-shape (o), and the most valuable instance yet: nothing in the dashboard rendered a deliverable *anywhere*. The inspector renders a **task** deliverable and only once a node is selected — and a mission the gate keeps whole has no node to select. So the one thing the mission was commissioned for was the one thing the cockpit could not show.

`buildMissionTree` now exposes the mission's deliverable, `readableDeliverable` renders it (prose as prose, anything else as readable JSON, never `[object Object]`), and it appears above the lenses, because it is the answer and everything below it is how the answer was reached.

**Fault 3 — the canvas was drawing a plan that no longer existed.** Mine, from entry 115. `foldPriorTrail` in the worker discards the plan when it walks past a restatement, so the mission re-plans; `buildMissionTree` did not, and drew the **rejected** task tree over a mission that had since delivered something else. Two projections of one trail disagreeing is precisely what a pure projection exists to prevent. Live before: 2 stale nodes. After: 1.

**The fallback that makes it work for missions that already exist.** A `task.executed` **at the mission task** is the mission's own answer — that is what a kept-whole mission produces — so it is used when the delivery event carries nothing. Without it the fix would have been true only for missions run after today, and the owner's mission would still show nothing. A **child** task's result is never used: reporting one fragment as the mission's answer is worse than showing nothing, because it looks complete. That has its own distractor.

**Outcome:**

821 worker + **234** dashboard (+17) + 58 api + 71 + 54 + 26 green; all six workspaces build.

Verified in the browser on the owner's mission — the panel reads *"1. Induced Pluripotent Stem Cell Differentiation: … Yamanaka Factors … 2. Somatic Cell-Induced Pluripotency (SCiP) … 3. CRISPR-Cas9 Guided Differentiation Mapping"*, which is exactly what the restated criterion asked for.

**A regression I caused and the suite caught.** Adding the mission-task capture as a *new* `case 'task.executed'` created a duplicate switch label — in JavaScript the first match wins, so it shadowed the real one and silently disabled task status, effort and ceiling for every task in the tree. Six existing tests failed immediately. Fixed by extending the real case rather than adding a second, and the assertion `count === 1` now guards it in the script that applied it. Worth recording: the failure was invisible in the feature I was adding and obvious in the tests I was not thinking about.

**Also recorded:** I wrote `deliverable.ts` and its spec in one command and never saw them fail, which is the RED-first slip this project keeps making. Compensated by mutating afterwards — dropping the sole-field guard and replacing `JSON.stringify` with `String()` — both killed. The discipline still slipped and is recorded as slipped.
