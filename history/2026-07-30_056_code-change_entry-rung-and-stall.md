# 2026-07-30 · 056 · code-change · The error class finally picks a rung, and the stall counter stops the rehearsal

**What:** Built R36. Two declared inputs existed and neither was read where it mattered — the exact shape ORIENT was told to look for, found twice in a row now.

**`errorClass`** was set on every verdict finding, counted by the learning projection, and written into the `escalation.rung_climbed` payload. The ladder did `rungIndex += 1` unconditionally, so a task that was *specified* wrong climbed from rung 1 exactly like an ordinary slip and rehearsed — at a higher price each time — the mistake it had just been told about. `ErrorClassSchema`'s own doc comment says the class "selects the escalation rung". The comment was the requirement; the code was the defect.

**`stallLimit`** was copied parent-to-child in `orchestrator.ts` and read **nowhere**. There was no stall counter of any kind.

**Two rules that sound contradictory and are not.** The **entry** rung is a function of the error class (AC-0/AC-1); every failure *after* that climbs exactly one rung (the loop's existing invariant). They constrain different moments, and `Math.max` reconciles them — a task jumps to where its failure belongs, walks from there, and never walks **back** to a cheaper remedy it has already been told will not work. Without the max, a task that failed at re-decomposition and then failed as an ordinary slip would drop to rung 1 and cycle between them forever.

**Three decisions now live in `escalation.ts`**, each testable on its own:

- `entryRungFor` — class to rung, chosen from **this contract's** ladder. A mapped rung the ladder lacks falls back to rung 1, not to the top: a contract that granted only cheap remedies did not quietly grant the expensive ones.
- `worstClass` — a verdict naming both a specification fault and a slip enters at the **spec fault's** rung, so the order a judge happened to list findings in cannot decide the remedy.
- `isStalled` — same tier, same design, same failure classes, counting only the **most recent** run. A tier bump or a different failure is progress, and treating either as a stall would trip on exactly the mechanisms meant to break stalls.

**A find worth naming:** the bounce path had already implemented this rule **inline**, comment citing R36 and the false-bounce measurements, while every other escalation site ignored the class entirely. One site knew the requirement and the rest did not. It is now on the shared function.

**Five surviving mutants — the worst round yet, and every one a real weakness of my tests:**

1. A fallback test asserting only "index in range", which a fallback to the **top** rung also satisfies — silently sending every unmappable failure to the most expensive remedy.
2. A stall test whose history *ended* at the differing attempt, where "count anywhere" and "count the trailing run" happen to agree.
3. A limit test masked by the length guard, so a hardcoded `2` never showed.
4. A worst-class test with only one class present, where first and worst are the same thing.
5. A loop assertion of "not `retry_same`", which the plain one-rung step also satisfies — too weak to see the override at all.

All five rewritten to bite. Naming the rung, not merely excluding one, is what turned the last from a reassurance into a test.

**Verified live on mission `9123074b`:** `entryClass: execution_error` on every escalation, the ladder climbing monotonically (`retry_higher_tier` → `different_agent` → `agent_redesign`), and **`task.stalled` after 3 attempts** — the tier caps at the frontier, so attempts 2 and 3 became genuinely identical and the counter caught it. The criterion's "given" reached on real data rather than in a fixture.

**A concern checked rather than carried.** Two earlier missions surrendered at Gate A without reaching the ladder, which looked like R33 over-rejecting. The ledger says Gate A passes **34 of 40** real verdicts. Those two were simply hard objectives ("prove the Riemann hypothesis", "pick the best one"), and there is no systemic problem to log.

**Verification.** 25 tests, 8 mutants killed, 400 worker + 66 green, full workspace build, live confirmation.

**Outcome:** R36 satisfied.
