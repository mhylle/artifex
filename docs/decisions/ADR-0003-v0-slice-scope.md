# ADR-0003 — v0 slice: scope, sequencing & tiering

**Status:** Accepted
**Date:** 2026-07-22
**Deciders:** Martin Hylleberg (with Claude as advisor)
**Context:** First implementation plan. Design is settled (ADR-0001 stack, ADR-0002 model/inference, ADR-0004 schema encoding). This ADR fixes what v0 proves and what is sequenced to the roadmap.

## Decision

**v0 goal:** prove the whole mission loop works, end to end, on one trivial mission, live on the deployed system — **intake → decompose → Gate A → staff/conjure → execute → Gate B → fold-up → learn** — with every step on the append-only ledger and watchable in the dashboard. A correctness proof of the loop, not production scale.

**Nothing is cut, only sequenced** (durable preference). Depth deferred to the roadmap: the five dashboard lenses + time-travel replay, the full science loop + experiments + ratchet (and the Python seam), reuse/bidding from a populated Asset Registry, the pgvector Knowledge Commons + expiry, high-fan-out throughput, and the constitutional amendment workflow.

**Trivial mission:** "compose a short structured report from 2–3 independently-answerable sub-questions." Domain-neutral; decomposes into 2–3 atomic, individually-verifiable leaves (Qwen-friendly); makes Gate A (coverage) and Gate B (per-leaf completion) meaningful; gives fold-up real reconciliation.

**Phasing:** 14 phases (P0–P13), foundation-first, one meta-agent per phase for clean TDD/verification boundaries. Schemas (P1) are built before anything else, per the brainstorm.

**Model tiering in v0 (extends ADR-0002):** run the full 4-tier ladder.
- Tier 0 (mechanical, no LLM) and Tier 1 (Qwen2.5 7B–14B local) — active.
- **Tier 2 — attempt a ~32B quantized local model on the single 24 GB GPU.** Owner's call, to exercise the real ladder. **Safety valve:** it enters the Model Catalog only if it clears the ADR-0002 structured-output admission gate; until then the catalog resolves logical Tier-2 → **Claude**, so VRAM/throughput/gate problems never block v0. The tier *function* always computes the logical tier; the catalog decides the concrete model.
- Tier 3 (Claude) — active.

## Consequences

- P3/P4 seed the catalog with Qwen2.5 (Tier-1) and a 32B-quantized Tier-2 candidate behind the admission gate, with Claude as the Tier-2 fallback and Tier-3.
- v0 requires no new architecture components — it exercises a subset of the 19 already registered.
- Success = the dogfood phase (P13) runs the trivial mission through the deployed whole and captures a complete ledger trail (principle #6: dogfood + live-verify before "done").

## Related

- Requirements R1–R11 and phases P0–P13 in Tasktracker project Artifex.
- ADR-0004 (TypeBox schema encoding), ADR-0002 (tiering, catalog, admission gate).
