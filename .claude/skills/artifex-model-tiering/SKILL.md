---
name: artifex-model-tiering
description: Provider-neutral Model Router + 4-tier model policy rules for Artifex. Use when editing packages/model-router/**, the Model Catalog, the Tier Policy engine, the admission gate, or anything choosing which model an agent runs. Triggers on "model router", "model catalog", "tier", "admission gate", "Ollama", "vLLM", "Qwen", "provider", "which model".
---

# Model tiering & routing (ADR-0002/0003)

- **Router is the spine; the Claude Agent SDK is one backend behind it.** Never bind the runtime hard to Claude.
- **Tier is computed, not hardcoded.** The Tier Policy engine derives a logical tier per staffing decision from blast radius, fan-in, reversibility, task class, budget, and clade score. A tier-bump is an escalation-ladder rung.
- **4-tier ladder:** 0 = no LLM (mechanical checks) · 1 = local small (Qwen2.5) · 2 = local ~32B quantized · 3 = frontier (Claude).
- **Catalog resolves tier → concrete model** and is swappable data (principle #3). A missing entry is a **typed error, never a silent default**.
- **Admission gate:** a model enters the catalog only after producing schema-valid output on the *real* `shared-types` schemas.
- **Tier-2 fallback:** attempt the local 32B; if it fails the gate, logical Tier-2 resolves to **Claude** — explicitly and logged (ADR-0003).
- **Budget vs blast radius** is governed by the per-mission autonomy dial (supervised = hard floor + escalate; high-autonomy = may downgrade, loudly logged).
- Every tier choice + its inputs is a ledger event.

Consult the `claude-api` skill before touching the Claude backend. Install deps via `npm install`.
