# 2026-07-30 · 051 · code-change · R40 — the worker contract ritual, and what only the live stack could tell us

**What:** Built R40 (restate, bounce, deliver an evidence bundle), which closed R22 AC-1 and defect `d0d555db`, and surfaced a new high-severity defect that every green test in the repo was blind to.

**Why it was the highest-leverage item:** R40 is the missing *producer* for three carried items. `EvidenceBundle` has declared `assumptions` since P2.5, but `task.executed` recorded only `{ answer }` — so the requester view had no honest option but "not recorded", and the Knowledge Commons had nothing to admit.

**Two gaps, both real.**

*The bundle stopped at the seam.* `task.executed` now carries `actions`, `consulted` and `assumptions` alongside the deliverable. An empty list is recorded **as empty**, never omitted: absent and empty are different claims, and collapsing them is what made "nothing was assumed" indistinguishable from "nobody recorded it".

*The floor was unenforced.* Budgets bound only at the ceiling, so a deliverable produced below the contract's floor was accepted as cheap success. The check runs **before Gate B** on purpose — the floor is a claim about effort, and the reviewer does not measure effort; passing thin work to a reviewer that may well approve it is how a shallow attempt gets recorded as a pass. Below-floor work costs an escalation rung, not the task: a retry that meets the floor is accepted, and work exactly *at* the floor is accepted, because that is the one figure the contract explicitly blesses.

**The lesson repeated itself, and it was worth the cost.** Ten unit tests passed, six mutants died, the full workspace suite was green — and then the live stack said something none of them could:

1. **The producer did not exist.** `createMissionSeams` hardcoded `assumptions: []`. The plumbing was perfect and permanently empty — the same inert shape logged against the Knowledge Commons one iteration earlier. Tests that *inject* a bundle can never catch this. A new test now drives the real seam and asserts it **asks**.

2. **The tier-1 model corrupts deliverables** (defect `08db92fd`, high). `qwen3.5:2b` emits JSON syntax *inside* the answer string — one mission delivered `"5\", \"explanation\": \"A standard hard-boiled egg..."`. It passes schema validation, because it is a non-empty string. Gate B then judges garbage and the requester view renders it. A silent-wrong-answer path, found only by reading what a real mission actually produced.

**A misattribution, recorded rather than buried.** The corruption first appeared when `assumptions` was added as a second property on the worker schema, so it was blamed on schema width and the elicitation was split into its own probe. **The corruption then reproduced on the single-field schema, same objective.** The leak tracks the objective, not the schema. The two-probe split was kept on its own merit — asking for provenance must not cost a deliverable already in hand — but the comment in `runtime.ts` and the test that had encoded the false cause were corrected in place. A test asserting a wrong cause is worse than no test: it would have closed the real investigation.

**Also corrected: a fifth surviving mutant.** A test named "tells the worker what an assumption IS" only asserted the word appeared *somewhere* in the prompt. A mutant deleted the definition, left the caveat behind, and passed. Fifth time a surviving mutant has exposed a claim the describe made and the assertion did not.

**Verification.** 309 worker + 66 + 26 tests green, full workspace build, services restarted, and — the part that matters — **verified in a real browser**: the requester lens renders the assumptions a real worker declared on mission `0f95dc3c`, read from the ledger. Floor enforcement verified live on mission `32b8dec2`: `task.below_effort_floor`, a rung climbed, surrender rather than cheap success, and no Gate B verdict.

**Stated plainly rather than glossed:** `effortSpent` is still a hardcoded `1` at the real work seam. The floor mechanism is correct and tested, but effort is not yet **measured** — so the floor binds only for floors ≥ 2, while the real intake default is 1. AC-2 is satisfied on demonstrated behaviour; the measurement gap is a separate open item, not something to claim past.

**Outcome:** R40 satisfied (all three ACs), R22 satisfied (AC-1 closed, requirement complete), defect `d0d555db` resolved, defect `08db92fd` opened.
