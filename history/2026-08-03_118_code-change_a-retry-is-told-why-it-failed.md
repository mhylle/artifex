# 118 — A retry is told why the last attempt failed

**Date:** 2026-08-03
**Category:** code-change

**What:** When a task fails Gate B, the retry now receives the reviewer's findings. It previously received the original contract and nothing else — so it could not know it had failed, let alone why, and produced the same kind of answer while the escalation ladder burned a rung discovering that.

**Why:** The owner, reading a bounced task with the reviewer's diagnosis printed on screen:

> *"since it actually specifies that it did not do the job, why does it not then actually do the job, i.e. update the tasks it is doing to actually do the job"*

The system had reviewed its own work and said precisely what was wrong — *"conflates 'biological models' (Clonal Expansion), 'laboratory protocols' (CRISPR-Cas9), and 'computational tools' (Machine Learning) into a single category of 'algorithms'"* — recorded it on the ledger, and then threw it away.

**Details:**

**The rule already existed, at exactly one site.** `decomposition.resplit` re-splits *"FROM the verdict rather than retrying blind. Re-proposing from the same objective very often reproduces the same plan."* That is the same sentence about the same problem one level up. Gate A's verdict fed its retry; Gate B's did not. Find-shape (b) — a rule implemented inline at one site while its siblings ignore it.

The chain was three links, each intact and none connected: the reviewer produced findings, `record()` put them on the trail, and `runSpecialist` was called with `contract: workerView` and no channel for them.

**The fix.** `SpecialistWork.execute` gains `priorFindings`; `runSpecialist` passes it through; the work seam puts it in the prompt **first**, ahead of the criteria — the criteria say what is wanted, the findings say what has already been refused. The mission loop holds the last verdict's findings across attempts and hands them to the next one.

Empty and absent both read as *no prior failure*. Gate B can fail a bundle on red flags with no findings, and a heading with nothing under it would tell a worker it failed while refusing to say why — worse than silence. That has its own distractor, as does the first attempt, which must not be told to defend against a criticism nobody made.

**Outcome:**

831 worker (+6) + 250 dashboard + 58 api + 71 + 54 + 26 green; all six workspaces build.

The seam tests prove the prompt carries the findings. The **composition** test proves the loop actually passes them — this project has found six mechanisms that were correct and unreachable, so the producer gets its own test. Two mutants: the loop not passing them, and the loop capturing them as empty. Both killed.

**The bound, stated rather than implied: this is proven by test, not live.** The verification mission bounced three times at the clarity judge and never reached execution, so the Gate B retry path was not exercised against real models. What that run *did* show is that **bounces, not Gate B failures, are the dominant failure mode** on this stack — and the bounce path already feeds its diagnosis back through the `Clarifier` into `task.recontracted`. The gap this fixes is real and the mechanism is proven; its live behaviour on a Gate B failure is still unobserved.

**What this does not fix.** A retry that knows why it failed is not the same as a retry that can do better. The tier-1 model confusing a methodology with an algorithm will still confuse them, now with the objection quoted at it. Whether being told changes the answer is exactly the sort of claim this project refuses to assert without measurement, and it has not been measured.
