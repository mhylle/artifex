# 2026-07-31 · 061 · code-change · The science loop runs — and R11's projection turns out to be unwired too

**What:** Built `ScienceLoop`, the orchestrator that actually *runs* R27's four decisions. Half of `66356a6e` closed; the other half is now described precisely rather than vaguely.

**Why this file exists at all.** `science-loop.ts` was correct, tested and mutation-checked, and nothing called it — the fourth time in this project a mechanism landed ahead of its producer. The orchestrator is deliberately thin and entirely seam-driven (`EvidenceSource`, `BenchSource`, `CandidateRunner`) so the decisions stay pure and the wiring stays testable.

**Three behaviours the mutants earned:**

- **A runner that throws counts as a LOSS.** An experiment that crashed did not succeed, and swallowing the error into a pass would adopt a candidate that cannot even run.
- **The sealed re-check genuinely uses the sealed cases.** A mutant that passed the *open* cases to the sealed run survived nothing — three tests caught it. Re-running the same exam and calling it held-out would defeat the entire point of R25's split.
- **Replications actually replicate.** A mutant fixing the loop at one iteration failed four tests.

**No sealed case means `heldOut: null`, not a failure.** "We could not check" is a different finding from "it did not transfer" — `adoptionDecision` refuses both, but the evidence records which one happened, and that distinction is what tells a future hypothesis whether to re-run the experiment or abandon the idea.

**A find while wiring:** grepping for `LearningProjection` outside its own module returns **nothing**. R11's read-only projection is *also* unwired — the fifth occurrence of the no-producer shape. That matters here because it means the mining half has no upstream at all, not merely no caller.

**Stopped deliberately, not run out of.** A live `EvidenceSource` needs cross-mission history, and the worker's `ControlReader.replay` is per-mission. The natural source exists — R37's `mission.delivered` pedigree carries budget accounting and `mission.surrendered` carries blockers and escalations — but reading them across missions needs a ledger query that does not exist, plus a decision about what "recent history" means. That window should be derived from mission volume rather than guessed at the end of a long session; guessing it is exactly how a threshold gets picked to make a test pass.

**No R27 criterion is claimed.** The orchestrator is real and proven; the composition is not. `66356a6e` is updated with both remaining pieces sized.

**Verification.** 9 tests, 5 mutants killed, 467 worker + 66 green, full workspace build.

**Outcome:** R27's runner complete; evidence source and candidate runner still absent; `66356a6e` sharpened and R11's unwired projection recorded within it.
