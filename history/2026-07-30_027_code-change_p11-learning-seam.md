# 027 — P11: the Learning seam (read-only projection + propose-only emitter)

**Date:** 2026-07-30
**Category:** code-change
**Phase:** P11 (Tasktracker `808ff1cf-…`) · **Requirement:** R11

**What:** The Learning Agent's two seams — a read-only projection over the audit ledger, and a propose-only emitter that cannot amend the Constitution.

**Why:** R11, and invariant #4 — *the learner does not own the yardstick*. This is the one guarantee whose silent erosion would make every other measurement in the system meaningless.

**Details — both acceptance criteria are about what the learner CANNOT do, so both are enforced structurally:**
- **The projection narrows whatever it is handed to a single `replay` capability** in its constructor. Even given a full repository, no write path is retained. Crucially, read-only is proven **behaviourally** — the test hands it an object that *does* have `append` and asserts it is never called. A type annotation is a promise; an unused capability is evidence.
- **`CONSTITUTIONAL_CORE` is `Object.freeze`d, not merely commented.** "We promise not to edit this" is an intention, not a guarantee. A learner that could edit the yardstick would make every measurement unfalsifiable, so the object refuses.
- **A proposal may *target* the constitution.** That is not a loophole — it is the amendment protocol working. The learner is allowed to argue that a rule should change. What it cannot do is *make* the change: there is deliberately no `apply`, `amend` or `adopt` method. **The distinction between arguing and acting is the whole design.**
- Every proposal carries `status: 'proposed'` and `appliedBy: null` in its payload, so the record itself states the constraint rather than relying on the code that produced it. An unargued proposal is refused — an opinion without evidence is noise.

**Outcome:** TDD red→green. 126 worker tests, **234 repo-wide**, 29 integration, build + typecheck clean. Mutation-verified: un-freezing the core failed exactly the frozen-core distractor, 125 still passing.

**Dogfooded against the real ledger** with a genuine mission trail (fail → escalate → pass):
```
projection handed the FULL repository (which HAS append) → ledger count unchanged
mined from real events: gate B 1/2 · 1 escalation · 1 tier bump · execution_error ×1
                        design d-research staffed twice at tiers [1,2]
proposal landed as a learning event, status=proposed, appliedBy=null
it TARGETED the constitution — and the constitution was byte-identical afterwards
direct assignment to the core was refused outright
```

The AC-1 check is the one worth naming: read-only was proven against the **real repository**, behaviourally, not by a type annotation that a future edit could quietly widen.
