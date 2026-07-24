# Development History: Artifex

> Index of development entries for this project. Each entry is a separate file in `history/`. This file is the lightweight reference — read individual entries on demand for full details.

## How This Works

- This file is an **index only** — one line per entry with a link to the full entry file
- Full entry content lives in `history/YYYY-MM-DD_NNN_category_slug.md`
- The counter at `history/.counter` tracks the next sequence number
- Update this index whenever a new entry is created

---

## Phase 0

Everything predating this history system. Artifex (working-titled **SWARM** at the time) began as a structured brainstorm (Socratic clarification → 2024–2026 multi-agent research → Six Hats / SCAMPER / premortem) run by Martin Hylleberg, captured in `docs/brainstorms/2026-07-22-agent-swarm.md`. That brainstorm produced a 7-page functional solution dossier in `solution/` (Overview, Architecture, Mission Lifecycle, Agents, Memory & Learning, Observability, Risks & Safeguards), version 1.1 dated 22 July 2026, scoped to functional design only — technology, security, and performance deliberately deferred. No implementation code existed and the repository was not under version control. The claude-project-setup methodology was adopted on 2026-07-22 (entry 001 below).

| # | Date | Category | Summary | File |
|---|------|----------|---------|------|
| 001 | 2026-07-22 | configuration | Adopted claude-project-setup methodology — memory bank, history system, core rules, Tasktracker project | [history/2026-07-22_001_configuration_adopt-methodology.md](history/2026-07-22_001_configuration_adopt-methodology.md) |
| 002 | 2026-07-22 | decision | Chose implementation stack (ADR-0001): all-TS Angular + NestJS + Postgres/pgvector, separate agent-runtime worker, provider-neutral Model Router for multi-model (local + Claude) | [history/2026-07-22_002_decision_implementation-stack.md](history/2026-07-22_002_decision_implementation-stack.md) |
| 003 | 2026-07-22 | configuration | Published as public open-source repo github.com/mhylle/agent-swarm (Apache-2.0) with README + LICENSE | [history/2026-07-22_003_configuration_open-source-repo.md](history/2026-07-22_003_configuration_open-source-repo.md) |
| 004 | 2026-07-22 | decision | Technical/model pass (ADR-0002): 4-tier computed model policy, autonomy-dial budget rule, Postgres Model Catalog (Qwen2.5 v0), Ollama→vLLM serving, TS-now Learning seam | [history/2026-07-22_004_decision_model-tiering-inference.md](history/2026-07-22_004_decision_model-tiering-inference.md) |
| 005 | 2026-07-22 | decision | Named the project **Artifex** (was working-title SWARM); renamed repo → github.com/mhylle/artifex, Tasktracker project, and top-level docs | [history/2026-07-22_005_decision_project-name-artifex.md](history/2026-07-22_005_decision_project-name-artifex.md) |
| 006 | 2026-07-22 | documentation | Finished the rebrand across all content — `solution/` dossier, brainstorm, ADRs (SWARM → Artifex); dated history entries kept as the accurate record | [history/2026-07-22_006_documentation_rebrand-dossier.md](history/2026-07-22_006_documentation_rebrand-dossier.md) |
| 007 | 2026-07-22 | documentation | Registered full architecture in Tasktracker (19 components + 31 relationships) and published contributor-facing `ARCHITECTURE.md` with Mermaid diagrams | [history/2026-07-22_007_documentation_architecture-registered.md](history/2026-07-22_007_documentation_architecture-registered.md) |
| 008 | 2026-07-22 | decision | Formed the v0 plan (ADR-0003/0004): 11 requirements + 26 ACs + 14 TDD phases in Tasktracker; readiness `ready`. TypeBox schemas; 32B-local Tier-2 w/ Claude fallback | [history/2026-07-22_008_decision_v0-plan.md](history/2026-07-22_008_decision_v0-plan.md) |
| 009 | 2026-07-23 | configuration | Adopted the AI Layer: per-package CLAUDE.md hierarchy, SessionStart/Stop hooks, 5 glob-scoped guardrail skills, a working ts-morph codebase-search MCP, and a read-only explorer subagent | [history/2026-07-23_009_configuration_ai-layer.md](history/2026-07-23_009_configuration_ai-layer.md) |
| 010 | 2026-07-24 | code-change | **P0 scaffold (first code):** all-TS npm-workspaces monorepo (5 packages), NestJS 11 api + Angular 20 dashboard, docker-compose (Postgres+pgvector · Redis · Ollama, healthy), testcontainers harness, and CI. Build/test/typecheck green; DoD verified | [history/2026-07-24_010_code-change_p0-scaffold.md](history/2026-07-24_010_code-change_p0-scaffold.md) |

---
