# 103 — The load-bearing trigger is built, and its given has never occurred

**Date:** 2026-07-31
**Category:** code-change

**What:** R30 AC-2's mechanism built, wired and mutation-proven — a carried assumption escalates at the task that is graded on it, not at delivery. **AC-2 is left unsatisfied**, because measurement showed its given has never occurred: the interrogator has never returned a low-stakes question, so nothing is ever carried.

**Why:** The trigger planned at the end of iteration 88 was to match a flagged assumption against the assumptions a worker declares for itself. That premise was measured first, and it failed.

**Details:**

**The planned trigger was refuted before it was built.** 105 of 240 `task.executed` events carry declared assumptions, so there is fuel — but they are free-text prose in the worker's own words ("The company has no employees who have been onboarded for more than one year prior"), and an intake question is free-text prose in the model's ("How do you define 'better'?"). Matching one to the other by string or token overlap is the *measurement tool that lies* shape, and this project's own rule is to judge against criteria and never diff strings.

**What replaced it is structural and already computed.** Every intake question is raised `about` a specific criterion, and child contracts carry their parent's criterion ids through the coverage partition. So an ambiguity about `m-1` is load-bearing exactly when a task carrying `m-1` produces its outcome — no model call, no string matching, and the moment is the task's rather than the delivery's. The escalation fires immediately after `task.executed`, which also matters because **a mission that surrenders never reaches delivery at all**, so an escalation deferred to fold-up can be one that never happens.

The bound is stated in the source rather than implied: this fires when the ambiguity is about a criterion the task is *responsible for*, which is not the same as proving the work leaned on it. It is the strongest signal available without a model call, and it errs toward telling the operator.

**RED first, including the composition test.** That discipline had slipped three times — the pure rule tested first, the loop wiring not — and this time both were written before the implementation and both failed first. 6 mutants killed: the carrier never filled, nothing escalating, every carried assumption escalating regardless of the task, re-escalating on every later task, returning only the first match, and nothing reaching the attention queue.

**Then the measurement that decided the outcome.** A live mission with two clear criteria produced no questions at all — correct behaviour, and the given unreached. So the interrogator seam was called directly from `dist` on **eight requests**: three well-specified, and five with genuinely inconsequential open details (a haiku's season, a leaflet's tone, a handbook's cover colour). **Zero questions of any kind.**

Across the entire ledger:

    intake.question_raised          = 2      (both stakes: high)
    intake.assumption_flagged       = 0
    assumption.became_load_bearing  = 0

The seam behaves as a binary: it asks nothing, or it asks something blocking. The `low` half of `stakes` is a name in the vocabulary with no observed behaviour.

**Outcome:**

788 worker (+10) + 175 + 71 + 54 + 26 green; all six workspaces build; worker rebuilt and restarted, with the restart verified against the dist mtime before any live measurement was trusted.

**R30 AC-2 remains unsatisfied, and P30 remains open.** A mechanism existing is not the same as the criterion's given being reachable. This differs from ADR-0015's R13 AC-0 in a way worth keeping straight: that given was unreachable *by construction*, with no code path able to produce it. This one has a proven path and an unproven judgement — a mechanism can be complete and its prompting unproven, which is the second such case in three iterations.

Logged as defect `bf766244` with two unmeasured hypotheses for whoever takes it next, and an explicit warning not to fix it by putting example phrasings in the prompt.
