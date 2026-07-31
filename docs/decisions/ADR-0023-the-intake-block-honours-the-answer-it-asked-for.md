# ADR-0023 — The intake block honours the answer it asked for

**Status:** Accepted
**Date:** 2026-07-31
**Context:** defect `2bedadb8` (critical), R30 AC-0/AC-2, R41

## Context

The intake dialogue (R30 AC-0) refuses to start a mission while a high-stakes ambiguity is open. That refusal is correct and measured: `343c3fb8` established with 8 trials across two requests differing only in specificity that the live interrogator raises exactly one high-stakes question every time — never zero — and that a *more* specific request raises *more* questions (mean 3.0 → 4.3), because every clause added to pin the request down becomes something else to ask about.

The consequence, measured live: **9 of 9 interrogated missions blocked at intake, 0 ran work, 0 delivered** — including a deliberately well-specified control (*"State in one sentence why ice floats on water"* / *"exactly one sentence and names density as the reason"*), which blocked on two genuinely ambiguous readings of its own criterion.

And the block could not be answered. Proven end to end through the real operator entrypoint before anything was changed:

```
POST /missions/63498d62.../control  {action: "decide", decision: "approve", note: "..."}
  -> operator.decided recorded (task_id = mission_id)
  -> mission re-enqueued
worker: "resuming from 14 recorded events"
  -> mission.started (again) -> intake.question_raised -> escalation.awaiting_human -> mission.surrendered
```

The operator's answer reached the ledger and changed nothing.

## The cause is a guard that does not match its own stated intent

The code already said what it meant to do:

> *Skipped on resume: the questions are already on the trail, and re-asking them is how a mission that a human just answered would stop again on the same question.*

The intent was right. The guard was `!resuming`, and `resuming` is `prior.contracts.size > 0` — "work exists to continue". A mission blocked at intake surrenders **before** anything is contracted, so **the one trail that most needs the skip is the one guaranteed not to qualify for it.** Find-shape (v): a gate that can say no with no channel for the answer that would make it say yes.

## Decision

Guard the interrogation on the answer as well as on the work:

```ts
const intakeAnswered = prior.decided.has(mission.taskId);
if (seams.interrogator !== undefined && !resuming && !intakeAnswered) { … }
```

**This is not a new policy — it is the existing one applied to the site that skipped it.** The intake block *is* an escalation: `escalation.awaiting_human`, rung `intake_clarification`, recorded against the mission task. `prior.decided`, folded from `operator.decided`, is already this system's single rule for *"a human has answered this escalation, do not stop here again"*, and the escalation ladder already honours it. Intake was the one site that did not. Find-shape (b).

Verified live before building, so the mechanism is not wired over an empty source: `operator.decided` carries `task_id = mission_id` for a mission-level ruling — the same id the intake escalation is recorded against.

## Options considered

1. **Contract the mission itself before intake**, so an intake-blocked trail has a contract and `resuming` becomes true. Derivable from invariant #2 ("the mission is task zero"), and task zero is indeed the only task with no `task.contracted` event. **Rejected for now:** it makes `resuming` true, which also suppresses re-planning, gate re-runs and `mission.started` — a broad blast radius to buy one narrow behaviour, and it would make intake skip on *any* re-enqueue, answered or not.
2. **Broaden `resuming` to "any prior event exists".** **Rejected:** it makes `resuming` mean something vaguer than "work exists to continue", and several other paths key off it. It would also have skipped intake on the very first run, since the API always writes `mission.intake_accepted` first — the worker already logs "resuming from 1 recorded events" on a fresh mission for exactly that reason, which is a separate cosmetic lie worth fixing but not by making it load-bearing.
3. **Carry the operator's answer as an input to a re-interrogation.** Attractive, and the only option that lets the interrogator *check* the answer. **Not chosen now** because it needs a way to judge "does this note resolve this question", which is a model call this system does not currently make and which `343c3fb8` showed is easy to get wrong. Option 3 remains open on top of this decision — it would tighten the bound below rather than replace the mechanism.

Option 1 stays on the roadmap for its own sake (task zero having no contract event is an oddity), decoupled from this fix.

## Consequences

- An operator answering an intake block gets the mission run. R30 AC-0's refusal is now *pending a human answer* rather than permanent, which is what "awaiting human" was always supposed to mean.
- R30 AC-2's trigger becomes reachable in production for the first time: a mission that reaches a task can escalate a carried assumption when it becomes load-bearing. Combined with the previous iteration's fix (carried assumptions survive the resume fold), both halves of that path now exist.
- Re-enqueuing without an answer still blocks. This is asserted with a distractor, so "re-enqueue" cannot become a way to launder a mission past intake.

## The bound, stated rather than implied

**The ruling's note is not checked against the questions.** An operator who approves without actually answering gets the mission run. That is the same trust the escalation ladder already extends to every other rung — `decided` inspects no notes either — and inventing a verifier for a human's answer would put the gate above the authority it escalates to.

**A `reject` decision clears the block exactly like an `approve`.** `foldPriorTrail` adds to `decided` on any `operator.decided` regardless of the decision value; that is pre-existing behaviour shared with the escalation ladder, and changing it here would silently change the ladder too. Logged as its own defect rather than left in prose.
