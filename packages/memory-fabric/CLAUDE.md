# packages/memory-fabric — CLAUDE.md

The **Memory Fabric** data layer (ADR-0005): migrations + repositories for the one PostgreSQL database that *is* the system's memory. Shared by `api` (reads, gate-event writes, live stream) and `worker` (appends). Depends only on `shared-types` + `pg`.

## Guardrails (do not break)

- **Append-only is a database guarantee, not a convention.** UPDATE/DELETE on `ledger_event` are rejected by a trigger. Never "fix" a row — append a corrective event. Don't add a repository method that implies mutation.
- **Typed events only.** `append()` validates against the `shared-types` ledger-event schema *before* it writes. An unvalidated write path is a bug.
- **Ordering is by the monotonic id**, and replay-by-id must return exact append order (time-travel depends on it).
- **`LISTEN/NOTIFY` fires on append** — that's how the API streams to the dashboard without extra infra.
- **A missing Model Catalog tier is a typed error, never a silent default** to some arbitrary model (mirrors the `model-router` guardrail).
- **Every migration is reversible** — write `down` with `up`.
- Anything scanning the ledger on bootstrap/schedule must be **fail-safe** — never throw out of a bootstrap hook or scheduled job.

## Tests (see R2)

Integration-only by nature — these are database behaviours, and mocking them proves nothing. Tests boot a real PostgreSQL (testcontainers, same pgvector image as `docker-compose.yml`) via `npm run test:integration`; there is deliberately no unit-test script.

- append → strictly greater id **and** a NOTIFY notification arrives.
- UPDATE and DELETE are both rejected.
- N events replay in exact append order.
- distractors: a schema-invalid event is refused before it reaches the DB; an unmapped tier raises the typed error.

Install deps with `npm install` (never hand-edit package.json).
