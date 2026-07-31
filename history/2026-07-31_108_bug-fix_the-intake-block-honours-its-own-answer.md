# 108 — The intake block honours the answer it asked for

**Date:** 2026-07-31
**Category:** bug-fix

**What:** Critical defect `2bedadb8` fixed and verified live: the deployed system delivers missions again. R30 AC-2 — the project's last unsatisfied acceptance criterion — is satisfied on live evidence, R30 is satisfied, P30 is complete, and **three of the five doneness pillars are now green** (phases, acceptance criteria, completed-phase integrity). ADR-0023.

**Why:** The intake dialogue could say no and had no channel for the answer that would make it say yes — find-shape (v). Measured live: 9 of 9 interrogated missions blocked at intake, 0 ran work, 0 delivered.

**Details:**

**The cause was a guard that did not match its own stated intent.** The code already said what it meant to do — *"Skipped on resume: the questions are already on the trail, and re-asking them is how a mission that a human just answered would stop again on the same question."* The intent was right. The guard was `!resuming`, and `resuming` is `prior.contracts.size > 0` — "work exists to continue". A mission blocked at intake surrenders **before** anything is contracted, so **the one trail that most needed the skip was the one guaranteed not to qualify for it.**

**Proven closed before anything was changed**, through the real cockpit route rather than a harness:

    POST /missions/63498d62.../control {action:"decide", decision:"approve", note:"..."}
      -> operator.decided (task_id = mission_id) -> mission re-enqueued
    worker: "resuming from 14 recorded events"
      -> mission.started -> intake.question_raised -> escalation.awaiting_human -> mission.surrendered

The operator's answer reached the ledger and changed nothing.

**The fix is the existing rule applied to the site that skipped it.** The intake block *is* an escalation — `escalation.awaiting_human`, rung `intake_clarification`, recorded against the mission task — and `prior.decided`, folded from `operator.decided`, is already this system's single rule for *"a human has answered this escalation, do not stop here again"*. The escalation ladder honours it; intake did not. Find-shape (b) producing find-shape (v).

    const intakeAnswered = prior.decided.has(mission.taskId);
    if (seams.interrogator !== undefined && !resuming && !intakeAnswered) { … }

The source was checked live before the mechanism was wired over it: `operator.decided` carries `task_id = mission_id`, the same id the intake escalation uses. RED first; **3 killing mutants** — `decided.size > 0` kills the different-task distractor, inverting the guard kills 8 tests, dropping it kills the main test.

Three options were weighed in ADR-0023. Contracting the mission before intake (derivable from invariant #2, and task zero really is the only task with no contract event) was rejected *for this purpose* because making `resuming` true also suppresses re-planning and gate re-runs — a broad blast radius for one narrow behaviour, and it would skip intake on any re-enqueue, answered or not. Broadening `resuming` was rejected because the API always writes `mission.intake_accepted` first, so it would have skipped intake on the very first run.

**Outcome:**

808 worker (+3) + 175 + 71 + 54 + 26 green; all six workspaces build; worker restarted and verified (15:53:50 against dist 15:53:49).

**Verified live on the same mission that proved the defect:**

    operator.decided
    mission.started
    decomposition.decided
    agent.staffed
    task.executed                       <- idx 30
    assumption.became_load_bearing  x3  <- idx 31..35
    escalation.awaiting_human       x3
    verifier.staffed
    gate_b.verdict_issued
    mission.delivered                   <- idx 39

**The system delivers missions again.** And `interrogated this run? false` — the interrogation was skipped, so the carried assumptions could only have come from `foldPriorTrail`, which **verifies the previous iteration's fold fix live**, something entry 107 explicitly could not do.

**R30 AC-2 satisfied against every clause of its text**, re-read before claiming: the dial permitted carrying (5 flagged, **all `low`**); the assumption became load-bearing for a task's outcome (`task.executed` at 30, escalations at 31–35); it was escalated at that moment rather than at delivery (delivery at 39).

The 3 escalations were checked as a list, not counted: 5 assumptions carried (3 × `m-1`, 2 × `null`), the nulls correctly never fire because no task is graded on a whole-request ambiguity, and each distinct question escalates once. Collapsing three different questions about one criterion would have hidden two real questions from the operator.

**Two bounds recorded rather than implied.** The ruling's note is not checked against the questions, so an operator who approves without answering gets the mission run — the same trust the ladder already extends to every rung. And a `reject` clears the block exactly like an `approve`; that is pre-existing behaviour shared with the ladder, and it is logged as an **open question, not a defect**, because the requirement text does not settle it and filing a defect would assert more than was measured.

Doneness now: **phases ✓, acceptance-criteria ✓, completed-phase-integrity ✓**; remaining blockers are one low defect (`dd2e9d18`) and the 6 orphaned architecture-drift entries (tooling limit, friction `7ef7a267`).
