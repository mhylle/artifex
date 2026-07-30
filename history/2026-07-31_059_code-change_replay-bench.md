# 2026-07-31 · 059 · code-change · The replay bench — a store that has to resist its own owner

**What:** Built R25, all three criteria. The fourth memory-fabric store, and the first one whose threat model is an *internal* component rather than bad data.

**Why the split exists.** A benchmark scores candidate improvements against known ground truth at fixed cost, and that only works while the benchmark is honest. The component most motivated to make it dishonest is the one being scored: *nothing that optimizes against a benchmark may also own it.* So the bench has two slices — **open**, which the Learning Agent may optimise against freely because that is what it is for, and **sealed**, which evaluates amendment petitions and calibrates the Reviewer.

**AC-1 is a structural claim, and that changed the implementation.** The obvious approach — a repository method checking a caller-supplied role — is a convention an optimiser can simply decline to honour, which is exactly what the criterion rules out. The seal is therefore a database **VIEW**: a reader constructed for the Learning Agent is bound to `benchmark_case_open` and has no way to name the table. There is no predicate to forget and no flag to omit. Reading a sealed case is a **missing grant**, not a forgotten check.

A distractor asserts the *binding* rather than only the behaviour, because a behaviour-only test would pass just as well against the role check — and the role check is the thing being ruled out.

**Two refusals are loud on purpose.** An explicit request for the sealed slice throws rather than returning empty, because an empty result reads as "the sealed bench is empty" — a different and false claim. And a sealed case fetched by id throws rather than reporting not-found, because otherwise an optimiser could probe the seal by elimination. The not-found path asks the table only for a **count**, never contents, so that distinction cannot itself become a back door.

**AC-2 derives staleness from data the system already has** — the capabilities missions are actually exercising — rather than an invented TTL. An **empty** active set retires nothing: "no capabilities are active" almost always means the caller could not determine the mission mix, and acting on it would empty the bench precisely when the signal is missing. Retirement is a tombstone with a stated reason, never a delete; a silent removal is indistinguishable from someone quietly dropping a case they kept failing.

**Proven on the real database, not a test container.** Migration 0007 applied, one open and one sealed case planted, and `benchmark_case_open` returns only the open case's answer with **zero** sealed rows visible. Both constraints genuinely reject bad inserts — `benchmark_case_slice_known` on an unknown slice, `benchmark_case_evidence_present` on empty evidence.

**Verification.** 18 integration tests, 6 mutants killed, 103 integration + 438 worker + 66 green, full workspace build. R25 has no UI surface, so it is verified at the database — the same standing exception as R23 and R24.

**Not claimed.** R25 supplies the *shape* of R35 AC-1's missing probe producer — a sealed case with a known verdict is exactly a planted known-answer — but nothing wires the bench into the calibration seam yet. `2eeef21f` stays open.

**Outcome:** R25 satisfied.
