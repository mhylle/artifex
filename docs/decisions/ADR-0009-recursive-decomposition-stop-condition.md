# ADR-0009 — When decomposition stops recursing

**Status:** Accepted · **Date:** 2026-07-30 · **Supersedes:** nothing · **Relates to:** defect `a910ed8d`, R15, R31, R32

## Context

`decompose()` was called exactly once, on task zero, and never on a child. Every mission tree Artifex had ever produced was one level deep — while `solution/index.html` claims the system "shatters [a mission] into **thousands** of atomic, individually verifiable tasks" and `lifecycle.html` specifies that the Orchestrator "**recursively** splits the mission into subtasks… until each leaf carries exactly **one responsibility** with **one verifiable outcome** — and no further."

Two children is not thousands, and one level is not recursion. Pillar 1 ("atomize, then verify") is the design's entire reliability argument — the MAKER result about million-step reliability rests on maximal decomposition — so this was not a cosmetic gap.

Making it recurse requires answering a question the flat version never had to: **when does splitting stop?**

## Decision

Splitting stops on **atomicity, measured by the contract's own acceptance criteria**:

> A contract carrying a **single acceptance criterion** is a leaf.

Plus a terminating guard derived from the same place:

> Recursion may not go deeper than the **mission's acceptance-criterion count**.

## Why this and not the alternatives

**Rejected: a depth constant (`MAX_DEPTH = 5`).** The project principle is "no arbitrary caps anywhere". A constant would be a number nobody could defend, and it would be wrong for both a two-criterion briefing and a thousand-task audit.

**Rejected: a budget floor.** Attractive — effort is a currency, and `decompose()` divides the budget on every split — but it does not actually terminate. `orchestrator.ts` scales *both* floor and ceiling by `effortShare`, so their ratio is invariant under splitting and no descendant ever becomes "too poor to split". Using budget would have required inventing a separate minimum, which is the constant again wearing a different hat.

**Rejected: asking a model "is this atomic?".** It is a gate-style judgement, and this project has now measured twice that such judgements are unreliable and not monotonic in model size (learnings `e9fe3157`, and the clarity-judge measurement behind `1e3905a4`: 2b 33% false-bounce, 9b 17%, 12b 58%). Putting recursion's termination in the hands of a stochastic judge would make tree shape non-deterministic and replay dishonest.

**Chosen: the criteria count.** It is the dossier's own definition of a leaf, restated in code — "one verifiable outcome" *is* one acceptance criterion. It is deterministic, so a decomposition replays identically from the ledger. And it terminates by construction: a split must partition its parent's criteria, and one criterion cannot be partitioned further.

The depth bound is belt-and-braces for the one case the criteria rule does not cover — a planner that keeps *inventing* multi-criterion children rather than partitioning the ones it was given. A mission with `n` criteria cannot meaningfully split more than `n` levels, so `n` is the bound, and it comes from the contract rather than from us.

## Consequences

- Trees now have real depth, so R15's parent edges, collapse/expand and breadcrumb have something to draw, and R32 (parallel execution across the dependency graph) becomes meaningful.
- **Tree shape is now a function of how the planner distributes criteria.** A planner that gives every child exactly one criterion produces a two-level tree; one that partitions a large criteria set produces a deep one. That is the correct lever — depth should follow the work, not a setting.
- Fold-up is genuinely recursive: every non-leaf assembles its children and faces Gate B like any other task, which is what "integration is the decomposition tree walked backwards" means.
- **This ADR is superseded the moment R31 lands.** The decompose-or-delegate gate is the designed decision-maker for "split or keep whole", including the case this rule cannot see: work that is *inherently sequential and constraint-entangled*, which is measurably damaged by splitting (−39% to −70%) even when it has many criteria. The criteria rule is a floor, not the final answer.
- Re-measure the duplicate-subtask guard (`2e5eaece`) at depth: the planner is now asked to split shorter, more abstract subtask objectives than the mission objectives it was tuned against.
