# Active Context

> Current state, goals, and next-phase options. Update at the end of any significant session. This file is the authoritative "where we are".

**Last updated:** 2026-07-22

## Where We Are

- **Stage:** Design complete + **v0 plan formed — Tasktracker readiness `ready`** (brainstorm / requirements / architecture / plan all satisfied). No implementation code yet. Security/perf still deferred. **Next: build P0.**
- **v0 plan (ADR-0003):** 11 approved requirements (R1–R11) with 26 acceptance criteria; 14 TDD-shaped phases (P0 infra → P1 schemas → P2 ledger → P3 router → P4 constitution/tier → P5–P8 meta-agents → P9 loop → P10 API → P11 learning seam → P12 dashboard → P13 dogfood), each linked to its requirement. Schema encoding = **TypeBox** (ADR-0004). v0 dogfood mission = "structured report from 2–3 sub-questions". Tier-2 = attempt local 32B with Claude fallback via the admission gate.
- **Stack decided (ADR-0001):** all-TypeScript. Angular dashboard · NestJS control plane · **separate** TS agent-runtime worker (BullMQ) · PostgreSQL + pgvector as the whole Memory Fabric · Redis/BullMQ job queue · a provider-neutral **Model Router** dispatching to Claude + local OpenAI-compatible models (Ollama/vLLM).
- **Model/inference decided (ADR-0002, from frozen brainstorm `9885e5b0`):** model **tier is a computed policy** (blast radius + fan-in + reversibility + task class + budget + clade score), **4-tier ladder** (Tier-0 no-LLM → Tier-3 frontier); tier-bump = an escalation-ladder rung; budget-vs-blast governed by the **autonomy dial**. Local models declared by logical tier via a versioned **Model Catalog** (Postgres); v0 workhorse **Qwen2.5-family** (replaceable, admission-gated on real schemas). Serving: **Ollama dev → vLLM staging/prod** behind the router. Learning science loop **TS-now** behind a ledger-projection + proposal-emitter seam; Python only "when it hurts". Owner hardware: single **24 GB GPU** (prod fan-out will need cloud/multi-GPU vLLM).
- **Name:** **Artifex** (Latin, "master craftsman/maker") — chosen 2026-07-22, replacing the working title "SWARM". Fully rebranded: repo, Tasktracker project + brainstorms, README, CLAUDE docs, the `solution/` dossier, and the ADRs. (Dated `history/` entries retain "SWARM" as the accurate record of what the project was called at the time.)
- **Functional design** exists as a **solution dossier (v1.1, 22 July 2026)** in `solution/` (7 HTML pages) — deliberately technology-free.
- **Primary artifact:** a 7-page HTML dossier in `solution/` — Overview (`index.html`), Architecture, Mission Lifecycle, Agents, Memory & Learning, Observability, Risks & Safeguards — all mutually linked.
- **Provenance:** outcome of a structured brainstorm (Socratic clarification → research → Six Hats / SCAMPER / premortem), source in `docs/brainstorms/2026-07-22-agent-swarm.md`, by Martin Hylleberg.
- **Design locked this brainstorm:** domain-neutral missions; maximal atomization (atomicity is itself verified); recursive fold-up integration; contract-first definition of done; escalation-ladder failure handling; earned agent permanence; constitutional self-improvement (immutable metric/review/audit/budget core); per-mission autonomy dial; earned knowledge commons; instance-per-mission + shared brain; mediated context broker; two-speed learning; budgeted swarm; surrender as a first-class outcome; audit-ledger-driven observability cockpit.
- **System of record:** Tasktracker project **"Artifex"** (id `faf7e141-4cad-4e53-ab65-e490cba4e5a5`). Holds: two frozen brainstorms (functional `bd543029`, technical/model `9885e5b0`), a **full architecture model (19 components + 31 relationships** — deployment plane, the meta-layer inside the runtime worker, the memory-fabric stores, and the model tier/catalog pieces), and a genesis phase (id `84676257-…`). Mirrored for contributors in [`ARCHITECTURE.md`](ARCHITECTURE.md). No requirements or implementation phases entered yet.
- **Version control:** git `main` → **public** repo https://github.com/mhylle/artifex (Apache-2.0, © 2026 Martin Hylleberg). Open source.

## Next-Phase Options (user's call)

1. **Start building — `tt-implement-plan` (or `tt-implement-phase` on P0)** — begin execution with P0 (workspace & infra scaffold), then P1 (the TypeBox schemas — the foundation everything feeds). Each phase is TDD-shaped (RED tests from the ACs before implementation).
2. **Review/adjust the plan first** — the 14 phases and 11 requirements are in Tasktracker; reorder, split, or add before writing code.

## Known Loose Ends

- The two brainstorms are frozen in Tasktracker but the functional one also lives as markdown (`docs/brainstorms/`); project `brainstormPolicy` is `optional`.
- Public open-source repo has no CONTRIBUTING / issue templates / CI yet — add when real code lands.
- No requirements exist yet; genesis phase `84676257-…` is an unlinked container.
- ADR-0002 parking lot: prod concurrency/hardware sizing, per-tier cost-weight calibration, catalog-A/B harness, Tier-2-on-24GB viability.
