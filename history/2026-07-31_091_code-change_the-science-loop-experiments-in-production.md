# 091 — The science loop experiments in production

**Date:** 2026-07-31
**Category:** code-change

**What:** Wired the science loop's experiment half (defect `a1288794`, R27 AC-1/2/3). ADR-0017 decides what a candidate is: a fast-loop hot-fix, re-tested on the bench. Live: a real candidate ran two replications on the open bench, failed the held-out slice, and was rejected with its evidence recorded on the ledger.

**Why:** `ScienceLoop` was constructed only by `buildScienceLoop`, which was called only by its own test. The worker ran the mining half and nothing else, so the criterion's "given" — a candidate experimented on the bench — had never been reachable.

**Details:**

What blocked it was a question rather than code, and `buildScienceLoop`'s own comment said so: "what it means to run a candidate is the one thing this file cannot decide, because a candidate is a change to how the swarm works and only the caller knows what change it is testing." Every other piece already existed and was tested — `experimentPlan` splits a fixed budget and refuses an uneven division, `BenchCandidateRunner` judges rather than diffs and counts anything short of a demonstrated pass as a loss, `adoptionDecision` requires replication and a held-out win.

ADR-0017 answers the question with R26's own sentence: *"Fast-loop results become science-loop hypotheses (R27)."* A hot-fix is already a worker-layer change to one concrete asset — `role_instructions`, a `target_asset_id`, a `previous_value` and a `patched_value` — so running it is well-defined: execute a bench case's contract with the patched instructions in front of the worker, and judge the deliverable against that case's own criteria. A *reverted* hot-fix is the most interesting candidate rather than the least, because the fast loop reverts on a window of two observations, which is right in-mission and far too little to conclude the change is bad.

Both fuels were checked before anything was built, which is the rule that saved iteration 74. Bench: six cases across three capabilities, both slices. Candidates: four resolved hot-fixes with live `fast_loop.hot_fix_applied` and `_resolved` events.

Built: `HotFixRepository.resolvedCandidates` — a queue, resolved-only, oldest first, with five integration tests against a real Postgres; `candidateExecutor` and `candidateJudge`, nine unit tests and six mutants; `createCandidateSeams` in `runtime.ts`, where `AnswerSchema` and `CompletionSchema` already live, so a candidate cannot be asked for a different shape than a real worker is; and the caller in `index.ts`, one candidate per pass so mission latency does not become a function of research backlog.

The most valuable mutant was an unknown candidate falling back to the un-patched instructions. That would score the baseline and report it under the candidate's name — a failure that looks exactly like a successful experiment. The executor throws instead, and a throw is already counted as a loss.

**Outcome:**

731 worker + 165 + 66 + 50 + 26 green, plus 159 memory-fabric integration tests; all six workspaces build; rebuilt, restarted, and the queue allowed to drain before measuring.

    candidate b878e2fe-...: reject — won 0 time(s) — a single lucky run adopts
    nothing, and 2 independent wins are needed before a result counts as replicated

    learning.candidate_evaluated   adopt=false  wins=0  losses=2  heldOutWon=false

A real hot-fix, produced by the fast loop during an actual mission, replayed against the open bench under a budget read from the bench's own size, then against the sealed slice, and rejected with its evidence kept.

**The candidate lost, and that is a measurement rather than a failure of the wiring.** ADR-0017 predicted this shape: the patch was written for one task's objective — "criterion m-1 has been the failing one on 2 of the last 2 attempts" — so replaying it against a different case tests the *shape* of the instruction rather than its literal text, and a loss may mean the patch was specific rather than wrong. The rejection is recorded as evidence precisely so the next hypothesis does not re-run it.

**Bound, stated rather than rounded up:** R27 AC-3's specific case — a candidate that won *exactly once* — was not exercised live, because this one won zero times. That clause remains covered by unit tests only.

One defect found while designing and logged rather than folded in: `aa6948ee` — `fast_loop.hot_fix_applied` records which asset was patched but not the patch itself, so the trail cannot reconstruct what the swarm actually did. That is why the candidate source has to read `hot_fix` rather than the ledger.
