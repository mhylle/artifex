# ADR-0001 — Implementation stack: all-TypeScript, multi-model runtime

**Status:** Accepted
**Date:** 2026-07-22
**Deciders:** Martin Hylleberg (with Claude as advisor)
**Context scope:** First technical decision after the functional design (`solution/` dossier) was frozen. The dossier deliberately deferred all technology choices; this ADR opens that pass.

## Context

SWARM is a domain-neutral, self-assembling agent swarm (see the frozen functional brainstorm and `solution/`). The backend is really two systems: a **control plane** (API, auth, human gates, dashboard streaming — short-lived) and an **agent runtime** (recursive decomposition, agent spawning, LLM calls, dual-ended verification, fold-up — long-running, massively fan-out, thousands of tasks per mission). A hard requirement surfaced during the decision: the swarm must run a **heterogeneous model fleet** — small **local** LLMs for the bulk of agents (cost + latency), frontier models only where cost-of-error or irreducible judgment is high — and **model selection must be an output of agent creation**.

## Decision

**Frontend:** Angular (fixed by the owner).

**Backend / control plane:** NestJS (TypeScript). Reuses the owner's SSO packages and deploy/CI patterns. Hosts mission intake, human gates (approvals/clarifications/escalations, written back as ledger events), and a websocket gateway that streams the audit ledger to the dashboard via Postgres `LISTEN/NOTIFY`.

**Agent runtime:** a **separate** TypeScript worker process (not in the API request lifecycle), driven by a durable queue. Hosts the four meta-agents and the ephemeral worker swarm; appends every action to the audit ledger.

**Datastore:** PostgreSQL + **pgvector**, serving the *entire* Memory Fabric — Audit Ledger (append-only typed events; `LISTEN/NOTIFY` for live dashboard; monotonic ids for time-travel replay), Asset Registry (relational + JSONB), Knowledge Commons (pgvector semantic retrieval). One database does ledger + registry + commons + vector search.

**Job queue:** Redis + BullMQ, sized for high fan-out. Postgres remains source-of-truth for state/ledger; Redis carries the transient work queue.

**Model access:** a provider-neutral **Model Router** (TypeScript — Vercel AI SDK or a thin custom loop). Each agent's capability manifest carries a `{provider, model, params}` spec chosen by the Agent Creator at staffing time. Backends: Anthropic (Claude) and OpenAI-compatible local endpoints (Ollama in dev, vLLM for batched throughput). **The Claude Agent SDK is one backend behind the router, not the spine.**

## Rationale

- **All-TS** keeps one shared type set — critically, the **contract schema and ledger event schema** (the system's foundation) — across Angular, API, and worker. Going polyglot would duplicate/code-gen the most central schemas across a language boundary forever.
- SWARM is Claude-native and the Claude Agent SDK is first-class in TS; orchestration is I/O-bound (awaiting many model calls), which suits Node.
- **PostgreSQL as the whole fabric** directly serves the dossier's "one substrate" principle and removes moving parts.
- **Runtime/API separation** is non-negotiable: a mission's long-running, thousand-task tree cannot live in an HTTP request.
- **Multi-model fits the design:** cheap local models are less reliable per step — exactly the regime the verification architecture (micro-decomposition + voting + red-flagging, à la MAKER) was built for. The economics and the correctness design reinforce each other. Model tier is keyed to **blast radius / task class** (default cheap; escalate where wrong is expensive — decomposition, semantic Gate B review, learning science loop), not to a single named agent.

## Alternatives considered

- **Hybrid (NestJS API + Python agent runtime):** best access to the Python agent-research ecosystem (LangGraph/DSPy) and scientific stack for the learning loop. **Rejected for now** — duplicates the contract/ledger schemas across languages; the all-TS type-sharing win and Claude-native TS SDK outweigh it.
- **Python-first (FastAPI everywhere):** maximizes ML tooling. **Rejected** — loses type-sharing and the owner's NestJS/SSO reuse.
- **Postgres-backed queue (pg-boss/graphile-worker) instead of Redis:** avoids a Redis dependency. **Not chosen** — owner accepted Redis; BullMQ suits the fan-out throughput better. (Postgres still holds all durable state.)

## Consequences

- One deployable set of TS packages (frontend / API / worker / shared-types) + Postgres + Redis + a local-inference server (Ollama/vLLM).
- The **Model Router** and the **capability-manifest model-selection policy** become first-class buildable components.
- **Open items — now RESOLVED in [ADR-0002](ADR-0002-model-tiering-and-inference.md)** (tier-assignment policy, local model declaration, inference serving/staging, and the Python science-loop seam). At the time of this ADR they were deferred to the technical brainstorm.

## Related

- Functional brainstorm: Tasktracker brainstorm `SWARM — Functional Design (2026-07-22)`.
- Architecture components registered in Tasktracker project SWARM (Dashboard, Control Plane API, Agent Runtime Worker, Model Router, Memory Fabric, Job Queue, Model Backends).
