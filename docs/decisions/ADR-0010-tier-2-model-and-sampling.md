# ADR-0010 — Keep gemma4:12b for tier 2, and treat sampling as the mitigation

**Status:** Accepted · **Date:** 2026-07-30 · **Decision made autonomously under a standing delegation; evidence below.**

## Context

An earlier probe measured `qwen3.5:9b` as better than `gemma4:12b` at gate-style judgement — **17% false-bounce and 100% catch, against 58% and 100%** — and the question of switching tier 2 was delegated pending measurement of the *other* tier-2 consumers.

Since then, four independent tier-2 consumers have been built or exercised, and every one of them showed the **same** failure mode on the live stack:

| Consumer | Observed failure | Evidence |
|---|---|---|
| Clarity judge (bounce or restate) | 58% false-bounce; one bounce read *"There are none found; this task is clear and executable"* — the structured field contradicting its own rationale | live mission `f720938a` |
| Decompose-or-delegate gate | Answered `keep_whole` while its rationale said *"five independent descriptions… no shared reasoning"*; the mission surrendered without executing | defect `890cdea5` |
| Gate A plan audit (R33) | Rejected an ordinary two-way split as non-atomic on two consecutive attempts, and rejected the requester's own intake wording as untestable | live mission `d55b7f62` |
| Gate B intent tier (R34) | Returned the **prompt's own example phrases verbatim** as red flags on both attempts — pattern completion, not inspection | live mission `e7dddf91` |

The pattern is consistent: the model **over-asserts**, producing a confident structured answer that its own free-text rationale does not support. It is not that it fails to notice problems — catch rate was 100% where measured — it is that it also asserts problems that are not there.

## Decision

**Keep `gemma4:12b` as the tier-2 evaluative model. Do not add `qwen3.5:9b` to the Model Catalog at this time.** Treat **sampling with unanimity in the safe direction** as the structural mitigation, applied at every tier-2 judgement whose false-positive cost is asymmetric.

## Why not switch

1. **The mitigation already exists and is proven, four times over.** Sampling-for-unanimity was introduced for the admission gate (`d678cd8c`), then the decompose-or-delegate gate (`890cdea5`), then R33's plan audit, then R34's intent tier. In each case the live behaviour was corrected without changing models. A model swap would not have removed the need for it — an over-asserting judge at 17% still over-asserts, just less often, and the same asymmetry would still make a single unchecked sample unsafe.
2. **The measured advantage is on ONE consumer.** The 17%-vs-58% figure is a clarity-judge measurement. Generalising it to the plan audit, the intent tier and the completion judge would be exactly the inference this project keeps being punished for — a green fixture standing in for a satisfied criterion.
3. **Adding a model is not free.** A catalogue entry must clear the admission gate (ADR-0008) on its own evidence, and tier-2 is used by five seams whose prompts are tuned against the current model's behaviour. That is a measurement campaign, not a config change.
4. **Reversible either way.** Tier is resolved per seam through `packages/model-router`, so switching later is a catalogue edit plus an admission run — nothing in the worker hard-codes a model.

## What sampling costs, and why it is affordable

Three samples per judgement at the gates, not at the doing. Gate A runs once per decomposition and Gate B once per attempt, so the multiplier lands on a small fraction of total calls. Artifex has **no performance requirement** — that is explicitly out of scope until the functional design is settled — while a false rejection surrenders a mission that would have succeeded. The trade is heavily one-sided.

## The rule this establishes

> When a tier-2 judgement has an asymmetric cost of being wrong, sample it and require unanimity **in the direction that preserves work**. A false pass is caught by a later gate; a false rejection destroys work that no later gate will ever see.

Applied consistently: unanimity to *admit* (admission gate), to *collapse a task graph* (decompose gate), to *reject a plan* (Gate A), to *condemn or flag a deliverable* (Gate B intent tier).

## What would change this decision

- A measurement of `qwen3.5:9b` across **all five** tier-2 consumers on real missions, with **rate of unusable output** as an axis alongside false-positive and catch rates — the axis that matters when a model returns a schema-valid answer that is nonsense.
- Evidence that sampling fails to converge somewhere: a judgement where three samples disagree so often that unanimity is unreachable and the gate silently stops gating. Nothing observed so far behaves that way, but it is the failure mode to watch for.

## Honest limits of this ADR

The comparative measurement the delegation asked for was **not** run across all consumers. This decision rests on four qualitative live observations plus one quantitative probe, not on a controlled comparison. It is recorded as "no change, with the mitigation named" rather than as a demonstration that `gemma4:12b` is the better model — those are different claims, and only the first is supported.
