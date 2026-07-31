# 081 — The ranker bucketed on the planner's raw category while staffing resolved it

**Date:** 2026-07-31
**Category:** bug-fix

**What:** Defect `340aa7de`, reframed and fixed. The manifest now reports the RESOLVED capability, `agent.staffed` records it, and `LedgerEvidenceSource` buckets weak spots on it — with a fallback to the raw category for events that predate the field. Measured before and after against the live ledger. A follow-on gap the fix does not close is logged as defect `ad116ead`.

**Why:** Two sites keyed on different versions of the same thing — house find-shape (k). `staff()` computed `capability` via `resolveCapability` and then put `contract.category` on the manifest, discarding the resolution twenty lines after performing it. The evidence source bucketed on that raw name. So staffing merged the planner's invented phrasings and the ranker re-split them, which is how weak spots reported `observations: 1` while the registry held a capability with ten. Every category-keyed mechanism downstream — R29's amendment trigger, the fast loop, the weak-spot ranking the science loop rests on — was reading a fragmented signal.

The defect's original framing ("1.07 designs/category, the planner names SUBJECTS") was wrong about the present and was rewritten rather than worked around: that ratio measured a historical backlog, not a live rate.

**Details:**

Measured first, per the standing rule that a constant must come from data the system already has:

```
BEFORE, over the same tasks:   31 raw categories | 22 resolved capabilities
  scientific terminology <- scientific definitions | Scientific Definitions |
                            Scientific Terminology | scientific writing | Scientific Writing
  hand tools overview    <- Hand Tool Education | Hand Tools | Hand Tools Overview | Woodworking Tools
```

Three coupled changes, none of which works alone:

1. `staff()` reports `capability` rather than `contract.category` on the manifest.
2. `mission-loop` records `capability: manifest.category` on `agent.staffed` — the event recorded WHICH design but not which capability (find-shape g).
3. `LedgerEvidenceSource` prefers it, falling back to the raw `task.contracted` category for the thousands of historical events. Dropping those would have emptied the ranking to improve its resolution — all the evidence traded for cleaner buckets.

A live probe disproved a trap the design was about to be built around. A task carries TWO `agent.staffed` events on the SAME task id, and `categoryOf` is last-write-wins — so a verifier staffing would steal the producer's bucket and every verified task would land under `verification.*`. It cannot, because the loop records verifier staffing under its own `verifier.staffed` type. Pinned by a distractor rather than left to luck; the mutant that widens the match to any `*.staffed` event is killed.

8 tests. Mutants: manifest reverts to the raw category (2 fail), the loop drops the capability (1), the ranker ignores it (1), the historical fallback removed (5), the reader widened to any staffing event (1). One EQUIVALENT mutant — removing the `!has` guard changes nothing, because replay is ordered by `seq` and `task.contracted` always precedes `agent.staffed`. Documented in place rather than papered over with a test that cannot distinguish it.

**Outcome:**

Verified live, and the verification is partial in a way worth stating.

```
AFTER, over the seven tasks staffed since the change:   4 raw names | 1 resolved capability
```

The collapse happens in production, not only in a fixture. But the consequence predicted for it did **not** follow: the latest `learning.weak_spots_ranked` still reports `ranked: 60` buckets with top observations of 1 and 2. The historical fallback keeps old names split, and the new missions passed, so their capability is not a weak spot at all. R29's amendment trigger (`d08191c8`) remains blocked. Reported as a partial result rather than as progress.

That gap is now defect `ad116ead`, with its own measurement taken the same way — running the real `resolveCapability` from `dist` against the live ledger rather than reimplementing it:

```
buckets   raw=105    normalised=92    resolved-against-ledger=87
```

The proposed fix is to run the historical fallback through the same `resolveCapability` staffing uses, with `known` derived from the ledger's own `agent.staffed` capabilities in most-staffed-first order. Deliberately not attempted in the same iteration: it is a second structural change and would have gone in without a RED test.

662 worker + 160 + 66 + 50 + 26 green; all six workspaces build.
