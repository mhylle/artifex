# ADR-0013 — The fast loop's bounds are derived, and its reach is bounded three times

- **Status:** accepted
- **Date:** 2026-07-31
- **Context:** R26 (the fast loop), phase P26

## Context

R26 is the second speed of the learning cadence. R27's science loop runs between
missions — mine, hypothesize, experiment, replicate, transfer-test, adopt by
ratchet. The fast loop runs *while a mission runs*, patching worker-layer assets
mid-flight. There is no human in the way and no pause in which to notice a
mistake, so every bound is load-bearing.

The dossier's sentence is the specification: *worker layer only, one change at a
time, logged as an experiment, auto-reverted if the failure rate doesn't move.*
Four clauses, four bounds. Each needed a number or a mechanism, and inventing
either is what this ADR exists to avoid.

## Decision 1 — "repeatedly" is the contract's own `stallLimit`

The trigger fires when one category has failed Gate B `N` times on the same
criterion. `N` is **not a new constant**: it is the contract's
`stoppingConditions.stallLimit`, which is already the system's answer to "how
many times is repeatedly?" — R36's stall counter uses it for exactly that
question about attempts.

A second number for the same idea would be two answers to one question, and the
second would have no evidence behind it.

## Decision 2 — the evaluation window is the baseline's own evidence

The window is the number of observations the baseline rests on, so before and
after are compared over **equal evidence**. A shorter window calls noise an
effect; a longer one leaves an unproven change in place longer than the evidence
that justified it.

The window also **closes when the mission ends**, not only when it fills. This
was found by a test, not by design: a window that closes only by filling never
closes at all once the patched category stops appearing, so the hot-fix would
outlive the mission that made it — the one outcome AC-1 exists to prevent. A
window closed early is under-evidenced, and under-evidenced reverts.

## Decision 3 — the prediction is derived from peer criteria; there is no significance threshold

An experiment carries a predicted effect. The obvious options were both bad:

- **Predicted = baseline.** Carried as "strict improvement", but as a *number* it
  predicts nothing, and a prediction that cannot be wrong is not one.
- **Predicted = baseline × some factor.** An invented constant, exactly the shape
  this project has had to remove before (`effortSpent` was a hardcoded `1`).

The chosen prediction is **the rate this same category already achieves on its
other criteria**. If `c-1` fails 3 of 4 while the category's other criteria fail
1 of 10, the fix predicts `c-1` comes down toward the 0.1 its peers manage. That
is falsifiable, and it is measured rather than chosen. Peers are **pooled**
rather than averaged per criterion, so a criterion with one observation cannot
outvote one with thirty — the same weighting argument as R28's clade score.

When the category has no other criteria there is no reference, and the prediction
degrades to the weakest honest claim — strictly better than baseline — and
**says so** via `basis: 'strict_improvement'`. The store enforces the
distinction: a `peer_criteria` prediction must be strictly below its baseline, a
`strict_improvement` one must equal it. Neither can quietly carry an invented
number.

**The revert bar is the baseline, not the prediction.** AC-1's revert condition
is its own sentence — "whose measured failure rate does not move" — so a fix that
moved the rate but fell short of an ambitious prediction has not met the stated
condition, and reverting it would discard a real improvement. The prediction is
not wasted: a fix that improved without reaching it is precisely the partial
result R27's science loop turns into a hypothesis, which is the documented
hand-off between the two speeds.

## Decision 4 — revert is the default, structurally

Every path that is not a **measured strict improvement** reverts:

| situation | outcome |
|---|---|
| rate got worse | revert |
| rate did not move | revert |
| window closed with no observations | revert |
| window closed early, under-filled | revert |
| rate strictly improved | keep |

The third row is the important one. Treating "no evidence against" as "evidence
for" is how an unevaluated change becomes permanent. An open window decides
nothing — it neither keeps nor reverts — because judging at the first result
would make the verdict a coin flip.

## Decision 5 — reach is bounded three times, in three places that fail independently

AC-2 says "by construction, not by convention". A rule that holds because every
call site remembers to check it is a convention, so the bound is stated three
times:

1. **The type** — `HotFixTarget.layer` is the literal `'worker'` and `kind` is a
   closed union, so a playbook target does not compile.
2. **The guard** — `checkFastLoopReach` in `constitution.ts`, an **allow-list**,
   for data that reaches the runtime having never been type-checked. A blocklist
   ("refuse meta and core") permits every layer nobody has thought of, and new
   layers are exactly what a self-improving system grows.
3. **The store** — CHECK constraints on `hot_fix`, which still hold when code
   bypasses the guard: a replay, a repair script, a call site nobody has written
   yet.

Deliberately **narrower than `Proposal.targets`**, which may name the
constitution. A proposal argues; a hot-fix acts. The learner may argue that any
rule should change and may change almost nothing — the distinction between
arguing and acting is the whole design, and the two vocabularies differ for that
reason rather than by oversight.

The reviewer rubric is the case worth stating aloud: a system that can patch its
own marking scheme mid-run can make any failure disappear without improving
anything. That is invariant #4's yardstick problem in its fastest form.

## Consequences

- **Reversible.** The decision core is pure and the store is additive (migration
  0008 with a `down`). Nothing existing changed behaviour.
- 15 mutants run against the decision core and guard, 15 killed; 7 against the
  migration's constraints, 7 killed. Two of those kills required fixing a test
  first — see below.
- **Two masking failures found, both by mutants rather than review.** A blocklist
  guard survived all 27 worker tests because the `kind` check refused the fixture
  before the `layer` check was reached; the distractor now uses an unknown layer
  with a *permitted* kind. And making `previous_value` nullable survived all 127
  integration tests because every fixture supplied one; that column is the entire
  reason a revert needs no human, so the store must refuse the row rather than
  merely never receive it. This is the second consecutive ADR to record
  guards masking each other.
- **NOT YET SATISFIED, and deliberately not claimed.** The decision core, the
  constitutional guard and the store are built and proven; **nothing calls
  them**. That is the exact shape this project has found nine times, so R26 stays
  unsatisfied until the mission loop fires the fast loop and a live mission shows
  a hot-fix applied and auto-reverted. Carried as an open defect.
