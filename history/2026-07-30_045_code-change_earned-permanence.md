# 2026-07-30 · 045 · code-change · Earned permanence — the clade the comment always described

**What:** Built R28 AC-1 and AC-2, and the lineage machinery for AC-0. Migration 0005 adds `parent_design_id`, `mean_effort` and `validation_harness` to `agent_design`; the repository gains `cladeScoreFor`, `paretoFor` and `reparent`; and `proposeDelta` now refuses to promote a design that carries no harness.

**Why:** `clade_score` has carried the comment *"how this LINEAGE has performed, not one audition"* since P6, while the table had no ancestry at all. It was a per-design running mean — not one lucky audition, certainly, but not a clade either. That is the third time in this project that a comment described something the code did not do.

**Details:**

- **Clade score** walks ancestors with a recursive CTE and takes an **observation-weighted** mean. Weighting is the whole point: a plain average of each design's mean would let one lucky run count as much as thirty. A visited-set guard keeps a cycle finite — ancestry is model-adjacent data, and a cycle must degrade to an answer rather than spin inside a live mission.
- The design's **own** score is deliberately left alone. Promotion reads the clade; a later delta is measured against the design's own record, and collapsing the two would make an individual record unreadable.
- **Pareto front** keeps a design unless another is at least as good on both axes and strictly better on one. Requiring strict betterness somewhere is what stops two identical designs from eliminating each other and emptying the front. Cost is **derived** from `effortSpent`, which the ledger already records on every `task.executed` — not an invented price list. Unproven designs are excluded: unmeasured is not efficient, it is unknown.
- **The harness rule** refuses promotion on *measurability*, not performance. A perfect score from a design nobody can grade is precisely the case the rule exists for, because the number cannot be trusted whatever it says.

**Verification.** 13 new tests against real PostgreSQL; **67 integration + 542 unit green**. Six mutants, each killed: clade as a plain mean (3 tests), clade ignoring ancestors (3), Pareto keeping everything (1), Pareto keeping only a champion (1), dominance ignoring cost so cheap-but-adequate is evicted (1), harness rule removed (2). A seventh, on the composition side, killed the "effort never passed" mutant (1).

**A footgun that cost two live missions.** After wiring the harness and cost, two runs still wrote `NULL` to both columns. The wiring was correct — `grep` confirmed it in `packages/worker/dist`. The cause was that `npm run build -w packages/worker` compiles only the worker, while the repository change lived in `packages/memory-fabric`, whose **`dist`** the worker imports. The running process used a stale compiled repository whose `INSERT` had no `validation_harness` column and whose `recordOutcome` took no `effort` argument; both were passed and silently discarded.

It reads exactly like a logic bug: tests green (vitest imports sources, not `dist`), worker dist visibly contains the change, migration applied, columns present, data still null. **The tell — green tests plus correct dist plus wrong data means suspect a stale sibling package before suspecting the SQL.** Logged as its own insight. After `npm run build --workspaces`, the very next mission wrote both correctly.

**Live evidence** — mission `19095b03`, a splitting two-criterion mission so fresh categories were authored:

| design | category | obs | clade | cost | harness |
|---|---|---|---|---|---|
| `f6d93673` | Technical Writing / Tool I… | 1 | 1.00 | **1.00** | **t** |
| `fc6f929a` | Technical Description / In… | 2 | 1.00 | 0.50 | f |
| `6e25f754` | mission | 9 | 0.89 | — | f |

`f6d93673` is a design registered after the fix: harness stored, cost folded from real effort. The two below it predate it, and registration being idempotent means they never gain a harness — correct, and a reminder that the rule bites retroactively.

Two smaller observations recorded rather than glossed. Folding a first effort into a row created before `mean_effort` existed gives `(0·n + e)/(n+1)` because `COALESCE(mean_effort, 0)` treats missing history as zero cost — hence `fc6f929a` at 0.50; retrofit noise on old rows only. And every single-criterion mission is kept whole by the R31 gate and runs under category `mission`, which is why `6e25f754` accumulated nine observations across bicycle bells, doorbells and anchors: one capability, reused, exactly as intended — but worth knowing when reading the table.

**R28 AC-0 is left unsatisfied** (defect `cb939996`). Its "given" is *a design with ancestors*, and nothing in the running system ever sets `parent_design_id`: `staff()` registers every design as a root, and `reparent` is called only from tests. Ancestry appears when a design is *derived* rather than authored — the Learning Agent proposing a variant (R27) or a ratchet decision that forks a lineage — and neither exists. Consistent with R31 AC-2, R22 AC-1 and R19's learning AC: the mechanism existing is not the same as the criterion being reachable.
