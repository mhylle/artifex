# CLAUDE.md

<!-- Keep under 200 lines. If removing a line wouldn't cause mistakes, cut it -->

## Behavioral Rules

Guidelines to reduce common LLM mistakes. Tradeoff: these bias toward caution over speed — for trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions that YOUR changes made unused; don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals: "Add validation" → "Write tests for invalid inputs, then make them pass"; "Fix the bug" → "Write a test that reproduces it, then make it pass"; "Refactor X" → "Ensure tests pass before and after".

For multi-step tasks, state a brief plan with a verify step per item. Strong success criteria let you loop independently; weak criteria ("make it work") require constant clarification.

## Project Overview

- **Name:** Artifex (Latin: "master craftsman / maker") — a self-assembling, self-improving multi-agent system. Working-titled "SWARM" through the functional-design phase; the `solution/` dossier still carries that title.
- **What it is:** Artifex is an agent system whose only permanent employees are four meta-agents — Orchestrator, Agent Creator, Reviewer, Learning Agent — that take any mission, atomize it into individually-verifiable tasks, craft a disposable specialist workforce at runtime, verify every task at both ends, fold results back into one outcome, and mine the audit trail to improve before the next mission. **Design stage:** functional design frozen (v1.1 dossier), stack + model/inference decisions locked (ADR-0001/0002); no implementation code yet. Security and performance still out of scope.
- **Remote:** `origin` → https://github.com/mhylle/artifex (public, Apache-2.0) — commit AND push after each finalized unit of work (commit alone is not enough).

## Repository Map

| Path | Contents |
|---|---|
| `solution/` | The functional solution dossier — 7 linked HTML pages: `index.html` (Overview), `architecture.html`, `lifecycle.html`, `agents.html`, `learning.html`, `observability.html`, `risks.html` |
| `docs/brainstorms/` | Source brainstorm that produced the dossier (`2026-07-22-agent-swarm.md`) |
| `docs/decisions/` | Architecture Decision Records (`ADR-*.md`) |
| `.claude/` | Session config — `rules/`, `commands/`, `agents/`, `settings.local.json` |
| `history/` | Development history entries (index: `CLAUDE-history.md`) |

## Memory System

Dual-memory architecture. Memory bank files are git-shared and read **on demand** — do not preload them all:

| File | Read when |
|---|---|
| `CLAUDE-activeContext.md` | Session start — current state, goals, and next-phase options |
| `CLAUDE-history.md` | Catching up on how the project evolved (index only; entries live in `history/`) |
| `solution/index.html` | You need the authoritative functional overview and the table of locked decisions |
| `docs/decisions/ADR-*.md` | You need a technical/architecture decision and its rationale (stack: ADR-0001) |

**Shadow (machine-local):** native auto memory (`memory/MEMORY.md` + topic files, via `/memory`) mirrors key project facts for resilience. If this file or the memory bank is ever reset or wiped, recover context from auto memory.

**Sync workflow:** after significant work, update `CLAUDE-activeContext.md`, create a history entry if warranted (see below), then mirror key new facts into auto memory. The `/update-memory-bank` command triggers this; the `memory-bank-synchronizer` agent reconciles memory bank files against repo reality.

## Tasktracker (Mandatory)

Tasktracker MCP project **"Artifex"** (id `faf7e141-4cad-4e53-ab65-e490cba4e5a5`) is the system of record for requirements, architecture, and phased implementation plans — not markdown files, and not this file. **Before writing or trusting any state claim** here or in `CLAUDE-activeContext.md` (tech stack decided or not, architecture exists or not, planning started or not) — run `tasktracker_getProjectBrief` (verbosity `fat`) **and** `tasktracker_getProjectReadiness` on this project. `tasktracker_listProjects`' one-line description is not enough: a project can already hold a finalized architecture/stack decision and hundreds of tasks even when the local checkout is empty or new. Re-run this check at the start of any session where you're about to assert what state the project is in.

**MUST use the tasktracker-native (`tt-*`) skills for all planning/implementation work on this project — never the file-based equivalents:**

| Use this | Not this | For |
|---|---|---|
| `tt-brainstorm` | `brainstorm` | New brainstorms |
| `tt-create-plan` | `create-plan` | New requirements / phases |
| `tt-implement-plan`, `tt-implement-phase` | `implement-plan`, `implement-phase` | Executing the plan |

## Development History Requirement

**MANDATORY:** This project maintains a living development history using progressive disclosure — a lightweight index (`CLAUDE-history.md`, one table row per entry) plus individual entry files in `history/`.

**LOG these (meaningful state transitions only):** a document/feature reaching finalized state; an architectural or scope decision; a problem investigated and resolved; a significant restructure; a configuration change that affects behavior; batched small changes that together form one milestone.

**DO NOT LOG:** typo/formatting fixes, renames without behavior change, intermediate saves, research without a resulting action. When in doubt, batch related small changes into one entry.

**Procedure for a new entry:**
1. Read `history/.counter` for the next sequence number
2. Create `history/YYYY-MM-DD_NNN_category_slug.md` — category is one of: `code-change`, `decision`, `bug-fix`, `dependency`, `deployment`, `refactor`, `configuration`, `testing`, `documentation`, `discovery`
3. Entry format: `**What:** / **Why:** / **Details:** / **Outcome:**`
4. Append one row to the table in `CLAUDE-history.md`
5. Increment `history/.counter`
6. At the same checkpoint, review high-signal docs for drift (`CLAUDE-activeContext.md`, this file, plus the `solution/` dossier if the design changed) and update any made inaccurate

Do NOT dump full details into `CLAUDE-history.md` — it is an index only. Do NOT read every entry file by default — read the index first, load entries on demand.

## Durable Working Preferences

- **Iterative delivery:** ship thin base first, commit full depth to roadmap — never cut scope, only sequence it
- **Brainstorming method:** Socratic questioning, round-by-round, functional not technical
- **Document options at every decision point:** options considered, choice made, where deferred options land on the roadmap
- **Quality over speed**, especially for data/document processing
- **Every iteration beyond base must be brainstormed before implementation** — write this into any implementation plan
- **Functional-before-technical:** this project deliberately keeps technology, security, and performance out of scope until the functional design is settled — respect that boundary unless the user lifts it

## Rules Dependency

Memory-resilience rules load from `.claude/rules/core-rules.md`. If `.claude/rules/` is missing, alert the user.
