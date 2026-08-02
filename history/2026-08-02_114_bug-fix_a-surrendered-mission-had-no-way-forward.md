# 114 — A surrendered mission had no way forward

**Date:** 2026-08-02
**Category:** bug-fix

**What:** The owner's first mission on the clean system surrendered and offered nothing to do about it — *"it says surrendered but there is no actions for me on it and it just seems to have stopped"*. Correct diagnosis, real gap. A surrendered mission now offers **Retry with what we learned**, which reopens the request for editing and carries the surrender dossier into the new mission.

**Why:** Two mechanisms that both exist reached each other nowhere.

**Details:**

**Why it surrendered was right.** Mission `d73bf7c9` ("Come up with algorithms for creating stem cell research") blocked at intake, the owner answered it, it resumed and decomposed — then **Gate A rejected the plan twice**:

- *"Task … is not atomic: requires two distinct responsibilities, 'identifying' and 'modeling'"*
- *"Criterion ac-1 is not testable as written: 'Completeness' and 'Accuracy' are subjective; the grader's judgment is required rather than an objective observation"*

It re-split from the verdict, was rejected again, and surrendered rather than execute a plan Gate A had refused. That is invariant #3 working.

**Two separate gaps made it a dead end.**

**First, find-shape (c) — a mechanism on only one of several paths.** An intake block records `escalation.awaiting_human` *and* surrenders, so it reaches the attention queue and can be answered. A Gate A surrender records only `mission.surrendered`. Same outcome, no queue entry, nothing to act on. The attention queue was genuinely empty while a mission sat stopped.

**Second, find-shape (l) — a correct mechanism with no production caller, the sixth in this project.** `POST /missions` has always accepted `priorMissionId`, read the prior mission's surrender dossier off the trail, and pinned its `whatItWouldTake` into the new contract as `pinnedDecisions` — which *every child inherits*, so the planner and each worker start from the prior blockers instead of rediscovering them (R37 AC-2). The dashboard had never sent it.

The dossier was checked before anything was built on it, and it was not empty:

> *"Relax or restate: '3 diffferent algorithms that cam be used to research stem cells and a report describing them' — no verification ever met it."*

That is the owner's own criterion, and the system's own remedy, stated in the system's own words.

**Approving a surrender would have been theatre**, which is why the fix is not "put it in the queue with an Approve button". You cannot approve past a criterion no verification could meet — the mission would fail the same gate for the same reason. Restating it is the remedy, so the retry **reopens the request for editing rather than resubmitting it**, and that distinction has its own mutant.

**Outcome:**

816 + **214** (+6) + 71 + 54 + 26 green; all six workspaces build. Verified in the browser against the owner's actual mission: the button appears on the surrendered mission, and clicking it loads the objective and criterion into the New tab.

**One mutant survived the first round, and it mattered.** Dropping `priorMissionId` from the HTTP body passed all 212 tests — the component tests stub `MissionIntake`, so they prove the field reaches `submit()` and nothing about what goes on the wire. The retry would have looked like it worked while the dossier was never pinned: exactly the silent-no-op this project keeps finding. Two wire-level tests on the real service now cover it, including that the key is **omitted** rather than sent as null on an ordinary draft, since the control plane tests `typeof === 'string'`.

**Deliberately not done:** a Gate A surrender still records no `escalation.awaiting_human`, so it still does not appear in the attention queue. Whether it should is a real question — the queue means "waiting on a human", and a surrendered mission is *stopped*, not waiting — and answering it needs a decision about what the queue is for, not a reflex. Recorded as an open question rather than half-built here.
