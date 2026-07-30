# 025 — P9: the mission loop — Artifex runs end to end

**Date:** 2026-07-30
**Category:** code-change
**Phase:** P9 (Tasktracker `9d86094c-…`) · **Requirement:** R9

**What:** Assembled P4–P8.6 into `runMission` — decompose → Gate A → staff → execute → Gate B → fold-up, with the escalation ladder and first-class surrender. **This is the first run where Artifex is a system rather than a set of parts.**

**Details — three properties no single component could guarantee:**
1. **Gate A runs before anything executes.** "Verify both ends" means the *plan* is audited before budget is spent on it, so a decomposition that fails to cover its own criteria never reaches a worker.
2. **One failure climbs exactly one rung.** The ladder is ordered cheapest-first: jumping it wastes the cheap remedies, skipping it rehearses the same failure forever. Only `retry_higher_tier` moves the tier — the other rungs change *who or what* runs, not how much model is thrown at it.
3. **Surrender is first-class**, carrying blockers. A mission that cannot succeed produces a dossier, not a crash and not a fabricated success.

**Hardened mid-phase, because the live run demanded it:** a seam that *throws* is now a failure that climbs the ladder (or surrenders with the error as a blocker), never an exception that kills the mission and loses its whole ledger trail.

**Outcome:** TDD red→green. 116 worker tests, **208 repo-wide**, 29 integration, build + typecheck clean. Mutation-verified: making a failure jump two rungs failed exactly the four escalation tests.

## The happy path, live, with real local models

```
mission.started -> task.contracted x2 -> gate_a.verdict_issued -> agent.staffed ->
task.executed -> gate_b.verdict_issued -> agent.staffed -> task.executed ->
gate_b.verdict_issued -> mission.folded          delivered, 78s
```

11 events replayed from real Postgres with strictly ascending `seq`; Gate A provably before any execution; zero rungs climbed.

## Two real bugs the live run found — both mine, not the loop's

1. **The worker was never shown its acceptance criteria.** My harness prompted with `contract.objective` alone, so the planner wrote criteria (`EV_Types_List`) the worker never aimed at, and Gate B correctly failed the work three times and surrendered. I diagnosed it properly rather than guessing — checked the judge in isolation (it assessed correctly), checked criterion-id round-tripping (clean) — before finding the real cause. **The loop was right; the harness was wrong.** That is invariant #2's whole point: the contract *is* the spec.
2. **The planner ran at tier 1.** ADR-0002 puts *root decomposition* at the top of the ladder, because a bad split is inherited by every descendant. Moving it to the evaluative tier took the mission from *surrendered* to *delivered*.

## Carried forward

**HIGH defect `8b7e9e95`** — local models run away under constrained decoding on complex nested schemas, emitting chain-of-thought *inside the JSON channel* until the context limit (32,690 tokens on a 78-token prompt). Established by experiment: simple schemas are fine on both models; **`/no_think` makes it worse, not better**; and it is stochastic. Mitigated — `DEFAULT_MAX_OUTPUT_TOKENS` converts an expensive crash into a fast attributable failure, and the loop now survives it — but **not fixed**. It interacts directly with the smallest-model goal: the real constraint is *schema complexity per tier*, which `taskClass` does not express. Must be settled before P13.
