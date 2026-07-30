# 2026-07-30 · 039 · code-change · The planner declares edges — R32 and R15 both close

**What:** Taught the planner to declare which siblings feed which, closing the last gap in R32, and taught the canvas to *name* the task each dependency edge points at, closing R15 AC-0. Both requirements are now fully satisfied and browser-verified.

**Why:** Entry 038 built the scheduler, the contract plumbing and Gate A's cycle refusal, then had to leave R32 AC-1 and AC-2 unsatisfied: `SubtaskOutlineSchema` was still `{ objectives: string[] }`, so the model was never asked about dependencies and every live contract got `consumesTaskIds: []`. Neither criterion's "given" could occur on a real mission. R15 AC-0 was stuck behind the same gap — the canvas had no edges to draw.

**Details:**

`SubtaskDependencySchema` is `{ dependsOn: number[] }` — one producer index per subtask, `-1` for independent. A flat array of integers, deliberately: it is the shallow shape defect `8b7e9e95` demanded, and a nested per-subtask list is exactly the grammar a 2B model runs away inside. The cost is that the *planner* cannot declare a diamond, though the scheduler and Gate A both handle one arriving from elsewhere.

Three decisions in the mapping from declaration to contract:

1. **Indexes are remapped.** Edges are declared against the outline's indexes, but subtasks covering no criterion are dropped before contracts are authored — so an unremapped edge would silently point at the wrong sibling. An edge into a dropped subtask is dropped with it: waiting on work nobody is doing is a mission that can never start.
2. **Self-edges and out-of-range indexes are dropped**; a 2B model will happily name subtask 7 of 2, and carrying it would produce a contract waiting on a task that does not exist.
3. **A cycle between two different subtasks is carried through.** Breaking it in the planner is the tempting fix and the wrong one — the plan would then execute as a silently mangled version of what was proposed, instead of being refused as unexecutable. Gate A audits the plan; the planner reports what it actually decided.

A robustness fix surfaced while wiring it: the planner **crashed** when the model returned an object without `dependsOn`, which a 2B model does routinely. A missing or malformed answer now means "all independent". The dependency graph is the one part of a plan the system can do without, and losing a whole decomposition over an optional field would trade a scheduling optimisation for the work itself.

For R15 AC-0, the canvas had been rendering `after 1` — a count. The criterion says "edges connect each node to its parent and **to the tasks it depends on**", and a number names no connection: an operator could not tell *which* sibling a task was waiting on, which is the only thing the edge is for. `CanvasNode` gained a `labels` input (`taskId` → objective, built from the same projection the canvas draws, so the two cannot disagree) and renders one chip per edge, falling back to the raw id when the producer is not in view — a blank chip would read as "depends on nothing".

**Verification.** 8 new tests; **508 green**. Mutants killed: index remap skipped (1), self-edge allowed (1), planner breaking the cycle instead of reporting it (1), every subtask chained in declaration order so edges are invented (4), the malformed-answer guard removed (1), the canvas back to a bare count (2), an unknown producer rendering blank (1), and — this project's signature defect shape — `labels` never passed from MissionControl, the classic unwired input (1).

**Outcome — browser-verified on mission `0c7360b5`**, whose shape genuinely needs an edge rather than an invented one: *"Write a short paragraph recommending a beginner tea, then critique that same paragraph."* The local qwen3.5:2b declared it unprompted:

| task | `dependsOn` |
|---|---|
| "Write a descriptive paragraph…" | `[]` |
| "Critique the original recommendation…" | `['…9bc839']` |

And the wait was real, and gated on verification rather than completion:

```
17:21:45.718  gate_b.verdict_issued  …9bc839  pass
17:21:45.720  agent.staffed          …9bc83a          ← 2 ms later
```

The timeline lens shows the cost as waited 3s (producer) against waited 10s (consumer) — the differential a genuine edge should produce, against the flat 5s/5s/5s that independent siblings now show. The canvas renders the edge in words: *"after: Write a descriptive paragraph recommending a specific type of tea for a beginner."*

**R32 satisfied** (AC-0 in entry 038; AC-1 and AC-2 here). **R15 satisfied** — AC-0 was its last open criterion. Phases P32 and P15 closed with their sub-tasks.

One honest note on AC-2: Gate A's cycle refusal is verified in tests with distractors proving a diamond, a chain and an outside-the-set edge all still pass, and the check now runs on every live decomposition. The refusal *firing* was not observed live, because real plans are acyclic — the planner can now express a cycle, but no model produced one, and manufacturing one would have been theatre rather than evidence.
