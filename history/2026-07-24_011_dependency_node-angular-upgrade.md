# 011 — Toolchain bump: Node 24.18 + Angular 22 (Karma → vitest)

**Date:** 2026-07-24
**Category:** dependency

**What:** Upgraded Node 24.14.0 → **24.18.0** and, on the back of it, the dashboard from **Angular 20 → 22**. Reverses the P0 pin recorded in entry 010.

**Why:** P0 had pinned Angular 20 because the current Angular 22 CLI requires Node `^24.15.0` and the toolchain was on 24.14. The owner wanted latest Angular, so we lifted the Node floor first.

**Details:**
- **Node:** upgraded in place via `winget upgrade OpenJS.NodeJS.LTS` (24.14.0 → 24.18.0). Admin/UAC is required and cannot be granted from the non-interactive session — the owner ran it. npm came along **11.9 → 11.16**. `.nvmrc` bumped `24` → `24.18.0`.
- **Angular:** `ng update` does not work through the hoisted npm workspace (it reads the project's own `node_modules`, but deps are hoisted to root → "Found 0 dependencies"). Since the dashboard was still a pristine `ng new` scaffold with no app code, it was **re-scaffolded at Angular 22** and the three customizations reapplied (`@artifex/dashboard` name, Apache-2.0 license, restored `CLAUDE.md`). For a real app later, use the isolated-copy `ng update` method instead.
- **Test runner change:** Angular 22 defaults to the **`@angular/build:unit-test` builder (vitest + jsdom)** — no Karma, no Chrome. Removed the old `karma.conf.js`/`ChromeHeadlessNoSandbox` launcher and the `CHROME_BIN` env from CI. `ng test` runs once (CI-friendly), no `--no-watch` needed.
- **npm 11.16 install-script gating:** npm now blocks dependency lifecycle scripts by default. Currently blocked: `esbuild` (works without them — ships binaries as optional deps), and optional native accelerators `@parcel/watcher`/`lmdb`/`msgpackr-extract`/`ssh2`/`cpu-features`/`protobufjs`/`unrs-resolver` (all have JS fallbacks). No functional impact; approve with `npm approve-scripts` only if native perf matters.

**Outcome:** Full sweep green — build + typecheck + test across all 5 workspaces (api 1, dashboard 2 via vitest, model-router 1, shared-types 1, worker 2) + integration harness 3/3. TypeScript versions now coexist per-package (root libs TS 7, api TS 5.7, dashboard TS 6) via workspace nesting. Tasktracker MCP was disconnected during this work, so its "pin Angular 20" learning is now stale — reconcile next session.
