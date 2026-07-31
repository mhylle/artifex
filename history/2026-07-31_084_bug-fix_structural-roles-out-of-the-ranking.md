# 084 — Structural roles out of the weak-spot ranking, and four mechanisms found with no production caller

**Date:** 2026-07-31
**Category:** bug-fix

**What:** Fixed `a750be53` — the ranking carried `mission` and `verification.*`, roles Artifex assigns itself rather than capabilities anyone could be weak at. Live, `ranked` fell 54 → 52 and the top weak spot is a real capability again. The standing orphan sweep then found three more mechanisms with no production caller, and exposed a way the sweep itself can lie.

**Why:** The ranking is the Learning Agent's output and its head is what a hypothesis gets aimed at. `mission` sat at the top with 18 observations and severity 57.5, six times the next entry — and it is not a kind of work that can be staffed differently, authored against, or benched. A hypothesis aimed at it is aimed at nothing, and `d08191c8`'s budget-outlier trigger would have fired on it first.

**Details:**

The defect's original framing said the bucket "was always there and the ladder surfaced it". Measurement before writing any code showed that is false, and the framing was rewritten rather than worked around. Counting which rung admits each structural role:

    rung 1 (capability on agent.staffed, 'verification.%')   0
    rung 3 (raw task.contracted category, 'verification.%')  0
    rung 2 (agent_design row, 'verification.%')             15

    task.contracted events with category = 'mission'          0

The mission task has **no `task.contracted` event at all** — intake builds task zero's contract without appending one — so before rung 2 existed it had no raw name and fell out of the evidence entirely. Rung 2, added the previous iteration, looks its design up and finds the registry row `mission` with 57 observations. The ladder created the bucket it was accused of surfacing.

The fix reuses `proposableCapabilities`, which already draws this exact line for `staff()` and the planner's naming guidance; the ranking is a third consumer of one rule rather than a fourth copy of it. The subtlety is ordering: `capabilityOf` strips punctuation, so `verification.physics` normalises to `verification physics` and stops matching the prefix. `#categoryFor` was restructured to have ONE normalisation point at the end, with the structural check before it, and the ladder itself moved into `#recordedCategoryFor` returning raw values.

7 mutants, all killed — including the named trap (the filter moved one line lower, after normalisation, which drops the mission role and lets every verification capability through), the mission-only filter, the verification-only filter, the inverted filter, and the filter attached to rung 2 alone.

**Outcome:**

691 worker + 160 + 66 + 50 + 26 green; all six workspaces build; restarted before measuring. Live:

    ranked: 60   before the ladder
    ranked: 54   ladder
    ranked: 52   structural roles filtered

    obs=1  sev=9    writing implements the marker
    obs=1  sev=9    technical explanation
    obs=3  sev=8.5  physics
    obs=1  sev=8    culinary instruction

No structural role in the top five.

**The sweep, and how it nearly produced a false finding.** The find-shape (l) practice was run as a script over every exported class/function. Its first output listed ~24 orphans including `staff` and `capabilityOf` — both demonstrably imported by `mission-loop.ts`. The cause was the script being written through a bash heredoc, which mangled `\b` in the regex so nothing matched; the identical code written with the file-writing tool returns `true`. This is the fifth time a heredoc has corrupted source in this repo, and the first time it corrupted a *measurement* rather than a compile. A tool that reports everything as broken is not reporting a finding.

Re-run correctly and re-verified entry by entry with recursive greps, three confirmed orphans remain, logged as `635b7a9f`: **`ActionBroker`** (R13, satisfied — nothing constructs it, `runtime.ts` wires no tool seam, yet six production sites read `inputs.toolEntitlements` and `reviewer.ts:450` fails a task that had entitlements but produced no actions), **`LearningProjection`** (R11), and **`evaluateOnSealedBench`** (R29, same area as `c1b3ae71`). `createModelPlanner` is also uncalled but is *superseded* by `createStepwisePlanner`, which `runtime.ts:521` wires — recorded so the next sweep does not re-raise it, and deliberately not deleted.

With `a1288794`, that is four correct, tested mechanisms unreachable from the deployable entrypoint, three belonging to requirements marked satisfied. The P13 shape at scale: the logic is proven, the process does not run it.
