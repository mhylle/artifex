# 2026-07-30 · 054 · code-change · Gate A in full — and two live rejections that were the gate's fault, not the plan's

**What:** Built R33. Gate A audited two of the six clauses the dossier names; it now audits five, and a rejection is no longer a dead end.

**AC-1 was entirely unbuilt.** `mission-loop.ts` called `fail('Gate A rejected the decomposition')` — the subtree surrendered. The criterion asks for the opposite: **re-split FROM the verdict rather than retrying blind**. Re-proposing from the same objective very often reproduces the same plan, spending a model call to rehearse the rejection. The verdict's findings now reach the planner as `rejectedBecause`, bounded to a single aimed retry — a planner that cannot repair its plan must not loop, and "try again with better instructions each time" is a way to spend a whole budget.

**Deterministic vs judged was the design decision**, and one half of it was wrong first:

- **deterministic** — stopping conditions present; pinned decisions where siblings must fit together. Neither needs a model, and a check that needs no model must not cost one.
- **judged** — atomicity, testability as written, and *boundary overlap*. Overlap started deterministic ("two children owning the same criterion") and the existing suite rejected it immediately and correctly: a criterion is routinely met **jointly**, so shared coverage says nothing about overlap. Overlap is about scope of WORK, which the coverage map cannot express.

The judge is a **required** parameter, not optional — an absent judge would leave clauses silently unaudited while the gate still reported a pass, which is the failure Gate A exists to prevent. That required-ness paid off immediately: the worker refused to compile until the runtime supplied a real judge.

**A clause that nothing could satisfy.** Gate A now demands pinned decisions between coupled siblings — and `pinnedDecisions` is *inherited* from the parent, with no way for the planner to propose one. A mission whose intake pinned nothing produced children that pinned nothing, so every dependent plan would have been rejected forever. Decomposition now **derives** a pin from the edge the plan already declares: the producer's deliverable, as produced, is the interface.

**Then the live stack rejected the whole thing twice, and both rejections were the gate's fault.**

1. **Testability was judged on criteria the planner cannot change.** Criteria are *partitioned, never invented* — a child carries the parent's `criterionId` and wording verbatim. Mission `d55b7f62` was rejected for "Stopping power is compared" — the requester's own words from intake — twice, and surrendered. No re-split can repair that; the thing to fix is upstream. Untestable intake is R30's job. The clause now applies only to criteria the decomposition **introduced**.
2. **The tier-2 judge over-rejected atomicity**, the same harshness behind the clarity judge's 58% false-bounce rate. Fixed with the house pattern (`d678cd8c`, `890cdea5`): sample the audit and require **unanimity to reject**. Unanimity in the safe direction — a false rejection surrenders a mission that would have succeeded, while a false pass is still caught by Gate B on the actual work.

**Proof it worked:** the identical mission text that surrendered twice now passes Gate A and **folds**. Both runs are visible side by side in the browser — DELIVERED above SURRENDERED.

**A seventh surviving mutant, and a vacuous test of mine.** "Hands the planner what failed" asserted the retry input mentioned "Price is compared" — which the **contract** carries in its own criteria, so it passed with `rejectedBecause` removed entirely. The test was matching the wrong half of the input and would have held for a completely blind retry.

**AC-0 is NOT claimed.** The sixth clause — sane use of the decompose-or-delegate gate — was written, then reverted: 32 fixtures legitimately produce one-child splits, because the loop's documented default with no gate wired is "always split". The clause is right for production and wrong for a supported configuration, and resolving it is a question about R31's default, not Gate A. Logged as `bf62266d`, with the reasoning left in the test file so a reader finds it rather than concluding it was forgotten.

**Verification.** 25 new tests, 7 mutants killed across three files, 349 worker + 66 green, full workspace build, live before/after on the same objective, browser-confirmed.

**Outcome:** R33 AC-1 and AC-2 satisfied; AC-0 carried honestly with its blocker named.
