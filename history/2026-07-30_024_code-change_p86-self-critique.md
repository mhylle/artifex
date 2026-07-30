# 024 — P8.6: the worker self-critique pass (R12 runtime)

**Date:** 2026-07-30
**Category:** code-change
**Phase:** P8.6 (Tasktracker `6cd1cae1-…`) · **Requirement:** R12 · **ADR:** [ADR-0007](../docs/decisions/ADR-0007-r12-r13-sequencing-and-contract-surface.md)

**What:** Built the self-critique pass. With P2.5's contract surface, **R12 is complete** — and with P8.5, both agentic-pattern gaps identified in ADR-0006 are now closed.

**Why:** R12. A specialist critiques its own draft against its acceptance criteria before the Reviewer sees it.

**Details — everything shaped by one constraint:** *self-review must never become self-verification.* ADR-0006 warned this feature would drift into a second, non-independent Reviewer, so:
- the pass emits a `ReflectionRecord`, which by construction has no `gate`, `outcome` or `verdictId`;
- **`gateBRequired` is an unconditional literal `true`** — there is no branch in which a clean critique short-circuits review, and a test exists specifically so a future change would have to fight it;
- the pass is handed a `WorkerContractView` and **validates it as one**, so it never sees the verification plan it would otherwise learn to satisfy instead of the objective;
- the event is filed under **`execution`, not `verification`**, keeping that family exclusively the Reviewer's — the constraint lives in the taxonomy, not only in prose.
- Same invented-criteria refusal as the Reviewer: a critique naming criteria the contract never had is critiquing a different task, and a reflection built on invented criteria would revise the deliverable toward a standard nobody agreed to.
- Reflection spends the contract's **existing** budget, attributed via `effortSpent` — no second budget, no new cap.

**Outcome:** TDD red→green. 99 worker tests, **189 repo-wide**, 29 integration, build + typecheck clean. Mutation-verified: making `gateBRequired` conditional failed exactly the "a clean critique does not mark the work verified" distractor.

## The finding that matters more than the passing tests

Dogfooded with a real model at the worker's own tier. Every mechanic passed — and the model **diagnosed correctly then repaired destructively**:

```
draft:    "European EV market share was 22% in 2024."
critique:  ac-1 MET   ("% and Year present")
           ac-2 UNMET ("No named source citation found")   <- correct
revision: "European EV market share was 5% in [Source Name]."
```

It corrupted a correct figure (22% → 5%) and broke `ac-1`, which its own critique had just marked met.

**Why that is serious rather than amusing.** R12's justification is economic: a same-tier self-pass is cheaper than a Gate B rejection plus an escalation rung. A pass that *regresses* the deliverable inverts the argument — it spends budget to make the work worse and then still pays for the rejection. **Reflection that regresses is worse than no reflection.**

**What the design got right:** because `gateBRequired` is unconditional, the corrupted answer is caught rather than shipped. The failure is expensive, not unsafe — a genuine vindication of refusing to let a clean critique short-circuit review.

Logged as **high defect `cd677737`** with three candidate fixes (self-consistency guard, split diagnose/repair across tiers, constrain the revision to the criticised criterion). None chosen here: it changes what the pass does. Hypothesis, untested on one sample — **diagnosis and repair are different capabilities**, and running both at the worker's tier assumes they are the same job. Must be settled before P13, where a regressing reflection would quietly degrade the mission result.
