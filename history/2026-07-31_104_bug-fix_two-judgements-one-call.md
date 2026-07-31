# 104 — Two judgements in one call, and the one that suppressed the other

**Date:** 2026-07-31
**Category:** bug-fix

**What:** Defect `bf766244` diagnosed by separating its two hypotheses before changing anything, then fixed by splitting the intake interrogation into two probes. `low` is now demonstrably reachable through the production seam — and has still never occurred in a live mission, so R30 AC-2 remains unsatisfied.

**Why:** The interrogator had never returned a low-stakes question, so R30's carried-assumption path had no fuel. Two hypotheses were on the table and neither had been measured.

**Details:**

**The separation.** Both hypotheses were tested independently of the production seam:

- **Asked only what is open** — no `stakes` field, no materiality filter, just *"list anything a reasonable person could read in more than one way, however small"* — the model raised **14 questions** on the same three trivial requests where the production prompt raised **0**.
- **Asked only for stakes**, on plainly minor questions (a haiku's season, a cover colour's warmth, a leaflet's tone) — **3 low / 0 high**.

So hypothesis (i) holds and (ii) does not. The questions were always there and `low` was always reachable; **one probe asking for both made a materiality judgement suppress the very thing the stakes field existed to classify.**

**The fix is the reasoning already in the codebase.** `AssumptionsSchema` is a separate call from `AnswerSchema` precisely because a second judgement in one probe corrupts the first. The interrogator now does the same: call one asks what is open, with the *"genuinely open"* filter removed; call two rates what it would cost to guess wrong, and runs only when there is something to rate, so a well-specified request still pays for one probe. An unrated question defaults to **high** — carrying an unclassified question as low-stakes would be assuming away something nobody judged.

RED first, on the seam's *shape*: the test inspects the schema handed to the model rather than the prompt wording, because a field the model is given is a judgement it will make whatever the instructions say. 4 mutants killed. A fifth attempt did not compile and is recorded as **not a mutant** rather than counted — the second time that check has caught a non-mutant.

**Outcome:**

793 worker (+5) + 175 + 71 + 54 + 26 green; all six workspaces build; worker rebuilt and restarted, with the restart verified against the dist mtime (dist 14:34:12, process 14:34:15) before any live measurement was trusted.

Re-measured on the **same six inputs** as iteration 89, through the real seam imported from `dist`:

    BEFORE (iteration 89): 0 questions, 0 low
    AFTER  (this run):     3 questions, 1 low, 2 high

**That is the half proven.** `low` is reachable through the production seam.

**The half not proven, stated plainly.** A live mission submitted through the API produced **zero** intake questions, and the whole-ledger counts are unchanged: `intake.question_raised = 2` (both predating this change), `intake.assumption_flagged = 0`. The probe *does* raise two questions for that mission's exact objective, so this is model variance rather than a dead path — but no real mission has yet written a flagged assumption.

**R30 AC-2 stays unsatisfied**, and the state now has a name worth keeping distinct from the two before it. ADR-0015's R13 AC-0 was *unreachable by construction*. This defect's original finding was *a proven path with an unproven judgement*. What it is now is **reachable but not yet observed** — the mechanism works, the judgement can produce the given, and the given has not happened in production.
