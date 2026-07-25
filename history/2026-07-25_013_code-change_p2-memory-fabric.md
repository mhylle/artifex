# 013 — P2: Memory Fabric data layer (Audit Ledger + Model Catalog)

**Date:** 2026-07-25
**Category:** code-change
**Phase:** P2 (Tasktracker `12c6ab84-…`) · **Requirement:** R2 (now `satisfied`)

**What:** Built the Memory Fabric's first two stores in a new `@artifex/memory-fabric` package — the append-only Audit Ledger with a live `LISTEN/NOTIFY` stream, and the versioned Model Catalog — plus migrations and repositories.

**Why:** R2. The ledger is the one substrate everything else renders from; P5–P9 append to it, P10 streams it, P12 draws from it, and the Learning Agent mines it.

**Details:**
- **New workspace package (ADR-0005).** Both the API (reads, gate-event writes, live stream) and the worker (appends) need this layer, and the documented five-package layout had no home for it. Putting it in `worker` would have forced `api → worker`, inverting the plane separation that `ARCHITECTURE.md` calls its most important structural rule; duplicating the repositories would have created a second source of truth. Recorded with its rejected alternatives; `ARCHITECTURE.md`'s repo-layout note replaced with a table and an explicit one-way dependency rule.
- **The guarantees live in the database, not in the code.** A `BEFORE UPDATE OR DELETE` trigger rejects mutation, and — because row triggers never see `TRUNCATE` — a second statement-level trigger guards that too. There is deliberately no update path on the repository either. `seq` is `GENERATED ALWAYS AS IDENTITY`, so no writer can supply its own ordering.
- **The NOTIFY payload is a pointer, not the event** (`seq`, `eventId`, `missionId`, `taskId`, `family`, `type`). Postgres caps NOTIFY at 8000 bytes and an evidence bundle will exceed it; consumers take the `seq` and read the row — which is the same path they need to catch up after a disconnect.
- **No `CHECK` constraint on `family`,** deliberately: the vocabulary lives in the shared TypeBox schema and is enforced on append. A second copy in DDL is exactly the drift ADR-0004 exists to prevent.
- **Typed events only** — `append()` validates against `LedgerEventInputSchema` *before* writing, because nothing can delete a bad row afterwards.
- **Model Catalog:** `admitted` is required, not defaulted — ADR-0002 says a model is only usable once it clears the structured-output admission gate, so the caller must say so out loud. An unmapped tier raises `TierNotInCatalogError` rather than silently substituting a model. Added `ModelCatalogEntry`/`Input` schemas to `shared-types` (the shared contract between this package and the P3 router) and wired them into the round-trip suite, keeping AC-1's "any shared schema" claim honest.
- **Integration-only by nature.** These are database behaviours; mocking them proves nothing. The package ships no unit-test script — the root `test:integration` now fans out to workspaces so CI runs them.

**Outcome:** TDD honoured — tests observed RED, then GREEN. 17 integration tests here (20 with the root harness), 45 unit tests repo-wide; build and typecheck clean. Verified the AC-1 tests genuinely bite by removing the append-only trigger and confirming exactly those three failed. Dogfooded against the real `docker-compose` Postgres: migration applied, NOTIFY arrived, UPDATE/DELETE/TRUNCATE all rejected, six events replayed in order, tier 1 resolved to `ollama/qwen2.5:14b`, unmapped tier 3 raised the typed error. The spec typecheck earned its keep again, catching an `as const` readonly-tuple mismatch vitest had happily transpiled. One caveat logged as a defect for P9/P12: IDENTITY values can commit out of order, so the *live tail* can skip an event under concurrent writers (replay is unaffected).
