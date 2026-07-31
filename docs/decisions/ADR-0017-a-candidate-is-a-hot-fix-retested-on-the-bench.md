# ADR-0017 — A science-loop candidate is a fast-loop hot-fix, re-tested on the bench

**Date:** 2026-07-31
**Status:** Accepted
**Context:** R27 (science loop), R26 (fast loop), defect `a1288794`

## Context

`ScienceLoop` is constructed only by `buildScienceLoop`, which is called only by
its own test. The running worker calls `rankWeakSpots` directly — the mining half
— so R27 AC-1, AC-2 and AC-3 describe what happens *when a candidate is
experimented on the bench*, and that "given" has never been reachable.

Every piece except two exists and is tested: `experimentPlan` splits a fixed
budget and refuses an uneven division; `BenchCandidateRunner` replays a case,
judges rather than diffs, and counts anything that is not a demonstrated pass as
a loss; `adoptionDecision` requires replication and a held-out win. What is
missing is a `CaseExecutor`, a `CaseJudge`, and — the real question — **what a
candidate IS**.

`buildScienceLoop`'s own comment says why this was left open: "what it means to
run a candidate is the one thing this file cannot decide, because a candidate is
a change to how the swarm works and only the caller knows what change it is
testing."

## Options considered

**A — A candidate is a proposed model-tier change.** Rejected: tier is computed
per staffing decision by the Tier Policy engine, so a "candidate tier" is not a
change to an asset the ratchet can adopt. It would also make every experiment a
question about spend rather than about capability.

**B — A candidate is a decomposition template.** Rejected for now: templates are
already earned by surviving Gate A (R31 AC-2), so they have their own admission
path. Nothing is broken there for the science loop to test.

**C — A candidate is a fast-loop hot-fix.** Chosen.

## Decision

**A candidate is a hot-fix the fast loop applied**, re-tested properly on the
replay bench.

This is not invented for convenience — R26's own requirement says it: *"Fast-loop
results become science-loop hypotheses (R27)."* The two speeds of learning were
always meant to connect here, and the connection had simply never been built.

The fit is exact. A hot-fix is already a worker-layer change to one concrete
asset: it records `target_kind: role_instructions`, `target_asset_id`, a
`previous_value` and a `patched_value`. So "running the candidate" is
well-defined — execute a bench case's contract with the candidate's
`patched_value` as the worker's role instructions, and judge the deliverable
against that case's own acceptance criteria.

A **reverted** hot-fix is the most interesting candidate, not the least. The fast
loop reverts on a window as small as two observations (live: all four hot-fixes
reverted, with `window_observations` of 2). That is the right call in-mission —
revert is the default and a small window is all a mission affords — but it is far
too little evidence to conclude the change is bad. The science loop exists
precisely to re-test such a thing under a fixed budget with replication, against
cases nobody tuned against.

**One candidate per pass, oldest first.** Not a tuning threshold: it is a queue
being drained one item per mission-completion. Each run costs real model calls
per case per replication, and running every untested candidate on every mission
would make mission latency a function of research backlog. The bound is on work
per tick, and the queue is what the ledger already records.

## Consequences

- The science loop gets a production caller and R27's AC-1/2/3 "given" becomes
  reachable. Whether the *then* holds is a separate question, to be measured
  live and reported honestly rather than assumed from the wiring.
- Candidates are drawn from a real, live source: four hot-fixes exist, produced
  by the fast loop during actual missions, with `fast_loop.hot_fix_applied` and
  `_resolved` events on the ledger. The fuel was checked before the engine was
  built — the rule that saved iteration 74.
- The judge is the completion judge, not a string comparison, exactly as
  `bench-runner.ts` already requires: the recorded outcome is one verified
  answer, not the only correct one.
- **A hot-fix's patch is written for one specific task's objective**, so replaying
  it against a different case's contract tests the *shape* of the instruction —
  "check the failing criterion explicitly before submitting" — rather than its
  literal text. That is a real limitation of this framing and is stated here
  rather than discovered later: a candidate whose patch names a criterion the
  bench case does not have is being asked a question about generalisation, and a
  loss may mean the patch was specific rather than wrong.
- Reversible: the candidate source is one function. If templates or another asset
  kind later prove a better hypothesis source, they become an additional source
  rather than a rewrite.
