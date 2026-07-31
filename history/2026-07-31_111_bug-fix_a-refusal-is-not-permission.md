# 111 — A refusal is not permission, and the drift instrument is fixed at the source

**Date:** 2026-07-31
**Category:** bug-fix

**What:** Two things that had been carried as open questions were settled by measuring them, and both turned out to be real bugs. An operator's **Reject** was being read as consent — a refused mission ran and delivered. And the architecture-drift pillar was failing because the walker's file patterns were hardcoded to another project's conventions; that is now fixed **in the tool**, not worked around here.

**Why:** "Fix everything." Both items were logged as undecided rather than broken, precisely because the evidence to call them bugs did not exist yet. Getting that evidence was the work.

**Details:**

## A refusal is not permission

The cockpit renders a `Reject` button on every attention item. What it did at the runtime was unmeasured, so it had been logged as an open question (`87706bf1`) rather than asserted to be wrong.

Measured through the real cockpit route: a mission blocked at intake, the operator answered `decision: "reject"` with the note *"No - do not proceed with this mission"* — and the mission started, decomposed, staffed, executed, passed Gate B and **delivered**.

`foldPriorTrail` folded every ruling into `decided` without reading its value, and `decided` is what the intake block keys on (ADR-0023), so a refusal cleared the block exactly as consent would.

    if (event.payload['decision'] !== 'reject') decided.add(taskId);

Only the decision **value** is inspected, never the note: judging whether free prose means yes or no is the string-matching this project refuses to do, and the operator already has a field for saying which. Written as `!== 'reject'` rather than `=== 'approve'` deliberately — `decision` is optional, so an operator who answers without picking a value has still answered, and reading that silence as refusal would strand a mission on a technicality.

**The second mutant initially survived.** `=== 'approve'` passed every test, because every fixture in that suite set `decision` explicitly and the missing-field case was untested — the exact weakness this project has written down. A distractor for the absent-decision case now kills it. The full worker suite passing unchanged also establishes that the escalation ladder does not rely on rejections clearing rungs.

Logged and resolved as defect `8b3bdf66`.

## The drift instrument, fixed at the source

The walker lives in the user's own `tasktracker` project, symlinked into the global npm prefix — so the cause was reachable rather than something to route around.

    DEFAULT_DRIFT_SUFFIXES     = ['.module.ts','.service.ts','.controller.ts', ...]
    DEFAULT_DRIFT_DIR_PREFIXES = ['backend/src/migrations/','mcp-server/tools/','mcp-server/lib/']

Hardcoded to that project's own layout. On Artifex they matched exactly 7 files — and `find packages -name "*.controller.ts" -o -name "*.service.ts" -o -name "*.module.ts"` returns exactly those 7. **That precision also refutes the earlier untested lead** that the space in the repo path was breaking the walk; a broken path would not have found a coherent NestJS-shaped subset.

The fix is a per-repo `.tasktracker-drift.json`, merged over the built-in defaults, strictly additive: no config means exactly today's behaviour, and a malformed config falls back rather than emptying the inventory — an empty inventory would mark *every* component orphaned, which is worse than the problem being solved. 6 new tests, RED first, one carrying a control that the defaults **do** find the NestJS-named file so a zero elsewhere means narrow patterns rather than a failed walk. All 236 tasktracker tests pass. Committed there as `5d5294b` (not pushed — that repo is not this project's to publish).

Artifex now declares `packages/` with `.ts/.html/.css`, excluding specs, build output and test scaffolding. Inventory **7 → 107**.

**Registering those honestly surfaced a gap the short inventory had been hiding: `packages/shared-types` had no architecture component at all** — the leaf every other package depends on. It now has one, and all 107 files are assigned across 25 components by what they actually are. Verified against the real walker: **missing 0, orphaned 0**.

**Outcome:**

816 worker + 183 + 71 + 54 + 26 unit and 172 integration green; all six workspaces build.

**The drift pillar is not green yet, and the reason is mechanical rather than substantive.** The MCP server process was started before the walker changed, so it still walks 7 files and currently reports `orphaned 100` — the expected transitional reading when 107 true references are compared against a 7-file inventory. It goes green when that process restarts, which cannot be triggered from inside a session. The same "rebuilding is not restarting" lesson, this time applied to the tooling rather than the worker.

Nothing was deleted to make the gate agree. Every reference registered is a file that exists.

Also resolved: the docker-compose port friction, which turned out to be **already implemented** — `${VAR:-default}` in compose, `.env` gitignored, `.env.example` committed and documenting why Postgres defaults to 5433. It was a recorded convention, not outstanding work.
