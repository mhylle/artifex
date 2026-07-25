# ADR-0005 — The Memory Fabric data layer is its own workspace package

**Status:** Accepted
**Date:** 2026-07-25
**Deciders:** Martin Hylleberg (with Claude as advisor)
**Context:** P2 (Audit Ledger + Model Catalog, R2). First phase that needs persistence code.

## Context

[ADR-0001](ADR-0001-implementation-stack.md) locked an all-TypeScript workspace and `ARCHITECTURE.md` sketched five packages — `shared-types`, `dashboard`, `api`, `worker`, `model-router`. That sketch was written before any code existed and did not say where database access lives.

P2 forces the question, because **two planes need the same data layer**:

- the **Agent Runtime Worker** appends every action to the audit ledger, and resolves logical tiers through the Model Catalog;
- the **Control Plane API** reads the ledger, writes human gate/intake events, and streams appends to the dashboard via `LISTEN/NOTIFY`.

The Memory Fabric, Audit Ledger, Asset Registry, Knowledge Commons, and Model Catalog are already registered as first-class **data-layer components** in the Tasktracker architecture model — they simply had no home in the repo layout.

## Decision

Add a sixth workspace package, **`@artifex/memory-fabric`**, owning schema migrations and repositories for the Memory Fabric stores. It depends only on `@artifex/shared-types` (for the typed event schemas it validates against) and `pg`.

Dependency direction: `api → memory-fabric` and `worker → memory-fabric`; never `api → worker`.

## Alternatives considered

- **Put it in `packages/worker`, have the API import from there.** Rejected: it makes the control plane depend on the agent runtime, inverting the single most important structural rule in `ARCHITECTURE.md` ("the agent runtime is a separate process from the API"). It would also drag BullMQ and the meta-agents into the API's dependency graph.
- **Duplicate the repositories in `api` and `worker`.** Rejected: two copies of the append path is exactly how a second source of truth appears, against the "one substrate" invariant — and it violates the no-duplication principle.
- **Put it in `shared-types`.** Rejected: `shared-types` is the dependency-graph leaf and is contractually pure — "no side effects, no I/O". Database clients there would poison the Angular dashboard's dependency graph.
- **Defer by inlining SQL in the worker and extracting later.** Rejected as false economy: the API needs ledger reads in P10, so the extraction is known-required, and doing it after two consumers exist is strictly more work.

## Consequences

- The repo layout is now six packages; `ARCHITECTURE.md`'s "where things live" note is updated to match.
- `memory-fabric` is **integration-test-only**: the append-only trigger and `LISTEN/NOTIFY` are database guarantees, so its tests boot a real PostgreSQL (testcontainers, the same pgvector image as `docker-compose.yml`). It ships no unit-test script; the root `test:integration` fans out to it.
- Migrations use **node-pg-migrate** (up *and* down), runnable both by CLI and programmatically from tests.
- Later fabric stores (Asset Registry in P6, Knowledge Commons in P11) land in this package rather than spawning further ones.

## Related

- R2 in Tasktracker; the `artifex-ledger` guardrail skill.
- [ADR-0001](ADR-0001-implementation-stack.md) (stack), [ADR-0002](ADR-0002-model-tiering-and-inference.md) (Model Catalog), [ADR-0004](ADR-0004-schema-encoding.md) (the schemas being validated on append).
