# 2026-07-31 · 066 · code-change · One constant, four blocked things — `effortSpent` becomes a measurement

**What:** `effortSpent` was a hardcoded `1` in the runtime's work seam. It is now the number of model calls the task actually made.

**Why one constant mattered.** It was load-bearing in four places at once, none of which could work while it was fixed: R40's effort floor only binds for floors ≥ 2 and the intake default is 1; R34's mechanical tier compared it to the ceiling and could never trip; R37's pedigree reported `spent: 1` per task on every live mission; and — the one found by driving rather than reading — **nothing could exceed its ceiling**, so `budget_exhaustion` was unemittable, so `agent_redesign` was unreachable, so `parent_design_id` stayed null and R28 AC-0 could not close.

**Derived, not invented.** The model-router does not surface token usage, so the honest unit is model calls — and that is the unit the codebase already implied, since `self-critique.ts` has always added its own calls to the same total. No new plumbing was needed.

Two decisions worth stating. Counted **per execution**, not per process: a shared counter would make every later task look costlier than the one before, and the ceiling would trip on *position* rather than on cost. And a **failed** call still counts — charging only for successes would make a task that burned its budget on failures look cheap, which is exactly backwards, since the budget bounds what was *spent*, not what worked.

**A comment-vs-code disagreement the distractor found.** Writing "a failed call still costs effort" exposed that a throwing assumptions call took the **whole execution** down with it — losing an answer already in hand. `AssumptionsSchema`'s own comment had always said a failure there "loses a nicety rather than the work". The comment was the requirement; the code was the defect. Now wrapped, and still charged.

**Proven live against the real database:** all **108** prior `task.executed` events carry `effortSpent: 1`. A mission run after the change carries **2**, and the pedigree's budget accounting reflects it.

**Honest about the size.** A plain task now costs 2 against a default ceiling of 20, so budget exhaustion still needs a much lower ceiling or a task that escalates repeatedly. This is a real measurement rather than a constant — which is the point — but it is not yet a *large* one, and `e758f460`'s reclassification will need a mission shaped to actually overspend.

**Verification.** 3 new tests, 498 worker + 66 green, full workspace build, live before/after across 108 historical rows.

**Outcome:** the chain is unblocked; `e758f460` is now safe to fix, which in turn unblocks P28b and R28 AC-0.
