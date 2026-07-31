# 106 — A criterion is not an identifier for a question

**Date:** 2026-07-31
**Category:** bug-fix

**What:** Defect `ddcaa17d` resolved — intake questions now carry a criterion id resolved against the contract, so a carried assumption can be matched to the task graded on it. Fixing it introduced a second key-space mismatch, caught live within the same iteration and also fixed. `intake.assumption_flagged` went **3 → 7** with low verdicts finally reaching their questions. R30 AC-2 remains unsatisfied, now blocked by a newly-measured tension between two correct behaviours.

**Why:** The carrier worked but the trigger could not consume it: the model answered `about` with free-text phrases while `loadBearingNow` matched criterion ids.

**Details:**

**Measured before building, as the defect asked.** Four runs per case against the real backend, asking for the criterion as its own field with the ids listed in the brief:

    one criterion:   15/16 questions carried a REAL criterion id
    two criteria:     8/17   (the rest: "general", "Scope_Note", "SCOPE / General")

So the model returns a real id when the question maps to a criterion and invents a label when it does not — about half the time on a two-criterion request. That is reasonable: many ambiguities are about the request as a whole. **Forcing those onto a criterion would be false precision; dropping them would lose a real ambiguity.** So an unresolvable id becomes `null`, the question is still raised and carried, and it simply never becomes load-bearing — with `tiedToCriterion` recorded so an operator sees that stated rather than inferring it from an escalation that never arrives.

**Then the mistake, made and caught inside one iteration.** The stakes call was keyed on the question's `criterionId`. Once resolution made every question about one criterion share that id, the verdict map collapsed onto a single entry and the rest defaulted to `high`. Live: **16 questions raised across three missions, every one `high`, every one `m-1`, and the flagged count did not move.**

That is find-shape (k) — two sites keying on different versions of the same thing — **in code I had just written, one iteration after fixing the same shape elsewhere.** The lesson is sharper than the shape: *a criterion is not an identifier for a question.* Re-keyed by position, which is unique by construction and asks the model for no judgement about identity.

RED first throughout, including the composition tests. 10 mutants killed across the two rounds, each verified to change behaviour first.

**Outcome:**

801 worker (+2) + 175 + 71 + 54 + 26 green; all six workspaces build; worker restarted twice, each restart verified against the dist mtime before any live measurement was trusted.

Live, after the re-key:

    intake.assumption_flagged:  3  ->  7
    newest batch:  m-1/high x12,  m-1/LOW x4,  null/high x1

`low` verdicts reach their questions instead of collapsing.

**R30 AC-2 is still unsatisfied, and the reason is now precisely characterised.** Both live missions **blocked at intake** — `escalation.awaiting_human` then `mission.surrendered` — so neither reached `task.executed` and `loadBearingNow` never ran.

This is two correct behaviours combining badly, not a bug in either. Removing the suppressing sentence made the interrogator raise ~8 questions per mission; a high-stakes question blocks (AC-0) and a low-stakes one is carried (AC-2). Together: **one high among many is enough to stop the mission**, so a carried assumption can never reach the task it bears on. AC-2's given now needs a mission whose questions are *all* low-stakes.

Logged as `343c3fb8` with three unmeasured options and an explicit warning not to weaken the block — a high-stakes ambiguity stopping the mission is the requirement working. The open question is whether eight questions about naming a colour is the right *verbosity*, which is a different problem and must not be conflated with the blocking policy.
