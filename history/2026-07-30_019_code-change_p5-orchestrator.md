# 019 — P5: the Orchestrator (decompose · contract · fold-up)

**Date:** 2026-07-30
**Category:** code-change
**Phase:** P5 (Tasktracker `9f4eb512-…`) · **Requirement:** R5

**What:** Built the Orchestrator — recursive decomposition into fully-contracted atomic tasks, and fold-up that reconciles children into one result. Plus the model-backed planner and reconciler that drive it.

**Why:** R5. This is the first phase where an LLM actually does Artifex's work rather than being validated by it.

**Details:**
- **The planner proposes; the Orchestrator decides what is executable.** A planner is a model and will happily suggest a task with no acceptance criteria. `decompose()` refuses three classes of proposal outright: ungradeable (no acceptance criteria — *a task nobody can grade is not a task*), overlapping (no declared anti-scope, leaving siblings free to collide), and unaffordable (effort shares summing above 1). These fail loudly at authoring time because by execution time the contract is the only specification that exists (invariant #2).
- **The budget is divided, never copied.** Handing each child the parent's ceiling multiplies spend by the fan-out — the fastest way to bankrupt a mission (invariant #7). The floor scales with the share too: a child given 20% of the work should not inherit the parent's whole minimum-effort obligation.
- **Children inherit what they must not choose for themselves.** `autonomyDial` is mission-level and fixed at intake; `escalationPolicy` and `verificationPlan` come from the parent, because a task does not get to decide how hard it will be checked.
- **Fold-up requires a reconciler, and that is the point.** Children are deliberately kept ignorant of each other (no peer chatter, invariant #6), so nobody else in the system is positioned to notice that two siblings contradict each other. The distractor test asserts the child answers do *not* all survive verbatim — a concatenation would ship both sides of a disagreement as though both were true.
- **Proposal schemas are worker-local, not in `shared-types`.** Nothing outside the Orchestrator ever sees a decomposition proposal; `shared-types` is for shapes that cross a package boundary, and putting every internal shape there would make the dependency-graph leaf a dumping ground.
- **Self-caught bug worth recording:** the deterministic child ids initially sliced the parent UUID at an arbitrary offset, landing mid-segment and producing UUID-*shaped* strings that failed `TaskContractSchema`. Fixed by incrementing the final group. Validating every leaf against the shared contract is exactly what caught it.

**Outcome:** TDD red→green. 35 worker tests, **125 repo-wide**, 20 integration, build + typecheck clean. Mutation-verified: making the child ceiling equal the parent's failed exactly the budget-division distractor with 34 still passing.

**Dogfooded with a real model, on the smallest admitted one** (tier 1 → `ollama/qwen3.5:2b`): decomposed "EV adoption in Europe — market share, charging infrastructure, policy drivers" into three clean non-overlapping subtasks in 36s, all validating as contracts, budget divided 22.5 ≤ 30. Fold-up over deliberately conflicting children produced one deliverable **and detected the planted contradiction** (20% vs 15% market share).

**Honest caveat, logged as a learning:** at 2B the reconciler caught the conflict but its prose was near-incoherent. Fold-up is *evaluative* work, which the P4 tier policy already proposes a rung above the floor — the dogfood simply reused one tier decision for both seams. Convention for P9: **compute the tier per seam**, `generative` for decomposition and `evaluative` for fold-up and Gate B. "Smallest model" is per-seam, not per-task.
