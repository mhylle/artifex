# SWARM

**Self-organizing Workforce with Adaptive Roles & Memory** — a self-assembling, self-improving multi-agent system.

> A workforce that does not exist until the work arrives.

SWARM inverts the usual agent-system design. Instead of a fixed cast of agents decided up front, its only permanent employees are **four meta-agents** that know nothing about any domain — they only know how to *organize work*. Everything else is manufactured on demand.

Given any mission, SWARM:

1. **Atomizes** it into thousands of individually-verifiable tasks, each carrying one responsibility and one testable outcome;
2. **Designs the minimal specialist workforce** needed to execute them — writing agent instructions at runtime, reusing proven designs first;
3. **Verifies every task at both ends** — atomicity before execution, contract compliance after;
4. **Folds the results back up** the decomposition tree into one coherent outcome;
5. **Mines the complete audit trail** of everything it just did to become measurably better before the next mission.

Domain expertise is not built in — it is a thing the swarm *manufactures*, and the good designs are kept.

## The four meta-agents

| Agent | Role |
|---|---|
| **Orchestrator** | Decomposes missions and integrates results (the tree in reverse) |
| **Agent Creator** | Designs and staffs the specialist workforce at runtime |
| **Reviewer** | Verifies both the task graph and every completion |
| **Learning Agent** | Improves the whole institution — within an immutable constitution |

## Status

**Design stage.** This repository currently holds the **functional solution description** (a 7-page HTML dossier in [`solution/`](solution/)) and the first architecture decision. There is no implementation code yet.

- **Functional design** — [`solution/index.html`](solution/index.html) and its sibling pages (Architecture, Mission Lifecycle, Agents, Memory & Learning, Observability, Risks). Technology, security, and performance were deliberately out of scope at that stage.
- **Source brainstorm** — [`docs/brainstorms/2026-07-22-agent-swarm.md`](docs/brainstorms/2026-07-22-agent-swarm.md)
- **Decisions** — [`docs/decisions/`](docs/decisions/) ([ADR-0001: implementation stack](docs/decisions/ADR-0001-implementation-stack.md))

## Intended stack (ADR-0001)

All-TypeScript, multi-model:

- **Angular** dashboard — an observability cockpit rendered purely from the audit ledger
- **NestJS** control plane — mission intake, human gates, live ledger streaming
- A **separate agent-runtime worker** (BullMQ) — where missions actually run
- **PostgreSQL + pgvector** — the whole Memory Fabric (audit ledger, asset registry, knowledge commons)
- A provider-neutral **Model Router** — dispatching each agent to the right model, from small **local** LLMs (the bulk of the swarm) up to frontier models where a mistake is expensive

## Design foundations

The design was stress-tested against 2024–2026 research on multi-agent systems and self-improving agents. Four results shaped it most:

- **MAKER** — 1,048,575 dependent steps solved with zero errors via maximal decomposition + per-step voting.
- **MAST** — 44% of multi-agent failures trace to bad task *specification* (so contracts, not agents, are first-class).
- **METR** — 43× more reward-hacking when agents can see the scorer (so a small constitutional core is immutable to the learner).
- **Voyager** — 15.3× faster capability milestones with a curated skill library (so permanence is *earned*, and kept).

## License

[Apache License 2.0](LICENSE) © 2026 Martin Hylleberg.
