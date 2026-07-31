# 2026-07-31 · 068 · code-change · The clade finally decides something — R28 satisfied

**What:** `bestForCategory` now ranks on the **lineage aggregate** instead of the design's own `clade_score` column. R28's last unsatisfied criterion (AC-0) closes; the requirement and both its phases are complete. Decision recorded as ADR-0012; defect `e4b171c1` resolved.

**The gap.** `cladeScoreFor` — the observation-weighted recursive CTE over `parent_design_id` — was correct, thoroughly tested, and **called by nothing**. The ninth "name in the vocabulary with no behaviour" this project has found. The one place a design's standing decides anything filtered and ordered on the design's *own* column, so the clade walk sat beside the decision rather than inside it. AC-0 asks that "when its promotion is **considered**, the **decision** uses a clade score"; a query nobody calls considers nothing.

**The decision (ADR-0012).** An inherited score is used at **full weight**, with no generation-distance decay, and the evidence bar (`minObservations`) now counts the **lineage's** observations. A decay factor would be an invented constant; the observation weighting already *is* the discount, and it is derived — a child's single run barely moves a parent's thirty-run mean, and the mean shifts toward the child exactly as fast as it earns evidence. **Ties break on own observations**, because a child and its parent share one lineage and therefore score identically by construction; without that, an unrun redesign would evict the incumbent it was derived from. Inherited standing gets a design into the room; its own record wins the seat.

**Three of my own tests passed before any fix, for the wrong reason.** The ancestor in each fixture was still *active*, so it won on its own 0.95 column and the heir's lineage was never consulted — the "wins for a different reason than the one asserted" weakness, caught by reading the RED output rather than trusting it. Retiring the ancestor removes it from the bid while leaving its record in the lineage, which isolates the mechanism. Fixed at the fixture, and said so in the test file.

**A mutation lesson worth keeping: two redundant guards masked each other.** Dropping `d.active = true` from the CTE anchor survived all 109 tests; dropping it from the outer `WHERE` also survived all 109. Each alone was covered by the other. Only removing **both** killed 4 tests. A single-site mutant is not enough where a predicate is stated twice.

**Verification.** 6 tests added; 6 mutants run — 4 killed individually (tie-break inverted, evidence bar dropped, rank reverted to the own column, both active filters removed), 2 proved equivalent-by-redundancy. 109 memory-fabric integration + 510 worker + 156 + 66 + 50 + 26 green, full workspace build, real processes restarted.

**Live falsification on the real database**, both directions:

| rule | candidates for category `mission` |
|---|---|
| old | `6e25f754` only — the redesign was **invisible** to the decision |
| new | `6e25f754` (own 42) **and** `6934528b` (own **0**, clade 0.4524 over **42** inherited observations) |

Mission `a4696805` then ran through the new selection end to end and delivered, reusing the proven incumbent — the tie-break holding in the live system, not just in a fixture.

**Outcome:** R28 satisfied (AC-0/1/2), phases P28 and P28b completed. **Known limitation, stated rather than hidden:** the evidence bar can now be cleared entirely by ancestry, so a redesign's *first* run is taken on inherited credit. That is what makes a redesign usable at all, and the tie-break confines it to categories where the incumbent is retired or absent. If it proves too loose, the derived fix is a floor on own observations *after* a design has been bid once — not a decay constant.
