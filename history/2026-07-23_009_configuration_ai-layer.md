**What:** Adopted the **AI Layer** (methodology piece #6, `docs/ai-layer.md`) before starting the build — the one setup piece we'd deferred while docs-only.

**Why:** Now that the stack/architecture is decided in the system of record (ADR-0001/0002, 19 registered components) and the codebase is about to grow large, the memory bank alone isn't enough — sessions also need navigation + guardrails. Re-checked the setup repo against `methodology.md`'s six pieces: 1–5 were solid; the AI Layer was the only gap.

**Details (all five components built now, per owner's "everything now" call):**
- **CLAUDE.md hierarchy:** a per-package `CLAUDE.md` in `packages/{shared-types,model-router,api,worker,dashboard}`, each with module-specific rules (worker carries the 7 invariants; shared-types the TypeBox one-schema-three-uses rule; etc.). Root `CLAUDE.md` gained an "AI Layer" section (merged, not a second router).
- **Hooks** (`.claude/hooks/` + `.claude/settings.json`): fail-safe Node scripts — SessionStart surfaces current state + tasktracker readiness; a self-improving Stop nudges the memory-bank sync ritual. Both smoke-tested (exit 0).
- **Glob-scoped skills** (`.claude/skills/`): `artifex-invariants`, `artifex-schemas`, `artifex-ledger`, `artifex-model-tiering`, `artifex-tdd`.
- **Codebase-search MCP** (`tools/codebase-search/`, registered in `.mcp.json`): a working stdio MCP over the TS monorepo using ts-morph — tools `find_symbol`, `find_references`, `list_exports`. Deps installed via npm (SDK 1.29 / ts-morph 28 / zod 4); builds clean; a `prepare` script auto-builds on install; smoke- **and** function-tested (`find_symbol('loadProject')` resolved to its source line).
- **Explorer subagent** (`.claude/agents/artifex-explorer.md`): read-only codebase Q&A.
- Added a root `.gitignore` (node_modules/dist ignored — verified nothing under node_modules is staged).

**Outcome:** The AI Layer is live and verified; guardrails are in place to steer the build. The codebase-search MCP indexes little today (design-stage) and grows as code lands. Next: build **P0** (workspace & infra scaffold).
