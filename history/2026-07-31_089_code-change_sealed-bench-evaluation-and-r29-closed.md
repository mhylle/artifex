# 089 — The petition is evaluated on the sealed bench, and R29 closes

**Date:** 2026-07-31
**Category:** code-change

**What:** Wired `evaluateOnSealedBench` on the petition path — the last named gap on R29 AC-0. Live: `learning.petition_evaluated`, verdict `supported`, 1/1 sealed case. R29 is satisfied, P29 and P30 are complete, and the **phases pillar is green for the first time: 53 of 53.**

**Why:** AC-0's second clause — "and is evaluated against the sealed bench rather than any slice the learner could have optimized against" — was the only thing keeping the criterion open after iteration 73 proved the first clause live. `evaluateOnSealedBench` had no production caller.

**Details:**

The function already decided the hard parts and was not touched: it throws when handed a non-sealed case rather than filtering it, requires unanimous support, and calls an empty set `unevaluated` rather than the arithmetic 100% that zero-of-zero gives. What was missing was the thing deciding, for one sealed case, whether it argues for the petition.

That is derived, never asked of a model. Today's only petition kind is the budget-versus-value outlier, so a sealed case supports it when its own source task spent at or over `NEAR_CEILING` of its contract's ceiling — the same bar the ranking used to raise the petition. `NEAR_CEILING` was exported rather than copied: a petition argued at one threshold and judged at another is the two-sites-keying-on-different-versions shape this repo keeps finding. The rule is specific to that petition kind and says so; a second kind would need its own support rule.

The spend is not on the bench case — it is on the ledger — so each sealed case's source mission is replayed to find it, memoised because sibling cases share one.

The verdict is appended as its own `learning.petition_evaluated` event rather than folded into the proposal. The proposal is what the learner *argued*; the evaluation is what the bench *answered*. Collapsing them would let a reader mistake the learner's own filing for a judgement made against evidence it never chose.

12 tests, 7 mutants killed. Two are worth recording. The dogfood stub still sitting in the live sealed slice — contract `{"o": "sealed case"}`, no budget at all — was made a distractor: a rule treating a missing ceiling as "spent everything" would let it cast a unanimous vote to amend the Constitution. And the mutant removing the `typeof effortSpent !== 'number'` guard **survived at first**, because `undefined / n` is NaN and every NaN comparison is false. It is not equivalent, though: `'9' / 10` is 0.9, which clears the bar exactly. Payloads arrive from JSON, so a string spend is a real possibility, and a distractor now pins it.

**Outcome:**

722 worker + 160 + 66 + 50 + 26 green; all six workspaces build; rebuilt **and restarted** before measuring.

    worker log:  sealed-bench verdict: supported (1/1 case(s))
                 petition filed and awaiting ratification: ...
    ledger:      learning.petition_evaluated  verdict supported  1/1  slice sealed

The scored case is genuine, not a fixture: `293d29bb`, sealed, capability `technical writing`, contract ceiling 2, source task spent 2 — 100%, clearing the shared bar. It exists because iteration 74 gave the bench a live producer; before that there was no `technical writing` case to score at all.

A first attempt measured nothing and was not reported as success: the queue was backed up three missions deep at concurrency 1, because the worker had been killed mid-mission during the build. Waiting for it to drain was the difference between "the fix did not work" and the result above.

Driven through the real UI with Playwright: the Learning Observatory renders the petition as `"status": "proposed"`, `"appliedBy": null`, with its full rationale.

R29's three ACs are satisfied, so the requirement and phase P29 are closed. P30 was closed with its own evidence. **Phases: 53 of 53.**

**One gap logged rather than hidden:** `78e4e5cf` — the cockpit shows the petition but not the sealed verdict, so an operator ratifies without seeing the independent evidence the sealed slice exists to provide. The verdict is on the ledger and auditable; it is simply not yet where the decision is made.

Remaining blockers: 6 open defects, 1 unsatisfied AC (R13's, correctly open per ADR-0015), and the architecture-drift tooling.
