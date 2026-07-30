# 2026-07-30 · 033 · code-change · The operator console becomes real — R14, R21, R15, R16 — and seven defects the browser found

**What:** Built the first four requirements of the operator console (R14 intake, R21 fleet view, R15 canvas lens, R16 inspector) and fixed seven defects, every one of them discovered by driving the real UI in a real browser rather than by a test suite.

**Why:** The owner asked to submit a mission through the UI and found there was no way to. Investigating produced `cd18baa0` — the frozen dossier's entire operator console had been deferred *in prose*, never entered into Tasktracker — so `getProjectDoneness` reported five green pillars against a scope that had quietly shrunk. R14–R40 (85 acceptance criteria) now exist as requirements, and the rule is recorded: **a deferral is only real once it is an unsatisfied requirement in the system of record.**

**Details:**

- **R14 — intake from the cockpit.** Objective / criteria / out-of-scope, refusal with a named reason before anything reaches the wire, auto-watch on accept. Also the owner's standing rule: no inline Angular templates or styles, recorded in both CLAUDE.mds and on the Dashboard architecture component.
- **R21 — fleet view.** `listMissions()` aggregates the fleet out of the ledger in one pass; no mission table, so the rail cannot drift from the trail. Surrender wins a fold/surrender tie (reporting the cheerier outcome is how a dashboard starts lying); "tasks today" is the calendar day; an unreachable control plane is reported rather than rendered as an empty fleet.
- **R15 — canvas lens.** Recursive node canvas; state is border *style* + icon + words, never colour alone. `task.contracted` gained `category`, `parentTaskId`, `dependsOn` — edges cannot be drawn from data that was never recorded. Orphan parents attach at the root and parent cycles degrade flat, because this data is written by a model-driven loop.
- **R16 — inspector.** Contract, criteria with live state, effort vs budget, agent design+version, and the task's own ledger events one click away. Criterion state is **three-valued** (unknown / met / unmet): "not yet judged" is not "failed", and collapsing them would have the dashboard assert a verdict the ledger never issued.

**Defects, all browser-found:**

| id | what |
|---|---|
| `fd345eae` | `POST /missions` typed its body against an erased TS interface — malformed bodies died as unhandled `TypeError` 500s. Now validated against a shared TypeBox object (ADR-0004). |
| — | CORS was never enabled, so the browser blocked the intake POST at preflight. Twenty-five passing jsdom tests were silent on it; jsdom does not enforce CORS. |
| `b3b4e554` | **The live ledger stream was never connected.** `LedgerStreamService.onNotification` was well unit-tested and *nothing called it* — no process opened a Postgres `LISTEN`. No mission had ever streamed; it only looked live because reloading replays the trail. |
| `2e5eaece` | The planner emitted the parent objective as every child. Fixed structurally (a prompt is a request; a schema is a rule). |
| `1e3905a4` | The clarity judge bounced the planner's own objectives, surrendering every multi-subtask mission. Measured the local ladder rather than guessing: 2b 33% false-bounce, 4b 25%, **9b 17%**, 12b 58% — so "raise the tier" was wrong twice over, and the fix was structural (a bounce is a spec fault → re-decomposition, R36). |
| `a910ed8d` | **Decomposition never recursed** — every tree was one level deep, while the dossier claims "thousands of atomic tasks". ADR-0009 records the stop condition and the three rejected alternatives. |
| `5e245281` | The planner hardcoded one criterion per subtask, so under ADR-0009 every child was atomic *by construction* and the new recursion could never fire. Subtasks now **partition** the parent's criteria. |
| `f46ba357` | The ledger recorded which criteria *failed* but never the criteria themselves, nor effort, nor agent version — so "3 of 4 met" had no denominator, and R25/R27/R28 were being specified against facts the trail was not keeping. |

**Outcome:** A mission is now started from the UI, appears in a fleet rail, decomposes into a genuinely nested tree, streams live, and can be inspected down to raw ledger events. 279 tests green across six workspaces; every new distractor mutation-verified — which caught **two vacuous tests of my own**, one written minutes earlier and masked by an unrelated guard.

Three defects this session shared one shape: **a correct, well-tested component that nothing calls** (`04071ce9` worker `main()`, `b3b4e554` the ledger listener, and an unreachable `focus()` that made the breadcrumb permanently empty). Unit tests are structurally incapable of noticing an uncalled function; only running the real processes and driving the real surface finds them. Logged as a global learning.

Still open: `cd18baa0` (closes when R14–R40 are built), and R15 AC-0, which needs dependency edges the planner does not yet declare (R32).
