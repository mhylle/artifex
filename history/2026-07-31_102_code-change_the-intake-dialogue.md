# 102 — The intake dialogue asks, and refuses to start

**Date:** 2026-07-31
**Category:** code-change

**What:** R30 AC-0 and AC-1 satisfied on live evidence — a vague mission is interrogated before anything is decomposed, its questions land on the attention queue, and the mission genuinely never starts. AC-2 (escalate a flagged assumption when it becomes load-bearing) is explicitly not claimed. ADR-0022.

**Why:** Stage 1 accepted whatever it was handed. Bad specification is the largest single failure source in multi-agent systems (44%, MAST), and "failing to ask for clarification" is a top-ten measured failure mode.

**Details:**

**The design tension, resolved rather than dodged.** Intake is an HTTP request and a dialogue cannot block one; `packages/api/CLAUDE.md` says the API validates, records and enqueues and never runs a mission. So the dialogue splits by what each layer can honestly do: the **deterministic** half stays in the API, where the schema already refuses a request missing a field, and the **judged** half — is this criterion answerable as written? — runs in the worker as the mission's first act, before anything is decomposed or staffed.

A model call at intake would turn a degraded model into a **total intake outage**. The control plane's job is to accept and record.

A blocking question then reaches a human through machinery that already existed: `escalation.awaiting_human` for the attention queue (R18), the cockpit (R17), and resume-by-replay for the answer (R41). Intake was simply the producer those three had never had.

**The dial rule is derived.** Only low-stakes ambiguities may be carried, and which dials permit it is read off semantics already in the codebase — `requiresRatification` asks nobody under `autonomous`, asks about consequential acts under `checkpointed`, and asks about everything short of reading under `supervised`. A high-stakes question blocks under every dial: a dial says how much a requester wants to be consulted, not how much the system may guess about things that change the deliverable.

`triageQuestions` **partitions**, so every question is blocking or flagged and none can land in neither. That is AC-1's guarantee made structural, and the mutant that drops one is killed.

**The fix did not work the first time, and that is the most useful part.** The first live vague mission was **not interrogated**: the model call threw under concurrent load, the `.catch` returned no questions, and the mission went straight on to decompose — indistinguishable from a clean interrogation that found nothing to ask. A probe importing the real seam from `dist` and calling it *without* the loop's catch returned two high-stakes questions, which is what separated "the model found nothing" from "the model could not be reached".

Degrading open is right — a model outage must not stop a well-specified mission. Degrading **invisibly** is not, and is exactly the "silently assumed away" AC-1 rules out. The failure now records `intake.interrogation_failed` with its cause and consequence. The policy is unchanged; the silence is gone.

**RED-first on the pure function; not on the wiring.** `triageQuestions` had five failing tests before it existed. The loop integration was written before its composition tests, the same inversion as iteration 86, so those six passed on first run and proved nothing by passing. Seven mutants close that gap — including one that never consults the interrogator, one that records the questions and starts anyway, one that carries a high-stakes question, and one that lets a question land in neither list — but mutation-after-the-fact is weaker than RED-first and the order was wrong again.

**Outcome:**

778 worker (+12) + 175 + 71 + 54 + 26 green; all six workspaces build; worker rebuilt and restarted.

Live, mission `c156bf04`, submitted through the API:

    mission.intake_accepted
    mission.started
    intake.question_raised   [m-1] high  "How do you define 'better'? ..."
    intake.question_raised   [m-2] high  "How will we measure if new users find it 'easier'? ..."
    escalation.awaiting_human  rung: intake_clarification
    mission.surrendered      "the intake dialogue has unanswered questions"

No `decomposition.decided` and no `task.contracted` — the mission never started, which is what the criterion asks for rather than a late rejection.

**AC-2 is not claimed.** `intake.assumption_flagged` now records a carried ambiguity, so the carrier exists — but nothing escalates when one becomes load-bearing. The intended trigger reuses an existing signal rather than inventing one: the worker already declares, per task, the assumptions it answered for itself (R40), so an intake assumption reappearing in a task's declared assumptions became load-bearing *for that task*. That is the phase's remaining work.
