# 2026-07-31 · 067 · bug-fix · The `agent_redesign` rung stops lying — lineage is born

**What:** `parent_design_id` moved off **zero** for the first time. Two defects fixed (`e758f460`, `cb939996`), decision recorded as ADR-0011.

**Why the rung was dead, and it was not the assumed reason.** Found by driving the live system, not by reading it. Two independent faults, either of which alone was fatal:

1. **`redesignFrom` was always `null`.** It was read from a `let manifest;` declared **inside** the attempt loop, so at the moment it was read it was the fresh `undefined`, and `?? null` turned that into `null`. Since `parentDesignId` is `typeof redesignFrom === 'string' ? redesignFrom : null`, every redesign registered as an **origin**. The rung *looked* enacted — a fresh design really was authored — while lineage was never born.
2. **The only route to the rung foreclosed it.** Gate B's mechanical tier raises `budget_exhaustion` when one bundle's `effortSpent` exceeds the ceiling — and the loop accumulates that same figure into `spent`. So the finding **implies** `spent >= ceiling`, always, by construction, and the loop's pre-attempt guard broke out before the redesign could be staffed. On *any* input.

Stepping was not an alternative: a live mission's ladder carries `maxAttempts: 3`, and one rung per failure reaches `agent_redesign` only as the **final** climb, after the last attempt is spent.

**The decision (ADR-0011).** A budget-exhausted task standing on the `agent_redesign` rung **produces** the replacement design — with the overspender as its parent — and records `agent.redesigned`, but **never runs it**. The ceiling still stops the spend (invariant 7 intact; a distractor asserts exactly one `task.executed`), and the ladder stops recording a rung it never enacts. Three alternatives were considered and rejected in the ADR, including raising `maxAttempts`, which would have invented a constant to make a mechanism reachable.

**Also reclassed:** Gate B's over-ceiling finding was `verification_failure`; overrunning a budget *is* a budget exhaustion. Deliberately not done until `effortSpent` became a real measurement (entry 066) — while it was a hardcoded `1` nothing could exceed any ceiling, so reclassing first would have created a second route that never fires, which is how the first dead route came to exist.

**A mutant found a gap no review did.** Deleting the `ladder[rungIndex] === 'agent_redesign'` condition — so any budget exhaustion mints a redesign — **survived all 509 worker tests**. Nothing asserted the remedy is taken only where the contract *granted* it, which `entryRungFor` is explicit about. Now covered by a distractor driving a ladder that withholds the rung.

**Verification.** 12 new tests; 5 mutants run, 5 killed (one only after the gap above was closed). 510 worker + 66 + 156 + 50 + 26 green, full workspace build, real processes restarted. Live: mission `39a621b3` reached the rung and redesigned nothing (the before); mission `6e4c2130` produced design `6934528b` with `parent_design_id = 6e25f754` (the after). The recursive clade walk over that real two-generation lineage returns `score 0.452, observations 42` for a child with **zero** observations of its own — which is exactly the "not one lucky audition" substance of R28 AC-0.

**Outcome:** the given of R28 AC-0 is reachable. The criterion is **not** claimed: `cladeScoreFor` is called by nothing — `bestForCategory` still selects on a design's *own* `clade_score`, so the child's inherited 42-observation record is invisible to the decision and it can never be bid. Logged as defect `e4b171c1` (high), the ninth occurrence of a name in the vocabulary with no behaviour.
