# 018 — P4: Tier Policy engine (floor-first) & Constitution guards

**Date:** 2026-07-30
**Category:** code-change
**Phase:** P4 (Tasktracker `b2cdf558-…`) · **Requirement:** R4

**What:** Built the Tier Policy engine and the Constitution's review-independence guards in `packages/worker`, and made every tier decision a ledger event carrying the inputs that produced it.

**Why:** R4, and the standing goal — run on the smallest models possible with working upgrade *and* downgrade.

**Details:**
- **The engine is written floor-first and biased downward.** It establishes the cheapest tier the task's risk permits, then climbs only when something justifies the spend. The opposite arrangement — start high, discount later — is how a swarm ends up unable to afford to fan out at all (invariant #7).
- **The floor is constitutional.** Blast radius sets the base; irreversibility and fan-in each raise it, because both remove the cheap remedy — you cannot re-run a task whose mistake twelve siblings have already consumed. Nothing may breach the floor: not budget pressure, not a perfect clade score.
- **Mechanical work floors at Tier 0 regardless of blast radius.** A schema check does not get better on a bigger model, so paying for one is pure waste.
- **Two downgrade paths, both clamped.** A proven clade earns a cheaper tier; budget pressure trims into the slack above the floor. When the budget cannot afford the floor the engine **escalates to a human instead of quietly under-provisioning** — that silent downgrade is the exact failure this engine exists to prevent.
- **Review independence is two rules, and conflating them is the usual mistake.** *Agent* independence is absolute — no self-review at any blast radius, since a self-approval is not evidence of anything. *Model* independence is required above low blast radius, because a shared model means shared blind spots: the reviewer is systematically likeliest to miss exactly what the worker got wrong. At **low** blast radius model reuse is permitted — the task is reversible and cheap to re-run, the reviewing agent is still independent, and this is what lets the swarm review its bulk work on the smallest model available.
- **Tier decisions carry their inputs to the ledger.** A recorded tier without the scores that produced it cannot be audited, replayed or mined — and the point of a *computed* policy is that its reasoning is inspectable.

**Outcome:** TDD red→green. 23 worker tests, **113 repo-wide**, 20 integration, build + typecheck clean — including a new `packages/worker/tsconfig.spec.json`, which closes the last of the P0 typecheck loose ends. Mutation-verified: neutering the escalate-instead-of-under-provision branch failed exactly the one AC-1 test with 22 still passing.

**Dogfooded end to end on the compose stack** — the whole chain, not just the arithmetic: computed tier → real ledger append → real Model Catalog resolution → an actual model name.

```
tier 0  mechanical schema check       -> none (no LLM)
tier 1  ordinary low-blast leaf       -> ollama/qwen3.5:2b      <- smallest admitted
tier 2  evaluative, unproven clade    -> ollama/gemma4:12b
tier 1  evaluative, PROVEN clade      -> ollama/qwen3.5:2b      <- DOWNGRADE, on real models
tier 3  high-blast irreversible root  -> anthropic/claude-opus-5 <- UPGRADE
```

**Housekeeping:** the doneness gate surfaced that P1 and P2 each hid four never-used template sub-tasks (one still referenced TypeORM, which was never the stack). They were superseded by the hand-authored P1.x/P2.x sub-tasks that actually tracked the work, so they were **archived** rather than marked completed — closing them would have claimed work items that never described what was built.
