# 2026-07-31 · 070 · code-change · The fast loop wired — R26 satisfied, and it really reverted

**What:** the mission loop now fires the fast loop, the composition root constructs its store, and a live mission applied a worker-layer hot-fix and auto-reverted it. R26 satisfied (AC-0/1/2), P26 completed, defect `188c6892` — logged against my own work one iteration earlier — resolved.

**The producer, which was the whole gap.** `fast-loop.ts`, `checkFastLoopReach` and migration 0008 were built and mutation-proven last iteration and called by nothing. Three things closed that: the loop collects one `GateBOutcome` per criterion after every verdict and calls `detectHotSpot` with the contract's own `stallLimit`; `buildWorkerSeams` constructs the seam; and `WorkerDependencies.hotFixes` is **required**, so the deployed binary cannot run without it. That last point is the `commons` pattern, which exists because the Asset Registry shipped as a null-bidding stub for the project's entire life with every suite green.

**Placed on both terminal paths, deliberately.** `await runFastLoop(true)` sits immediately after `runSubtree` returns and *before* the surrender path returns — the surrender branch exits one line later, so a mechanism attached only to the delivered path would have missed half the missions. That is exactly the shape R37's pedigree had. Awaited rather than fire-and-forget, so a mission can never end with an experiment still patched into the registry; nobody is coming to tidy up.

**Ordering chosen for what a crash leaves behind.** `apply` writes the log then patches the asset: if the asset write fails, the log holds an experiment that was never applied and the window closes flat, which reverts — harmless. The reverse would patch the registry with nothing recording what it replaced. `resolve` restores the asset *then* records the verdict, for the mirror reason: a crash between them leaves the asset correct and the log open, where the other order would leave a log claiming "reverted" over an asset still carrying the patch.

**Not routed through the ratchet, and that is the point.** `setRoleInstructions` bypasses `proposeDelta`. The ratchet governs **permanence**; a hot-fix is explicitly impermanent — it reverts by default, within one mission, and the row holds what it replaced. Making the fast loop earn permanence would make it the slow loop, which is R23 and already exists. `version` is untouched for the same reason: an experiment that may be gone in four tasks has not earned one.

**Live, mission `90f2387f`.** Shaping the trigger took four attempts, and each failure was informative: a SHA-256 criterion passed because the judge cannot verify hashes either; a bibliography criterion failed Gate B once and then **bounced** at the contract ritual on retry (the worker found "peer-reviewed source with DOI" ambiguous); a three-term version was rejected twice by Gate A's split. What worked was an atomic mission with one criterion the model reliably fails and one it passes. Then:

- two Gate B failures on `m-1` in category `mission` → fired at `stallLimit` 2
- `fast_loop.hot_fix_applied` — worker-layer `role_instructions` on design `6e25f754`, `bounds {windowObservations: 2}`, `predictedEffect {basis: peer_criteria, baselineFailureRate: 1}`. The peer basis is real: `m-2` passed, so the prediction was anchored to measured evidence rather than a chosen number.
- the patched attempt bounced before reaching Gate B, so the window closed with **no observations** → on mission end, `fast_loop.hot_fix_resolved`, `outcome: reverted`
- the real `hot_fix` row: `reverted, baseline 1.000, observed null`. The real `agent_design` row: **88 chars, patch text gone** — the revert restored the asset, not merely the log.

**Honest split on AC-1.** Live took the no-observations default. The criterion's literal given — "whose *measured* failure rate does not move" — is proven by the loop test driving the real `runMission` composition to a filled window with an unchanged rate, with the reason string **pinned** so the test cannot silently drift onto the weaker clause. Same code path; the two clauses got their evidence from different runs, and saying so is cheaper than pretending one run covered both.

**A mojibake that was not a defect.** The resolve reason came back through curl as `â€"`, which looked like the ledger mangling non-ASCII. Querying the ledger directly showed a correct em-dash — the corruption was in my terminal pipeline. No defect logged, because there was none.

**Verification.** 14 new worker tests + 7 new integration tests. 552 worker + 135 memory-fabric integration + 156 + 66 + 50 + 26 green, full workspace build, real processes restarted, four live missions. One repository mutant survived and was killed by a new test: hard-coding `outcome = 'kept'` passed all 134 integration tests, because the only test reading the column resolved with `revert: false` — and "the revert is recorded" is half of AC-1's sentence.

**Outcome:** R26 satisfied. The fast loop is the fourth blocking phase closed; P19's dependency on it is discharged.
