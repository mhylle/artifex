# 083 — The weak-spot ranking resolves its category down a ladder of evidence, never inference

**Date:** 2026-07-31
**Category:** bug-fix

**What:** Built the strict-evidence ladder in `LedgerEvidenceSource` (defect `ad116ead`), rejecting the fix this defect originally proposed. Live: the ranking went from 60 buckets to 54, no unnormalised category remains, and `physics` became the first real capability to accumulate past one observation. Two new defects were found on the way, one of them large.

**Why:** Since `340aa7de` new events carry the resolved capability, but everything older fell back to the planner's raw phrasing, so the ranking stayed fragmented and nothing downstream could accumulate against it.

**Details:**

Three rungs, each using something the system actually recorded: the `capability` on `agent.staffed`; the registered category of the `designId` that event has carried since P0 and the ranker never read; and normalisation of the raw name. Semantic resolution is not a rung, and that is the point.

The originally-proposed fix was measured and rejected. Running the fallback through `resolveCapability` cuts 105 raw categories to 57 — a 46% improvement by count. Listing the merges instead of counting them shows `hand tools overview` absorbing `Rail Travel Overview` and `Kitchen Tools - Whisk`, `mechanical engineering` absorbing `Marine Engineering / Sailing Basics`, and a maintenance-analysis bucket swallowing `Analytic Number Theory`. Merging on the tokens `overview`, `engineering`, `analysis`. That bias is right at staffing time, where a wrong reuse is caught downstream at the evidence bar, and wrong here, where the bucket IS the claim being made. The rejection is asserted as a property rather than described in a comment: a test fails if any future change adds inference as a rung.

Rung 2's reach is bounded and the bound is measured — 140 of 220 historical staffings have no registry row, every orphan first seen 2026-07-30 under the old `designIdFor` scheme. Rung 3 is why they still rank.

`DesignLookup` is REQUIRED in the constructor, so both construction sites had to be updated and neither could silently collapse to the bottom rung. 9 tests; 8 mutants killed — rung 2 removed, the ladder's order flipped, rung 3 using the raw name, rung 3 removed, the memo dropped (a query per event), a missing row memoised as a hit, the reader widened to any `*.staffed` event, and rung 2 left unnormalised. One equivalent mutant documented in place: `??=` versus `=` on the raw category, indistinguishable because a task is contracted exactly once.

**Outcome:**

686 worker + 160 + 66 + 50 + 26 green; all six workspaces build. Live, across three worker restarts:

    ranked: 60   before the ladder
    ranked: 56   ladder, first build
    ranked: 54   ladder with rung 2 normalised

The middle number is why the third measurement was taken at all. The first live reading still showed a capitalised category the ladder cannot produce; the cause was that the rung-2 normalisation had been built but the worker not restarted, so the running process was a build behind. Rebuilding is not restarting, and a number read off a process running older code is not a result.

Rung 2 initially returned the registry's stored category verbatim, and old rows predate normalisation, so one capability could occupy two buckets depending on which rung reached it — the exact two-sites-keying-on-different-versions shape the ladder exists to end, introduced by the ladder itself. Found live, not in a test.

**Two defects logged, neither folded into this work:**

`a1288794` (high) — the science loop has no production caller. Every non-test reference was enumerated: `ScienceLoop` is constructed only by `buildScienceLoop`, which is called only by its own test. The running worker calls `rankWeakSpots` directly, which is the mining half and does not go through `ScienceLoop.mine` at all. R27's AC-0 is genuinely exercised in production; AC-1, AC-2 and AC-3 describe what happens when a candidate is experimented on the bench, and that "given" is unreachable in the running system. This is the P13 lesson recurring: there the seams were assembled by the dogfood script while `main()` stayed a placeholder, here the seam-assembler is correct and nothing deployable calls it.

`a750be53` (high) — now that bucketing works, the top weak spot is `mission` at 18 observations and severity 57.5, six times the next. It is the role the API stamps on task zero, not a capability, so aiming a hypothesis at it aims at nothing. `proposableCapabilities` already encodes exactly this rule for two other consumers; the ranking is a third that ignores it. Filed with the trap named: `capabilityOf` strips punctuation, so a verification capability arrives as `verification scientific definitions` and the `verification.` prefix will not match after normalisation.
