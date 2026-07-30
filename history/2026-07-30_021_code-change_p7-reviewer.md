# 021 — P7: the Reviewer (Gate A · Gate B · structured verdicts)

**Date:** 2026-07-30
**Category:** code-change
**Phase:** P7 (Tasktracker `5b302a75-…`) · **Requirement:** R7

**What:** Built both verification gates — Gate A (coverage, before execution) and Gate B (completion, after) — emitting structured verdicts that become immutable on the ledger.

**Why:** R7, and invariant #3: verify both ends.

**Details:**
- **The judgement is delegated; the bookkeeping is not.** Both gates take a judge seam because coverage and completion are semantic questions. But a judge is an LLM, and an LLM asked to assess five criteria will sometimes return four. If the gate trusted the list it was handed, a silently-skipped criterion would read as a pass — **the gate would stop gating while still reporting success**. So both gates iterate the *contract's* criteria, never the judge's answer.
- Two rules the judge cannot bend: an **unassessed or unmentioned criterion is a failure**, never an implicit pass; and a judge reporting criteria the contract never had is **rejected outright**, because a judge inventing criteria is grading a different task.
- **An uncovered criterion is a `specification_fault`, not an execution error.** The error class picks the escalation rung, and retrying a task that was specified wrong just burns budget rehearsing the same mistake — a spec fault jumps straight to re-decomposition.
- **Gate B records the verification depth the contract demanded**, never one the reviewer picked for itself.
- **Immutability is not a property of the verdict object** — it is a property of the append-only ledger it goes to. So the only honest test is to append one and then try to change it.

**Outcome:** TDD red→green. 59 worker tests, **149 repo-wide**, 29 integration, build + typecheck clean. Mutation-verified: making an unmentioned criterion count as covered failed exactly the "silence is not coverage" distractor, 58 still passing.

The strict typecheck earned its keep again, catching two type-unification faults the passing tests had gone straight over — mismatched `flatMap` branch types, and a hand-rolled ledger-event return type that had drifted from `LedgerEventInput`.

**Dogfooded with a real model on the compose stack.** Gate work resolved to **tier 2 → `gemma4:12b`**, correctly applying P4's rule that evaluative work floats above the floor — the per-seam tier convention recorded in P5 is now being exercised rather than merely documented. Gate A failed a deliberately incomplete decomposition and named the uncovered criterion `m-2`; Gate B returned a structured verdict on a leaf.

**R7 AC-2 proven, not asserted:** the verdict was appended (seq 16), then raw-SQL attempts to flip its outcome to `"pass"` and to delete it were **both rejected** by the append-only triggers, and it read back unchanged.
