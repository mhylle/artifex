# 2026-07-30 · 038 · code-change · Parallel execution across the dependency graph — the stall the timeline measured is gone

**What:** Built the scheduling half of R32. `runSubtree` no longer walks its children in declaration order; it runs every child whose declared inputs are satisfied at once, waiting only where a real dependency edge exists. Gate A now refuses a cyclic dependency graph. `ProposedSubtask` gained `consumesIndexes`, which `authorContracts` turns into `dependencies.consumesTaskIds`.

**Why:** The contract had carried `dependencies.consumesTaskIds` since P1 and nothing consumed it. Entry 036 measured what that cost: on a real three-criterion mission the timeline lens showed sibling waits of **3s / 11s / 19s** against runs of 7s/8s/7s — each lane queued behind the sum of its predecessors. That measurement, not an assumption, is what justified this work, and it is what verifies it.

**Details:**

The per-child body of `runSubtree` — staff → execute → Gate B → escalate, about 290 lines with four early exits — was extracted into `runChild`, returning a small `ChildOutcome` (`done` / `skip` / `fail`) instead of returning out of the enclosing loop. The scheduler then runs in waves:

- A child is ready when every id in `consumesTaskIds` that belongs to this sibling set is **verified**. An edge pointing outside the set is ignored — a contract may legitimately consume something from elsewhere in the tree, and only these siblings are being scheduled here.
- An edge is satisfied by **passing Gate B**, never by merely finishing. Starting on an unverified input is starting on work the reviewer may still withdraw.
- If a wave is empty while work remains, the mission **surrenders naming the blocked tasks** rather than waiting forever. A scheduler that hangs tells the operator nothing.
- Every outcome in a wave is folded in **before** any failure returns, so a sibling verified alongside a failing one stays verified in the trail. Losing it would make resume (R41) redo work the ledger already paid for.
- Fold-up receives siblings in **declaration order**, not completion order, so the same mission cannot assemble differently on a re-run.

Gate A's cycle check is depth-first with an explicit *on-stack* marker rather than a plain seen-set. That distinction is the whole algorithm: a node seen again on the current path is a cycle; a node seen again on a different path is a shared dependency. Conflating them rejects a **diamond** — two independent tasks feeding one consumer — which is the most common legitimate shape there is. The check runs before the coverage judge, because a plan that cannot execute should not cost a model call to reject.

**Verification.** 8 new tests; **496 green** across the workspaces, with all 208 pre-existing worker tests passing unchanged through the refactor. Concurrency is asserted with a latch that only opens when both children are inside `work` simultaneously — under sequential execution the first caller waits for a second that cannot arrive, so the bug manifests as a deadlock, guarded by a timeout so it fails fast rather than hanging.

Mutants killed: scheduler ignoring declared dependencies (3 tests), one-task-per-wave i.e. sequential again (2), cycle detection removed (2), cycle check using a plain seen-set so a diamond is rejected (4), and appending outcomes on completion so fold-up sees completion order (1).

Two honest notes on the mutation pass. One mutant I wrote for "an edge is satisfied by execution rather than Gate B" was malformed — it was a no-op and killed nothing; that property is actually covered by the ignore-dependencies mutant. And the fold-order mutant initially **survived**, revealing that nothing tested the determinism the code claimed: `Promise.all` already preserves wave order, so the explicit re-map looked redundant. A test was added, and it kills the realistic wrong implementation (appending as each child settles) while confirming the explicit ordering is what protects it.

**Outcome — browser-verified.** A fresh three-criterion mission (`b19c58a8`, real Ollama, real Postgres, driven through the cockpit):

| | before (mission `acd482c3`) | after (mission `b19c58a8`) |
|---|---|---|
| waits | 3s · 11s · 19s | **5s · 5s · 5s** |
| staffing spread | — | all three within **24 ms** |

The waits no longer grow with lane index. The remaining uniform 5s is shared staffing latency, not queueing — which is exactly what "anything not dependent on anything else is free to run in parallel" should look like.

**R32 AC-0 satisfied. AC-1 and AC-2 deliberately left unsatisfied** (defect `11befcf8`): `SubtaskOutlineSchema` is still `{ objectives: string[] }`, so the model is never asked which subtasks consume which, and every live contract ends up with `consumesTaskIds: []`. Both criteria are verified at the loop and gate level — including distractors proving the wait is a real edge rather than declaration order (a *later* sibling can be the producer), and that a diamond, a chain and an outside-the-set edge all still pass Gate A — but neither "given" can occur on a live mission yet. The guard is worth having regardless of the planner: contracts also arrive from a resumed trail, so Gate A must refuse a cycle whatever authored it.

R15 AC-0 (canvas dependency edges) stays open for the same reason — the canvas can only draw edges the planner declares.
