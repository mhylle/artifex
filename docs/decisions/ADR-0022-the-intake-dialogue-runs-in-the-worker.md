# ADR-0022 — The intake dialogue's judged half runs in the worker, not the API

**Date:** 2026-07-31
**Status:** Accepted
**Context:** R30 (intake dialogue), phase P30

## Context

The dossier's Stage 1 specifies a dialogue: *"The intake dialogue interrogates
the requester until the mission has testable success criteria, explicit scope
boundaries, an autonomy-dial setting, and an effort budget."*

Two constraints pull against it. Intake is an HTTP request, and a dialogue
cannot block one. And `packages/api/CLAUDE.md` is explicit: the API validates,
records and enqueues — **it never runs a mission.**

## Decision

**Split the dialogue by what each layer can honestly do.**

**The deterministic half stays in the API, where it already is.** A request
missing an objective, a success criterion, an autonomy dial, boundaries or a
budget is refused with a 400 — the schema enforces the fields and
`MissionIntakeService` refuses an empty objective or criteria list. No model is
needed to know a field is absent.

**The judged half runs in the worker, as the mission's first act.** Whether a
criterion is *answerable as written*, and what is ambiguous about a request, are
judgements requiring a model. They run before anything is decomposed or staffed,
which is what "refuses to start the mission" has to mean: not a late rejection,
but no task tree at all.

**A blocking question stops the mission and reaches a human through machinery
that already exists.** `escalation.awaiting_human` puts it on the attention queue
(R18), the cockpit shows it (R17), and resume-by-replay brings the answer back
(R41). Nothing new was needed for the round trip; intake was simply the producer
those three had never had.

### Why the model call is not in the control plane

A model call at intake would turn a degraded model into a **total intake
outage**. The control plane's job is to accept and record; refusing to accept a
mission because a model is unreachable is strictly worse than accepting it and
asking a moment later. The worker is where model calls already live and where a
failure degrades one mission rather than the front door.

### The dial rule is derived, not invented

Only *low-stakes* ambiguities may be carried, and which dials permit it is read
off semantics this codebase already uses. `requiresRatification` asks nobody
under `autonomous`, asks about consequential acts under `checkpointed`, and asks
about everything short of reading under `supervised`; the mission loop's own
comment holds that *"fully autonomous must mean nobody is asked, or the setting
is decorative"*. A low-stakes ambiguity is not a consequential act, so
`autonomous` and `checkpointed` carry it and `supervised` asks.

A `high`-stakes question blocks under **every** dial. The criterion permits
carrying only low-stakes ambiguities, and an autonomy dial says how much a
requester wants to be consulted — not how much the system may guess about things
that change the deliverable.

### Every question lands in exactly one list

`triageQuestions` partitions. AC-1's demand is that an ambiguity is "never
silently resolved by assumption", and a question appearing in neither list would
be exactly that. The partition makes the guarantee structural rather than a
promise, and a mutant that drops a question into neither list is killed.

## The failure this shipped with, and the fix

The first live vague mission **did not get interrogated**. The model call threw
under concurrent load, the `.catch` returned no questions, and the mission went
straight on to decompose — indistinguishable from a clean interrogation that
found nothing to ask.

Degrading open is the right policy: a model outage must not stop a
well-specified mission. **Degrading invisibly is not.** An unrecorded degrade is
precisely the "silently assumed away" that AC-1 rules out, so the failure now
records `intake.interrogation_failed` carrying the error and its consequence.
The policy is unchanged; the silence is gone.

This was found by re-running rather than by inspection, and it is worth naming:
the first run's evidence and a working mechanism's evidence looked identical
from the ledger.

## Consequences

- **Live, mission `c156bf04`:** two blocking questions raised, `rung:
  intake_clarification` on the attention queue, mission surrendered with *"the
  intake dialogue has unanswered questions"* — and **no `task.contracted` and no
  `decomposition.decided`**. The mission genuinely never started.
- The prompt carries **no example phrasings and no closed vocabulary**, per this
  project's standing rule. It asks what the model would need to know, not for a
  grade: a scoring prompt returns a score, and a requester cannot act on a score.
- **AC-2 is NOT satisfied by this ADR.** A flagged assumption is now recorded as
  `intake.assumption_flagged`, which is the carrier — but nothing yet escalates
  when one becomes load-bearing. The intended trigger reuses an existing signal:
  the worker already declares, per task, the assumptions it answered for itself
  (R40), so an intake assumption that reappears in a task's declared assumptions
  became load-bearing *for that task*, and that is the moment to escalate. Left
  as the phase's remaining work rather than claimed.
