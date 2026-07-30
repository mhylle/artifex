# GOAL — the full Artifex system, working and usable from the UI

Set 2026-07-30 by the owner: *"I want everything implemented … such that we end up with the full system, working and usable from the ui."*

## The goal, stated so it can be checked

Artifex is done when **all 40 requirements in Tasktracker are `satisfied`**, `getProjectDoneness` returns `done: true` (phases · acceptance criteria · defects · completed-phase integrity · architecture drift), and — the binding clause —

> **every capability has been exercised through the real UI, in a real browser, driven by Playwright MCP.**

Not a green vitest suite. Not a dogfood script that assembles its own seams. The button, the route, the binary — driven the way an operator would drive them. This clause exists because it has already failed twice in this project:

- `04071ce9` — every phase was dogfooded against real Postgres/Redis/models and P13 passed 20/20, but each dogfood **wired the seams itself**, so `packages/worker`'s `main()` was still the P0 placeholder. The logic ran end to end; the deployable process never had.
- `cd18baa0` — the frozen dossier's entire operator console was deferred in **prose** (`packages/dashboard/CLAUDE.md`, the dossier), never as Tasktracker requirements. The doneness gate therefore certified a project whose UI could only paste a mission id and watch.

**A deferral is only real once it is an unsatisfied requirement in the system of record.**

## Scope

Tasktracker project **Artifex** `faf7e141-4cad-4e53-ab65-e490cba4e5a5` is the sole source of truth for what remains.

- **R1–R13** — built (v0 thin slices, 2 ACs each).
- **R14–R22** — the operator console: intake from the cockpit, the canvas lens, the inspector, cockpit actions as ledger events, the attention queue, the remaining four lenses, time travel, the fleet view, audience scoping.
- **R23–R40** — the system's missing spine: the Asset Registry and Knowledge Commons (2 of the 3 memory-fabric stores were never built), replay benchmarks + the sealed bench, both learning loops, clade scores, the amendment protocol, the intake dialogue, the decompose-or-delegate gate, the dependency graph and parallelism, Gate A and Gate B in full, reviewer calibration, error-class rung entry, delivery pedigree and the surrender dossier, the reuse market, instance-per-mission concurrency, and the worker contract ritual.

Every R14–R40 acceptance criterion quotes or paraphrases `solution/*.html` v1.1. **The dossier is the specification; Tasktracker is the ledger of what is built.**

## Suggested sequence

Thin base first, full depth to roadmap — sequence, never cut. Re-derive from `getNextReadyTask` / dependencies each iteration; this is a starting order, not a contract.

1. **Make the UI usable at all** — R14 · R21 · R15 · R16
2. **The execution spine** — R32 · R31 · R33 · R34 · R36 · R40 · R37
3. **Memory & learning** — R23 · R24 · R38 · R28 · R25 · R26 · R27 · R35 · R29
4. **Cockpit depth** — R17 · R18 · R19 · R20 · R39 · R30 · R22

Open defects to clear along the way: `2e5eaece` (stepwise planner emits duplicate subtasks — decomposition is not decomposing), `fd345eae` (POST /missions 500s on a malformed body), `cd18baa0` (this process defect — closed when R14–R40 exist and the doneness gate is honest), `04071ce9` (worker binary — fixed 2026-07-30, verify then resolve).

## Non-negotiables per iteration

- **TDD, RED first.** Write the failing test from the acceptance criterion before the implementation. Include a distractor that a lazy implementation would fail.
- **Mutation-check the distractors.** Break the implementation deliberately; a test that still passes is vacuous. This has caught 3 vacuous tests in this project already.
- **Never hand-edit a manifest.** `npm install`, `ng add`, `npm pkg set` — let the tool resolve versions and update the lockfile.
- **The seven invariants hold** (`ARCHITECTURE.md`). A change that breaks one is wrong regardless of how clean it looks.
- **Live-verify through the UI** before marking anything done.
- **Commit AND push** after each finalized unit — `origin` → https://github.com/mhylle/artifex
- **Log defects, learnings and frictions as Tasktracker insights**, not as chat narrative.

## Environment

| Piece | How it runs |
|---|---|
| Postgres · Redis · Ollama | `docker compose up -d` (ports 55432 / 6379 / 11435) |
| API | `node packages/api/dist/src/main.js` — bind and browse **`127.0.0.1:3000`** |
| Worker | `node packages/worker/dist/index.js` |
| Dashboard | `npm run start -w packages/dashboard -- --port 4321` |

**Port trap, learned the hard way:** `wslrelay.exe` squats `[::1]:3000` and `127.0.0.1:4200`, so `localhost` reaches a *different application* — a browser at `localhost:4200` rendered an unrelated recipe app, and a `curl` 200 was mistaken for the dashboard being up. Always confirm with `netstat -ano | grep LISTENING` **and** a Playwright snapshot showing "Artifex — Mission Control", never a status code alone.
