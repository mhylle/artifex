# 029 — P13: the end-to-end dogfood — Artifex works

**Date:** 2026-07-30
**Category:** code-change
**Phase:** P13 (Tasktracker `8b133a67-…`) · **Requirement:** R9

**What:** The whole system, one mission, real everything — intake → Redis queue → mission loop on real local models → real Postgres ledger → cockpit task tree. **20/20 checks passed.**

**Prerequisite settled first.** Defect `8b7e9e95` (models running away on nested schemas) directly threatened this phase, so `createStepwisePlanner` shipped before the dogfood was attempted: it asks for the subtask *count*, then for **one subtask at a time** against a flat schema. That removes the cliff rather than raising the guard rail — the array-of-nested-objects shape is what lets a small model keep an open array alive while reasoning out loud inside the JSON channel. It costs N round trips instead of one, which is worth it against a planner that fails stochastically and takes the mission with it.

**The run:**
```
1. INTAKE    task zero validated · mission on the Redis queue
2. RUNTIME   a BullMQ Worker consumed it and ran the full loop -> DELIVERED
             "An electric vehicle (EV) is a car or truck that runs on electricity
              rather than gasoline..."
3. LEDGER    12 events from Postgres, seq strictly ascending, human intake first,
             Gate A provably before any execution
4. MODELS    leaf -> qwen3.5:2b (smallest admitted) · high-blast irreversible root
             -> tier 3 (UPGRADE) · proven clade 2->1 (DOWNGRADE)
5. COCKPIT   tree built from those very events, mission [delivered], both tasks
             showing a derived status
```

This is the first time the smallest-model-first policy and **both tier directions** were demonstrated inside the same run as a genuine delivered mission.

## The honest caveat — logged as defect `626f6596`

**Run 1 of the identical code surrendered, at 18/20.** A leaf's model call threw three times; the ladder climbed one rung per failure and the mission gave up.

Every mechanism behaved exactly as designed there: the failure was **caught rather than crashing**, the ladder climbed **one rung per failure**, the trail stayed **complete and ordered**, surrender **carried its blockers**, and the cockpit **rendered the surrendered mission honestly**. The system degraded correctly — that run is evidence *for* the design, not against it.

But it means mission success currently rests on a stochastic per-call success rate. With `n` leaves each needing a model call to survive, end-to-end reliability is roughly that rate to the power of `n` — so **failure probability grows with fan-out**, which is precisely the direction Artifex is built to scale in. This is distinct from `8b7e9e95`: the planner never failed in either run, and run 1's failures were on the *flat* `{answer: string}` schema. **Flattening was necessary but not sufficient.**

Three directions recorded, none chosen: retry the model call before spending an escalation rung; distinguish transient from substantive failures in the ladder (a timeout is not a wrong answer); or measure per-call success rate per model/schema pair and let the Tier Policy engine treat reliability as an input — which is where defect `d678cd8c` also points.

**Milestone:** all 14 implementation phases (P0–P13, including P2.5/P3.5/P8.5/P8.6) are complete. 246 unit tests + 29 integration, green across six workspaces.
