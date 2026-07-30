# 2026-07-30 · 037 · code-change · Audience scoping, and a doneness gate that had been measuring the wrong repository

**What:** Built R22 (audience scoping — operator, requester, learning observer), and fixed the architecture-drift pillar, which had been reporting on a different codebase entirely.

## The drift pillar was measuring Tasktracker, not Artifex

`getProjectDoneness` and `scanArchitectureDrift` walk the local repo from `repoRoot`, which **defaults to the MCP server's own `process.cwd()`**. Nobody had ever passed it. The gate had been inventorying *Tasktracker's* backend and diffing it against Artifex's components, reporting **241 drift entries** naming files like `backend/src/architecture/architecture-component.entity.ts`. Artifex has no `backend/` directory at all.

With the correct root the real drift was **10**: missing 1, orphaned 6, stale 3. Fixed by registering `packages/api/src/cockpit.service.ts` as a new **Cockpit Actions** component (a genuinely uncited R17 service), registering the untouched `nest new` scaffold as **API Root Endpoint (scaffold)** under its true description rather than dressing it up as designed architecture, and refreshing two stale components. That took it to missing 0, stale 0. Logged as defect `80e8561a`, resolved.

**Six orphaned entries remain and are carried, not worked around.** The walker inventories only NestJS-convention filenames — **7 of Artifex's 142 source files**. Proved with a temporary probe component citing two files that both certainly exist:

| cited file | verdict |
|---|---|
| `packages/api/src/ledger-stream.service.ts` | in inventory |
| `packages/worker/src/mission-loop.ts` | **orphaned** |

Same scan, same repo — the discriminator is the filename convention, not existence. So the whole worker, dashboard, shared-types, model-router and memory-fabric are invisible to it, and the Dashboard component's six *accurate* code references are permanently counted as drift. The only way to zero the pillar from inside the project is to delete truthful references from the architecture model — documenting a lie to make a gate green, which is the same failure shape as `cd18baa0`. Carried on its own friction insight; the honest fix belongs in the walker.

Also closed `cd18baa0` itself against its own stated condition: R14–R41 now exist as requirements with ~93 criteria, and the gate refuses `done: true` while reporting real blockers.

## R22 — one substrate, three audiences

`audience.ts` is a pure function from audience to scope: which missions, which lenses, whether the raw ledger and attention queue are reachable, and **which actions may be sent**. One answer to "what may this audience do", rather than one answer per template that draws a button and another where the action is dispatched — the R20 read-only lesson restated. `mayAct` fails **closed**: anything not explicitly granted is refused, including an action name that does not exist.

`requester-view.ts` projects the requester's own mission. It works only because criteria are **partitioned, never invented** — a child task carries its parent's own `criterionId`, verified against the real trail (`m-1`/`m-2`/`m-3` reappearing verbatim on three subtasks). That is what makes it possible to report progress against *the mission contract's* criteria rather than internal task counts. Had decomposition minted fresh ids, this projection could not exist.

The requester gets their own surface rather than the operator's with pieces hidden — a distinction my own distractor test caught: the first implementation left the inspector rendering "INTERNAL bulb subtask" to the requester.

**Assumptions are reported as `null` (unavailable), never `[]`.** No event carries them — logged as defect `d0d555db` — so **AC-1 is left unsatisfied**.

**Verification.** 27 new tests; 485 green across the workspaces. Six mutants, all killed: `mayAct` failing open (5 tests), observer granted every action (2), `assumptions: []` (2), findings ignored so any verdict counts as met (1), the audience guard removed from the send path (2), `activeLens` ignoring the scope (1).

Browser-verified against real mission `acd482c3`:

- **Requester** — three mission criteria all ✓, "budget 3 used of 40 granted", the honest assumptions note, and their two powers (grant budget, adjust dial). The real trail had *four* staffings and an escalation; the requester correctly sees three criteria. Confirmed absent: operator mission section, canvas, inspector, scrubber, attention queue, all lens buttons.
- **Observer** — exactly one lens button ("learning"), **zero** cockpit buttons, "Read-only. A learning observer measures the system and does not steer it", no attention queue, no ledger explorer.
- **Operator** — all five lenses, attention queue, scrubber, canvas, fleet totals (44 missions · 10 running · 125 agents · 83 tasks today).

**Outcome:** R22 AC-0 and AC-2 satisfied; AC-1 open pending R30/R40. Phases P14, P16, P18, P21 closed — they had been left `pending` despite every criterion being satisfied and browser-verified, the same system-of-record drift as the requirement statuses corrected in entry 036.

One decision recorded for the owner: the requester's mission is chosen from the rail, because identity is out of scope until the security boundary is lifted. The picker stands in for "yours" and says so on screen; when authentication exists, identity replaces it.
