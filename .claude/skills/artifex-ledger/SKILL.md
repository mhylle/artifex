---
name: artifex-ledger
description: Append-only Audit Ledger rules for Artifex. Use when writing DB migrations or any code that reads/writes the ledger, the Model Catalog, or the memory-fabric stores (packages that touch Postgres, migrations, LISTEN/NOTIFY, replay). Triggers on "ledger", "append-only", "migration", "LISTEN/NOTIFY", "event store", "time-travel", "replay", "audit event".
---

# Audit Ledger rules (R2, ADR-0001)

The ledger is the **one substrate** — the single source of truth the dashboard and the Learning Agent both consume.

- **Append-only, enforced at the database level.** UPDATE and DELETE on ledger rows must be rejected (trigger/rule). Never "fix" a row — append a corrective event.
- **Monotonic id** per event; ordering is by that id. Replay-by-id must return events in exact append order (enables time-travel).
- **Typed events** — validate against the `shared-types` ledger-event schema before append.
- **`LISTEN/NOTIFY` fires on append** so the API can stream to the dashboard with no extra infra.
- Postgres image is **pgvector**-enabled (the Knowledge Commons uses it); the ledger itself is relational + JSONB.
- Migrations: write `up` **and** `down`; test the append-only rejection and the NOTIFY-fires behaviour (RED before GREEN).

Bootstrap/janitorial code that scans the ledger must be **fail-safe** — never throw out of a bootstrap or scheduled job.
