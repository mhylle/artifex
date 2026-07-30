# 020 — P6: Agent Creator (reuse-first staffing) + the Asset Registry

**Date:** 2026-07-30
**Category:** code-change
**Phase:** P6 (Tasktracker `60a9d124-…`) · **Requirement:** R6

**What:** Built the Agent Creator — reuse-first staffing producing capability manifests with a computed tier and a contract-tied validation harness — plus the Asset Registry store in `memory-fabric` (migration 0002), which ADR-0005 always said would land here.

**Why:** R6, and because reuse-first staffing is the mechanism behind "permanence is earned" (invariant #5).

**Details:**
- **The evidence bar is the load-bearing idea.** `bestForCategory` requires a minimum observation count before a clade score counts as earned. Below it a design is not *bad*, it is **unproven** — and treating unproven as proven is exactly how one lucky first run promotes itself into a permanent default. Unproven designs pass `null` to the tier policy so they compete on the same footing as a fresh one.
- **The tier is computed, never chosen by the designer.** An agent that picked its own model could buy itself a bigger one — the budget equivalent of grading your own homework.
- **The validation harness is built from the contract's own acceptance criteria**, one check per criterion, each naming its `criterionId`. A harness that says the same thing for every task measures nothing — and since permanence is decided on harness evidence, a generic harness would promote designs on the strength of a test that never varied.
- **The manifest can never entitle more context than the contract already grants** (invariant #6).
- **Down-weight, never delete.** `deactivate()` stops a design bidding but keeps the row and its evidence: a design that lost on one task class may be right for another, and hard-deleting destroys what the Learning Agent reasons over.
- The clade score is a **running mean carried with its observation count**, folded in incrementally so the ratchet never needs the full task history in memory and a score always states how much evidence it rests on.

**Outcome:** TDD red→green. 46 worker tests, **136 repo-wide**, **29 integration** (up from 20), build + typecheck clean.

**Dogfooded the whole ratchet against the real registry — and it moves real models:**
```
NO-BID     -> manifest authored, harness tied to contract -> tier 2 -> gemma4:12b
1 outcome  -> still a NO-BID (one audition is not a track record)
3 outcomes -> BIDS (clade 0.93, n=3)
reuse      -> same designId, tier 2 -> 1              -> qwen3.5:2b
deactivate -> stops bidding, evidence survives (n=3, clade 0.93)
```
That fourth line is the economic argument for the swarm demonstrated rather than asserted: earned evidence took the work from a 12B model down to a 2B one.

**Self-correction worth recording.** The mutation check initially changed *nothing*, which exposed that two of my own distractors were **vacuous**: written at `medium`/`generative` parameters where the proposed tier already equals the floor, so the clade-discount branch was unreachable and both sides returned 1 regardless of the code. One also used `toBeLessThanOrEqual`, which passes on equality. Rewritten at evaluative work — where there is real slack above the floor — with strict inequality; the mutation then failed exactly the right test. Logged as a **global** learning: a distractor that cannot fail is worse than no test, because it manufactures confidence. The spec typecheck earned its keep in the same phase, catching a destructure of a `container` property the `TestDatabase` fixture does not have.
