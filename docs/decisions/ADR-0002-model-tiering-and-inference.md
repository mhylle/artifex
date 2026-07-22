# ADR-0002 — Model tiering, local-model declaration & inference serving

**Status:** Accepted
**Date:** 2026-07-22
**Deciders:** Martin Hylleberg (with Claude as advisor)
**Supersedes:** the "Open" list in [ADR-0001](ADR-0001-implementation-stack.md).
**Source:** Tasktracker brainstorm "Artifex — Technical/Model Pass (on ADR-0001)" (`9885e5b0-e711-427d-8e75-13456334b9af`, frozen).

## Context

ADR-0001 locked the all-TS, multi-model stack and a provider-neutral Model Router, but deferred *how* models are chosen, which local models to run, how to serve them, and whether the Learning science loop is later a Python service. Owner hardware: a **single 24 GB consumer GPU**.

## Decisions

**1. Model tier is a computed policy, not a per-agent constant.** The Agent Creator computes a tier per staffing decision from **blast radius, fan-in, reversibility, task class, budget remaining, and category clade score**. Realised as a **4-tier ladder**:

| Tier | Model | Work |
|---|---|---|
| 0 | none (no LLM) | schema/mechanical checks, mechanical Gate B pre-checks |
| 1 | local small (Qwen2.5 7B–14B) | the bulk of atomic worker tasks — caught by voting/verification |
| 2 | local mid (~32B quantized, fits 24 GB) | Creator prompt-authoring, Gate A, mid-blast semantic review, fold-up |
| 3 | frontier (Claude) | root decomposition, high-blast semantic review, Learning reasoning, surrender |

A **tier-bump is a rung in the existing failure-escalation ladder** (fail cheap → retry higher), so tier is dynamic per-attempt. The chosen tier + its input scores are written as a **ledger event** (drillable; mineable by the Learning Agent). The owner's original "only decomposition is large" is the Tier-3 root special case, generalised.

**2. Budget-vs-blast-radius is governed by the per-mission autonomy dial.** High-autonomy missions may let low budget drop a tier (logged as a loud ledger + attention-queue event); supervised missions treat blast radius as a **hard floor** and escalate to a human rather than silently cheapen.

**3. Local models are declared by logical tier, resolved via a versioned Model Catalog (Postgres).** Manifests carry a `logicalTier`; the catalog maps tier → `{provider, model, params, contextWindow, costWeight, capabilities, quantization}`. v0 Tier-1 workhorse: **Qwen2.5-family** (best open-weight structured-output + tool-calling per param as of early 2026) — a **replaceable** entry, not a constant (principle #3). A model enters the catalog only after passing a **structured-output/tool-calling admission gate** on the real contract + evidence-bundle schemas (principles #5/#6). Successors (Qwen3 / Llama-4-class) absorbed by the catalog without code change.

**4. Serving engine is environment config behind the OpenAI-compatible router.** Three rungs: **Ollama (dev) → vLLM (staging/load) → vLLM scaled (prod)**, autoscaled on BullMQ queue depth. Migration gated by a cross-engine contract test + a fan-out load test, not code. vLLM-vs-SGLang-vs-TGI deferred to the staging rung (default vLLM).

**5. The Learning science loop is built in TypeScript now, behind a data seam.** Two interfaces — a read-only **ledger projection (`LearningStore`)** and a typed **proposal-emitter**. Extract to an offline **Python** service only if it later needs real statistical/ML tooling or independent batch scaling; trigger left **informal** ("revisit when it hurts"). The physical boundary also enforces the constitutional rule "no judge inside the learner's write scope." The Learning Agent's LLM tier is Tier-3 regardless of harness language.

## Consequences

- New buildable components: the **tier policy function**, the **Model Catalog** + admission-gate harness, per-tier vLLM serving, and the `LearningStore`/proposal-emitter seam.
- **Known constraint (not solved here):** a single 24 GB GPU cannot serve concurrent Tier-1 at real mission fan-out — production throughput needs cloud/multi-GPU vLLM. Tracked in the brainstorm parking lot; size at the staging rung.
- **Parking lot:** prod concurrency/hardware sizing; per-tier cost-weight calibration; whether Model Catalog A/B shares the agent-eval replay harness; confirming a ~32B quantized model clears the admission gate (else Tier-2 collapses into Claude).
