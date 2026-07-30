# 2026-07-31 · 063 · code-change · The swarm runs its first experiment — R27 complete

**What:** Built `BenchCandidateRunner` and `buildScienceLoop`, the last pieces of R27. **All four criteria satisfied**, and R25's sealed slice finally has a consumer.

**Judged, not diffed — the decision worth recording.** A bench case carries its full contract, inputs and the outcome a *verified* run produced, so the tempting implementation is to compare the candidate's answer against the recorded one. That would be wrong: the recorded outcome is **one** verified answer, not the only correct one. A candidate answering "100 degrees Celsius" where the case recorded "100C" has not regressed, and a string comparison would call that a loss and **reject a real improvement**. The criteria are what the original verdict was made against, so they are what a re-run is measured against too.

**Everything that is not a demonstrated pass is a loss.** A crashed executor, an unavailable judge, a case that would not load, an empty exam. Treating any of them as "no evidence" would let a broken candidate through on the cases it happened to survive — and zero cases would vacuously satisfy "every case passed", which is the same trap `experimentPlan` already guards one layer up.

**All cases must pass, not a majority.** A candidate that fixes one case and breaks another has not improved the system; a majority rule would adopt changes that trade one failure for a different one.

**Proven live against the real database and the real bench** (1 open case, 1 sealed, planted during R25's own verification):

- a candidate that improves → **adopted**: 2 wins, 0 losses, held-out won, *"replicated across 2 runs and held on a slice it was not tuned against"*;
- a candidate that regresses → **refused**: 0 wins, 2 losses, held-out failed — with its evidence recorded either way, which is the half AC-3 exists for.

**A composition file, written because six mechanisms have now landed unreachable.** `science-seams.ts` is pure adapter — decisions in `science-loop.ts`, orchestration in `science-runner.ts`, wiring here — with four tests asserting the composition itself. One of them checks the executor receives the case's actual **contract**, because a store returning empty contracts would still "run" every case and report a clean win.

The case store loads through `list` rather than per-id `findById`: the Learning Agent's reader *refuses* a sealed id by design (R25 AC-1), so asking per-id would turn the seal into an exception storm. `list` returns what the caller may see — the same rule expressed as data instead of as errors.

**Not claimed.** Adoption returns a **verdict**, it does not enact one — the Learning Agent proposes and the constitutional path disposes (invariant #4). So `parent_design_id` is still unset: wiring adoption to the registry ratchet is an act that changes the swarm, not a measurement, and `cb939996` with R28 AC-0 stay open.

**Verification.** 14 new tests, 6 mutants killed, 489 worker + 66 green, full workspace build, live experiment against the real bench.

**Outcome:** R27 satisfied; `66356a6e` resolved; R25's sealed slice consumed for the first time.
