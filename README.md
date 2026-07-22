# Artifex

*Latin: **artifex** — master craftsman; the maker.*

**A self-assembling, self-improving multi-agent system — the maker that makes the makers.**

> A workforce that does not exist until the work arrives.

Artifex inverts the usual agent-system design. Instead of a fixed cast of agents decided up front, its only permanent employees are **four meta-agents** that know nothing about any domain — they only know how to *organize work*. Everything else is crafted on demand.

Given any mission, Artifex:

1. **Atomizes** it into thousands of individually-verifiable tasks, each carrying one responsibility and one testable outcome;
2. **Crafts the minimal specialist workforce** needed to execute them — writing agent instructions at runtime, reusing proven designs first;
3. **Verifies every task at both ends** — atomicity before execution, contract compliance after;
4. **Folds the results back up** the decomposition tree into one coherent outcome;
5. **Mines the complete audit trail** of everything it just did to become measurably better before the next mission.

Domain expertise is not built in — it is a thing the system *manufactures*, and the good designs are kept.

## The four meta-agents

| Agent | Role |
|---|---|
| **Orchestrator** | Decomposes missions and integrates results (the tree in reverse) |
| **Agent Creator** | Designs and staffs the specialist workforce at runtime |
| **Reviewer** | Verifies both the task graph and every completion |
| **Learning Agent** | Improves the whole institution — within an immutable constitution |

## Status

**Design stage.** This repository holds the **functional solution description** (a 7-page HTML dossier in [`solution/`](solution/)) and the architecture decisions. There is no implementation code yet.

- **Functional design** — [`solution/index.html`](solution/index.html) and its sibling pages (Architecture, Mission Lifecycle, Agents, Memory & Learning, Observability, Risks).
- **Source brainstorm** — [`docs/brainstorms/2026-07-22-agent-swarm.md`](docs/brainstorms/2026-07-22-agent-swarm.md)
- **Decisions** — [`docs/decisions/`](docs/decisions/): [ADR-0001 (stack)](docs/decisions/ADR-0001-implementation-stack.md), [ADR-0002 (model tiering & inference)](docs/decisions/ADR-0002-model-tiering-and-inference.md)

## Architecture (ADR-0001 / ADR-0002)

All-TypeScript, multi-model:

- **Angular** dashboard — an observability cockpit rendered purely from the audit ledger
- **NestJS** control plane — mission intake, human gates, live ledger streaming
- A **separate agent-runtime worker** (BullMQ) — where missions actually run
- **PostgreSQL + pgvector** — the whole Memory Fabric (audit ledger, asset registry, knowledge commons)
- A provider-neutral **Model Router** with a **4-tier model policy** — each agent's tier is *computed* from blast radius, fan-in, reversibility, task class, budget and clade score; the bulk of the swarm runs on **local** models (served via Ollama → vLLM), escalating to frontier models (Claude) only where a mistake is expensive

## Design foundations

The design was stress-tested against 2024–2026 research on multi-agent systems and self-improving agents. Four results shaped it most:

- **MAKER** — 1,048,575 dependent steps solved with zero errors via maximal decomposition + per-step voting.
- **MAST** — 44% of multi-agent failures trace to bad task *specification* (so contracts, not agents, are first-class).
- **METR** — 43× more reward-hacking when agents can see the scorer (so a small constitutional core is immutable to the learner).
- **Voyager** — 15.3× faster capability milestones with a curated skill library (so permanence is *earned*, and kept).

## License

[Apache License 2.0](LICENSE) © 2026 Martin Hylleberg.
