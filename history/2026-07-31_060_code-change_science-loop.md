# 2026-07-31 · 060 · code-change · The science loop's decisions — built, proven, and honestly not yet running

**What:** Built R27's four decisions as a pure module: `rankWeakSpots`, `experimentPlan`, `adoptionDecision`. **No criterion is claimed**, because nothing calls them.

**One idea applied four times: evidence, not enthusiasm.**

- **Mining** ranks per *category* across missions, never per mission — a single failure is noise, and ranking per mission would promote whichever one went worst most recently. Surrender outranks a poor pass rate, because stopping is worse than struggling. A healthy history ranks **nothing**: "always find something to fix" sends the loop chasing noise forever.
- **Experimentation** gives every candidate the same budget *and the same cases*. A different bench is a different exam; a different budget is the same exam under different conditions. Both produce numbers that look comparable and are not, so the planner **refuses** rather than approximating — an uneven split still yields a score, and a score nobody can trust is worse than none because nobody notices.
- **Adoption** needs two independent bars: it must replicate (one win is a coin landing well) and it must hold on a slice it was never tuned against (winning only where you tuned is the definition of overfitting). Absent is not a pass — a candidate with no held-out run has sat one exam.
- **The discarded result is kept.** A rejected candidate is a measurement; throwing it away means the next hypothesis re-runs the same experiment. Knowing something failed the *held-out* slice is the most useful thing about it — that says the idea does not transfer, which is a different finding from it being weak.

**Thresholds reused rather than invented.** `NEAR_CEILING` is 90%, the same figure R37's surrender dossier uses to decide budget was the constraint. Keeping them identical matters more than either being optimal: two definitions of "expensive" would make the learning loop and the dossier disagree about the same mission.

**Two test weaknesses my own mutants exposed.** One fixture drove a *healthy* category and expected it ranked — the wrong input, since ranking nothing is correct there. The other claimed surrender was "the strongest signal" while giving the surrendering category a 0/1 pass rate too, so it won on **compliance** and a mutant that all but deleted the surrender weight survived. A fixture has to isolate the one signal it claims to test.

**What is NOT claimed, and why.** Grepping the repo for these three functions outside their own module returns nothing. R27's criteria are all phrased around the loop *running* — "when the science loop mines the ledger", "when they are experimented on the open bench" — and none of those givens is reachable. Logged as `66356a6e` with both halves sized: mining is a modest cross-mission projection away; experimentation needs a real runner that replays R25's open bench at fixed budget and re-checks the winner against the sealed slice, which is also what would finally give the sealed bench a consumer.

The decisions were built first deliberately — what counts as a weak spot, what makes experiments comparable, what earns adoption are the parts worth getting right, and writing them under the pressure of also building a runner is how thresholds get chosen to make a test pass. That is a reason, not an excuse: this is the **fourth** time a mechanism has landed ahead of its producer, and the pattern is logged rather than glossed.

**Verification.** 20 tests, 10 mutants killed, 458 worker + 66 green, full workspace build.

**Outcome:** R27's decision module complete; no AC claimed; `66356a6e` logged. `cb939996` and R28 AC-0 stay blocked, since adoption-by-ratchet is where `parent_design_id` would be set.
