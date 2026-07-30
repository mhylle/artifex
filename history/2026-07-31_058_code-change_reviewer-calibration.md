# 2026-07-31 · 058 · code-change · The reviewer starts being measured, and disagrees with itself on the first try

**What:** Built R35's calibration half. Every gate in Artifex is a model asked a question, and the constitution says the learner does not own the yardstick — but nothing had ever checked the *yardstick itself*. A verdict was issued once and never compared against a second opinion.

**Three mechanisms that fail differently, which is the point:**

- **Calibration** re-reviews a sample and records **disagreement**. Catches a reviewer inconsistent with itself.
- **Probes** inject work whose answer is known and record a **miss**. Catches what calibration structurally cannot — a reviewer consistently wrong in the same direction agrees with itself perfectly.
- **Independence** refuses a verifier that is, or shares lineage with, the producer.

That middle one is why defect `627cd71c` matters: ADR-0010's unanimity sampling catches an *unreliable* judge, and is silent when every sample is wrong the same way. Only a known answer catches that.

**Two rules in `calibrationOf` exist because the comfortable answer is wrong.** A verdict with no re-review is **not** counted as agreement — silence is not agreement, the same rule Gate A applies to an unassessed criterion, and counting it would make a never-sampled reviewer look perfect. And a re-review from the **original** reviewer is refused outright: a reviewer agreeing with itself reports a flawless rate precisely when it is most consistently wrong.

**Probes are scored in both directions.** Rubber-stamping is the failure the criterion names, but reflexive rejection is the other — and it is the one the tier-2 judges have actually shown (58% false-bounce, an ordinary split called non-atomic, prompt examples returned as red flags). A calibration measuring only leniency would have missed all of it.

**The re-reviewer judges the WORK, not the verdict.** A first version of `IssuedVerdict` carried only ids, which meant the only thing a second opinion could be formed from was the first opinion — agreement would then have measured obedience. It now carries the objective and the deliverable, filled from the trail.

**Live on mission `5af8ae4f`, and it earned its keep immediately:** `reviewer.calibrated` recorded on a *surrendered* mission — 1 compared, 1 disagreement, agreement rate 0 — naming the task where the original reviewer said `fail` and the independent re-review said `pass`. First real measurement, first real disagreement, consistent with the over-rejection pattern ADR-0010 documents.

**Twelve mutants, all killed — two after strengthening.** One mutant was unreachable in my fixtures because the loop walks re-reviews while every test passed *more* verdicts than re-reviews; the reachable shape is the opposite one, a re-review nobody issued a verdict for. Another exposed that a mission with **no** Gate B verdicts would record an empty measurement reading as "the reviewer was checked and found faultless" — the same 0/0-is-not-100% trap, one layer up.

**Two criteria left unsatisfied, both logged rather than claimed:**

- **AC-1** (`2eeef21f`) — the probe mechanism is built and tested, and nothing ever *plants* a probe: `probesPlanted: 0` on every live mission. A probe the reviewer can distinguish from real work measures nothing, and designing an indistinguishable one deserves its own pass rather than being tacked onto the end of this one.
- **AC-2** (`bc191e55`) — verifiers are not staffed entities. `reviewerId` is the *mission* id; verification runs on shared seams, not a staffed agent with a design. There is no staffing attempt to refuse. The decision function is written anyway, with a `KNOWN LIMITATION` test asserting that without recorded ancestry (`cb939996`) only the identity half can fire.

**Verification.** 19 calibration tests + a composition assertion, 12 mutants killed, 437 worker + 66 green, full workspace build, live confirmation.

**Outcome:** R35 AC-0 satisfied; AC-1 and AC-2 carried with their blockers named.
