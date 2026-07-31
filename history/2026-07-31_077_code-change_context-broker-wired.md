# 2026-07-31 · 077 · code-change · Invariant #6 is enforced by the running system, not by its tests

**What:** the Context Broker is constructed, used, and logging. Defects `488709be` and `753bc6dd` resolved; a new one (`913ead75`) logged for what wiring them revealed.

**Two things were missing, and only one was obvious.** `ContextBroker` and `BrokeredFabric` have been complete since P3 — entitlement checked against *this* contract, grants scoped to one source, every exchange logged in both directions — with no constructor anywhere in the repo. That was the logged defect. But wiring it alone would have changed nothing: `authorContracts` gave every child `entitlements: []`, so a wired broker would have denied every request and invariant #6 would have been "enforced" by having nothing to enforce.

**The entitlement is scoped, not blanket.** Each child may request `commons:<its own capability>` — what its kind of work has learned, not everything the swarm knows. The contract stays the sole authority on what a task may *know*, exactly as it is on what a task may *do*.

**The grant id is the evidence, not the source.** `consulted` on the evidence bundle carries `viaBrokerGrantId`, a field that has existed since R40 for precisely this. A source recorded without a grant id would prove nothing about the invariant — it would be indistinguishable from a direct read.

**Live**, mission `680adb06`:

```
context.granted  {"source":"commons:Physics / Science Communication","grantId":"grant-680adb06-3"}
task.executed    consulted=[{"source":"commons:…","viaBrokerGrantId":"grant-680adb06-3"}]
```

**A new defect, logged separately rather than folded in.** Wiring the consumer revealed that the commons holds **22 quarantined entries and zero published**, because nothing in the running system calls `corroborate` or `publish`. The consumer is live and correct and always serves an empty list — the channel works, the reservoir is empty by construction. That is a *different* gap from "the consumer is blocked on the broker", so it is `913ead75` rather than a stretched `753bc6dd`; stretching a resolved defect over a newly-found one is how a defect list stops meaning anything. Deliberately **not** fixed by loosening the published filter: serving quarantined claims would hand workers the unproven material the quarantine exists to hold back.

**A parse error worth remembering.** The test file failed to compile because `packages/*/src` inside a block comment contains `*/` and closed it early. Third distinct way a comment or heredoc has corrupted source in this project.

**Verification.** 6 composition tests driving the real `runMission`, 3 more at the composition root, 6 mutants all killed — "loop never brokers", "payload never reaches the worker", "consulted drops the brokered sources", "consulted loses the grant id", "children get no commons entitlement", and "broker bypassed, read the store directly". `WorkerDependencies.knowledge` is REQUIRED, the pattern that has now caught five dead mechanisms. 627 worker + 160 + 66 + 50 + 26 green, full workspace build, live mission.

**Also visible in the live grant:** the source reads `commons:Physics / Science Communication` — the carried category-fragmentation item, now surfacing in entitlement strings as well as in weak spots, the fast loop's trigger, template keys and the workforce lens.

**Outcome:** open defects 4 → 3 (two resolved, one new). Three of four doneness pillars remain green.
