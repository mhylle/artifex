# Active Context

> Current state, goals, and next-phase options. Update at the end of any significant session. This file is the authoritative "where we are".

**Last updated:** 2026-07-22

## Where We Are

- **Stage:** Functional design complete; **technical pass complete** (stack + model/inference decisions locked). No implementation code yet. Security/perf still deferred. **Ready for planning (v0 slice + core schemas).**
- **Stack decided (ADR-0001):** all-TypeScript. Angular dashboard · NestJS control plane · **separate** TS agent-runtime worker (BullMQ) · PostgreSQL + pgvector as the whole Memory Fabric · Redis/BullMQ job queue · a provider-neutral **Model Router** dispatching to Claude + local OpenAI-compatible models (Ollama/vLLM).
- **Model/inference decided (ADR-0002, from frozen brainstorm `9885e5b0`):** model **tier is a computed policy** (blast radius + fan-in + reversibility + task class + budget + clade score), **4-tier ladder** (Tier-0 no-LLM → Tier-3 frontier); tier-bump = an escalation-ladder rung; budget-vs-blast governed by the **autonomy dial**. Local models declared by logical tier via a versioned **Model Catalog** (Postgres); v0 workhorse **Qwen2.5-family** (replaceable, admission-gated on real schemas). Serving: **Ollama dev → vLLM staging/prod** behind the router. Learning science loop **TS-now** behind a ledger-projection + proposal-emitter seam; Python only "when it hurts". Owner hardware: single **24 GB GPU** (prod fan-out will need cloud/multi-GPU vLLM).
- **Name:** **Artifex** (Latin, "master craftsman/maker") — chosen 2026-07-22, replacing the working title "SWARM". Project, repo, and top-level docs renamed; the `solution/` dossier still carries "SWARM" (rebrand pending — see loose ends).
- **Functional design** exists as a **solution dossier (v1.1, 22 July 2026)** in `solution/` (7 HTML pages) — deliberately technology-free.
- **Primary artifact:** a 7-page HTML dossier in `solution/` — Overview (`index.html`), Architecture, Mission Lifecycle, Agents, Memory & Learning, Observability, Risks & Safeguards — all mutually linked.
- **Provenance:** outcome of a structured brainstorm (Socratic clarification → research → Six Hats / SCAMPER / premortem), source in `docs/brainstorms/2026-07-22-agent-swarm.md`, by Martin Hylleberg.
- **Design locked this brainstorm:** domain-neutral missions; maximal atomization (atomicity is itself verified); recursive fold-up integration; contract-first definition of done; escalation-ladder failure handling; earned agent permanence; constitutional self-improvement (immutable metric/review/audit/budget core); per-mission autonomy dial; earned knowledge commons; instance-per-mission + shared brain; mediated context broker; two-speed learning; budgeted swarm; surrender as a first-class outcome; audit-ledger-driven observability cockpit.
- **System of record:** Tasktracker project **"Artifex"** (id `faf7e141-4cad-4e53-ab65-e490cba4e5a5`). Holds: two frozen brainstorms (functional `bd543029`, technical/model `9885e5b0`), 7 registered architecture components + relationships, and a genesis phase (id `84676257-…`). No requirements or implementation phases entered yet.
- **Version control:** git `main` → **public** repo https://github.com/mhylle/artifex (Apache-2.0, © 2026 Martin Hylleberg). Open source.

## Next-Phase Options (user's call)

1. **`tt-create-plan` for the v0 slice** — the smallest build exercising the whole loop (decompose → contract → conjure → verify → fold → learn); the functional brainstorm's own #1 next step.
2. **Design the ledger event schema + contract schema first** — the brainstorm calls these "the foundation everything feeds"; they're the shared-types core of the all-TS stack and the stable contract behind the Model Catalog and the Learning seam.
3. **(Optional) Rebrand the `solution/` dossier** SWARM → Artifex — a careful 7-file HTML edit (titles, headers, the "Self-organizing Workforce…" subtitle has no Artifex acronym, so it needs a new tagline).

## Known Loose Ends

- **Dossier still branded "SWARM"** — the `solution/` HTML pages carry the old working title; project/repo/README are now Artifex. Rebrand pending (optional next-step 3).
- The two brainstorms are frozen in Tasktracker but the functional one also lives as markdown (`docs/brainstorms/`); project `brainstormPolicy` is `optional`.
- Public open-source repo has no CONTRIBUTING / issue templates / CI yet — add when real code lands.
- No requirements exist yet; genesis phase `84676257-…` is an unlinked container.
- ADR-0002 parking lot: prod concurrency/hardware sizing, per-tier cost-weight calibration, catalog-A/B harness, Tier-2-on-24GB viability.
