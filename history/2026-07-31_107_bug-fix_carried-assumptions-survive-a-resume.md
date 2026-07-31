# 107 — A carried assumption survives a resume; and the door it opens has no handle

**Date:** 2026-07-31
**Category:** bug-fix

**What:** `foldPriorTrail` now folds `intake.assumption_flagged` and `assumption.became_load_bearing`, so a carried assumption survives a resume instead of being silently dropped. Measuring the premise first refuted the framing of defect `343c3fb8` (resolved), and the live control run turned its remainder into a **critical** defect: as deployed, Artifex can no longer complete any mission.

**Why:** R30 AC-2's trigger had fuel at intake and no fuel anywhere else. The interrogation is deliberately skipped on resume, so `carriedAssumptions` was rebuilt from nothing and `loadBearingNow` ran over an empty list — find-shape (a), the ledger recording something no later reader reads back.

**Details:**

**Measured first, and the measurement refuted the defect.** `343c3fb8` was filed as a *verbosity* problem: the interrogator raising "~8 questions per mission" was thought to be why every mission blocked. A probe called the interrogator seam directly — no loop, no catch — with **one underlying task and two requests differing only in how much the requester pinned down**, dial/budget/model held constant, **4 trials each**:

    VAGUE     counts [3,2,4,3]   mean 3.0   high per trial: 1,1,1,1   all-low 0/4
    SPECIFIC  counts [3,5,5,4]   mean 4.3   high per trial: 1,1,1,1   all-low 0/4

Three results, two of which refute the filing:

1. **The count was overstated** — 3.0 and 4.3, not ~8. The ~8 came from reading batch totals across missions.
2. **Specificity does not reduce the count; it RAISES it.** Every clause added to pin the request down became its own question. You cannot write your way out of the block, which kills the premise of the "cap or rank the questions" option.
3. **Exactly one high-stakes question in 8 of 8 trials** — never zero, never two — and every time about the same thing: the *output format* of the criterion itself. The criterion genuinely is ambiguous about format. The interrogator is not noisy; it is finding a real ambiguity, correctly, every time.

**The fix, RED first.** `PriorState` gains `carried` and `escalatedAssumptions`; both holders are seeded from the fold. Only `intake.assumption_flagged` is folded — `intake.question_raised` is the half the operator was asked to answer, and folding it would turn a resolved high-stakes question into a carried low-stakes assumption. The prior escalations are folded for the reason `prior.decided` exists one rung up: a resume must not refill the attention queue with an item already shown.

The prior trail in the tests is a **real** trail truncated after the last contract — the state a process that died mid-mission leaves behind — with fixture assertions proving it can prove what the tests claim, and a CONTROL in every "did not escalate" test showing a task actually ran.

**3 killing mutants:** don't seed `carried` (kills test 1); don't seed `escalatedAssumptions` (kills the twice-raised distractor); fold `question_raised` too (kills the blocking-question distractor). A 4th attempt — seeding the escalated set from the wrong event — landed behind an existing `continue`, was unreachable, and degenerated into a duplicate of the second. **Recorded as not a mutant rather than counted**, the third time in this project.

**Outcome:**

805 worker (+4) + 175 + 71 + 54 + 26 green; all six workspaces build; worker restarted and verified (process 15:40:16 against dist 15:37:57). No new typecheck errors — the three in touched-adjacent files are the pre-existing `verificationPlan` spec-tsconfig errors, and the two files edited produce none.

**The fix is real and PARTIAL, and the partial half is the serious one.** It cannot be verified live, because no production path reaches a task after an interrogation:

    mission    flagged  blocking  contracted  executed  escalated
    9aa351b4      2        1          0          0         0
    fc1a99ec      2        1          0          0         0
    4d0ca9bb      2        1          0          0         0
    7671a9d7      1        2          0          0         0

**I nearly over-claimed here and the narrowing rule caught it.** All 8 interrogated missions in the ledger had blocked — but all 8 were my own deliberately-vague intake probes, and every mission that ever delivered predated the interrogator being wired. So the delivery path under interrogation was *unmeasured*, not broken. Saying that instead of asserting the stronger claim is what made the next step obvious: run the control.

The control was one deliberately well-specified mission through the real API — *"State in one sentence why ice floats on water"* / *"exactly one sentence and names density as the reason"*. **It blocked too**, on two high-stakes questions that are both genuinely ambiguous readings of that criterion. 9 of 9 interrogated missions now block; 0 run work; 0 deliver.

So `343c3fb8` is resolved — its question is answered with evidence — and its remainder is logged as `2bedadb8`, **critical**: an intake-blocked mission produces no `task.contracted`, `resuming` is `prior.contracts.size > 0`, so the trail that most needs resuming is the one guaranteed to have nothing to resume from. The worker log for the control run says `resuming from 1 recorded events` and re-interrogates anyway. The attention queue shows the question; nothing consumes the answer.

This is find-shape (u) in its sharpest form: **removing the materiality filter was correct, blocking on a high-stakes question is correct, and together they make the system unable to finish anything.** The fix is to make the answer consumable, not to stop asking — deliberately left un-started rather than half-designed at the end of an iteration.
