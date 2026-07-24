# 010 — P0: workspace & infra scaffold (first implementation code)

**Date:** 2026-07-24
**Category:** code-change
**Phase:** P0 (Tasktracker `fb7ebb14-…`)

**What:** Stood up the all-TypeScript monorepo skeleton, local infra, an integration harness, and CI — the project's first implementation code. Scaffolding only; no business logic, no invariants implemented (none violated).

**Why:** P0 of the v0 plan (ADR-0003). Everything downstream (P1 TypeBox schemas → P13 dogfood) needs a working build/test/CI substrate and a runnable Memory Fabric + Job Queue + local model backend.

**Details:**
- **Root workspace:** npm workspaces (`packages/*`), strict `tsconfig.base.json` (NodeNext, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), `.nvmrc`=24, fan-out `build`/`test`/`typecheck`/`lint` scripts, plus `test:integration`. All manifests created/edited via `npm init`/`npm pkg set`/`npm install` — no hand-editing (CLAUDE.md rule).
- **Library packages** (`@artifex/shared-types`, `@artifex/model-router`, `@artifex/worker`): ESM, tsconfig extends base, placeholder `src/index.ts` + one passing **vitest** test each; worker has a guarded placeholder `main()` entrypoint (BullMQ deferred to P9) and declares `@types/node`.
- **api:** NestJS 11 via `nest new` (keeps its own tsconfig/jest; pins TS 5.7 nested, isolated from root TS 7). **dashboard:** **Angular 20** via `ng new` — pinned to 20 because the current Angular 22 CLI requires Node ≥24.15 and the toolchain is on 24.14; headless Karma via a `ChromeHeadlessNoSandbox` launcher.
- **Infra:** `docker-compose.yml` — Postgres+pgvector (pg17), Redis 7, Ollama — all healthchecked; pgvector enabled by an initdb script; `.env.example`. Committed host-port defaults 5433/6379/11434, overridable via a gitignored `.env`.
- **Integration harness:** root-level testcontainers test booting Postgres + Redis (asserts a query, pgvector presence, Redis PING).
- **CI:** `.github/workflows/ci.yml` — install → build → typecheck → unit tests → integration, Node from `.nvmrc`.

**Outcome:** DoD met and verified. `npm install`/`build`/`typecheck`/`test` green across all 5 workspaces (api 1, dashboard 2, model-router 1, shared-types 1, worker 2); `docker compose config` valid and `up -d --wait` brings all three services **healthy** (pgvector 0.8.5 confirmed); testcontainers harness 3/3. Two follow-ups captured as Tasktracker insights: Angular-20-vs-Node-24.15 pin, and the busy-dev-machine port-override convention. Deferred (noted, not P0): wire the root tsconfig path aliases into `tools/codebase-search` `loadProject()` so `find_references` resolves cross-package alias imports.
