# 088 — The replay bench gets a live producer

**Date:** 2026-07-31
**Category:** code-change

**What:** Verified tasks now become replay bench cases as missions finish (defect `c1b3ae71`, R25 AC-0). The open/sealed split is a recorded choice, not a pretend derivation (ADR-0016). Live: a real mission banked two cases in a capability the bench had never covered.

**Why:** `bench.record` had no production caller anywhere — every non-test reference across the worker and the API was enumerated. R25 AC-0's "when a benchmark set is built" had never happened in the running system. The bench held two script-written rows, one of them a dogfood stub whose whole contract is `{"o": "sealed case"}`. Everything downstream starved: the Reviewer's calibration probes (R35), the science loop's cases (R27), and the sealed-bench evaluation R29 AC-0 requires.

The iteration was aimed at wiring that evaluation. Wiring an evaluator over a bench with no producer would have been a mechanism with no fuel — the exact shape this project keeps logging — so the producer came first.

**Details:**

`casesFromTrail` mints a case from every task whose Gate B passed, carrying what R25 names — contract, inputs, verified outcome — plus the verdict event as the evidence the store demands. A failed task is never banked: its deliverable is a wrong answer, and scoring candidates against it would produce a number that looks like a measurement. Cases key on the resolved capability rather than the planner's raw category, for the same reason the weak-spot ranking does.

The slice is the interesting part, because **nothing the system records can determine what fraction to reserve.** The standing rule is to derive constants from data; here there is no data to derive from, so ADR-0016 makes the choice openly instead of picking a number and writing a paragraph about why it is principled. The slice alternates per capability, starting sealed: deterministic and replayable, no tuning, and it guarantees the sealed slice covers every capability the swarm actually works in — which is exactly what a petition about a capability needs. Sealing the first case only was rejected because one case makes `evaluateOnSealedBench`'s unanimity requirement meaningless; a fixed fraction was rejected as invented.

8 tests, 8 mutants killed. One deserves recording: the mutant making the counter **global** instead of per-capability initially **survived**. The fixture used `answering: 1`, and at that count the two rules happen to produce the same two slices — the case under test was winning for a different reason than the one asserted. Rebuilt with counts where they disagree (`answering: 2`, `summarising: 0`: per-capability seals both, a global counter gives sealed then open), and the mutant now dies. Caught by mutation, not by reading.

**Outcome:**

710 worker + 160 + 66 + 50 + 26 green; all six workspaces build; rebuilt **and restarted** before measuring.

    bench before:  open/answering 1   sealed/answering 2
    worker log:    banked 2 bench case(s): sealed, open
    bench after:   open/answering 1   sealed/answering 2
                   open/hand tools overview 1   sealed/hand tools overview 1

A capability the bench had never covered now has both slices, produced by the deployable worker from a mission submitted through the real API.

**What this does not do, stated rather than rounded up.** R29 AC-0 is still unsatisfied. Its second clause requires the petition to be *evaluated* against the sealed bench, and `evaluateOnSealedBench` still has no production caller. The bench now has fuel; the evaluation is the next piece, and it is the last named gap on that criterion.

The dogfood stub row is left in place as instructed. It is visible in the sealed slice and is a known-bad case, not a secret — anything scoring against it will score against `{"answer": "secret"}`.
