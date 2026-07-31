# 105 — One sentence suppressed everything, and my reachability claim was noise

**Date:** 2026-07-31
**Category:** bug-fix

**What:** Defect `bf766244` resolved — a single carried-over prompt sentence was suppressing every intake question, and removing it took the same input from 0/6 runs to 5/5. Live, `intake.assumption_flagged` went **0 → 3** for the first time. R30 AC-2 is still unsatisfied, now blocked by a different and cleanly-evidenced cause (`ddcaa17d`).

**Why:** Iteration 90 claimed `low` was reachable through the production seam. That claim was wrong, and re-measuring it properly is what found the real fix.

**Details:**

**The correction first, because it is the useful part.** The reachability claim rested on **one** `low` verdict in a single pass over six different inputs. Re-measured the way a reachability claim requires — the same input, six sequential runs, queue idle — the result was **0/6 runs, 0 questions**. The single `low` was noise.

One pass over N inputs measures *coverage*; N runs on one input measures *reproducibility*. A claim that the system **can** produce a verdict needs the second, and stating it from the first is how a coincidence gets recorded as a capability. Logged as a durable learning.

**Then the real cause, isolated to one sentence.** Iteration 90's winning probe and the shipped prompt differed by a line I had carried over from the single-call version: *"Return an empty list if the request is unambiguous — do not invent a question to fill it."* Same schema, same input, four runs each:

    WITH the guard (shipped):  0/4 runs produced questions,  0 total
    WITHOUT it:                4/4 runs produced questions, 15 total

The split into two calls was right and incomplete — the suppressing instruction survived the surgery. The "do not invent" worry is answered by the second call anyway: a spurious question rated `low` is carried rather than blocking, so an over-eager question costs a carried assumption, not a stopped mission.

Removing it, re-measured on the input that had produced nothing six times running:

    BEFORE: 0/6 runs, low=0
    AFTER:  5/5 runs, low=9, high=8

RED first — the test asserts the prompt does **not** carry the suppressing instruction, and says in place why prompt wording is the right subject here when schema shape is usually the stronger one: the schema was already correct and the suppression was entirely in the words.

**Outcome:**

794 worker (+1) + 175 + 71 + 54 + 26 green; all six workspaces build; worker rebuilt and restarted, restart verified against the dist mtime (dist 14:55:43, process 14:56:59).

Live, two missions through the API:

    intake.question_raised:     2  ->  5
    intake.assumption_flagged:  0  ->  3

The carrier that had been inert since it was built is producing fuel for the first time.

**What still blocks AC-2, and it is a different defect.** `assumption.became_load_bearing` is still 0. The model answers `about` with free-text phrases — `"cover"`, `"the term 'colour'"`, `"internal team handbook"` — while `loadBearingNow` matches it against criterion ids like `m-1`. The two sides key on different things: find-shape (k) for the fifth time.

And the schema invited it. `IntakeQuestionsSchema` describes `about` as *"The criterion id, **or the name of the field**, this question is about."* Two key spaces were permitted and a matcher was written for one; the model took the option the description offered. Logged as `ddcaa17d` with the fix sketched and explicitly not built — a half-designed schema change shipped at the end of an iteration is how the last three premises got written down wrong.
