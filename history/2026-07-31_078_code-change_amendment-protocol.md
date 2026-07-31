# 2026-07-31 · 078 · code-change · The amendment protocol — R29 AC-1 and AC-2, and a queue-emptying bug caught by a distractor

**What:** the constitutional amendment protocol is built, the `ProposalEmitter` is finally constructed, and petitions reach the attention queue. R29 AC-1 and AC-2 satisfied. **AC-0 deliberately not claimed** — see the end.

**The protocol, one rule per clause of the dossier's sentence** ("petitions argued from evidence, evaluated on the sealed bench, ratified out-of-band per the autonomy dial"):

- **Argued from evidence.** A petition with no evidence or no rationale is refused — the emitter's own comment already said an unevidenced proposal is an opinion.
- **Evaluated on the sealed bench, and it THROWS on an open case rather than filtering it.** Silently dropping open cases would let a caller believe a thirty-case evaluation happened when three were scored, and the count is exactly what a reader uses to judge the verdict's worth. A refusal is loud; a filter is a lie by omission. This is the clause R25 split the bench for.
- **Unanimity, in the direction that preserves the status quo.** The conservative outcome for an amendment is not to amend, so one sealed case arguing against leaves the Constitution alone. An empty bench is `unevaluated`, never `supported` — zero of zero is 100% by arithmetic and nothing by evidence.
- **Ratified out-of-band**, enforced rather than assumed: a decision recorded by the learning agent is disregarded, because the proposer deciding for itself is not out-of-band by any reading.

**AC-2 asserted structurally.** Not "there is no `apply`" — true of every typo — but that the emitter's entire prototype surface is exactly `['propose']`, which a future edit has to break deliberately, plus that `CONSTITUTIONAL_CORE` is frozen and a write to it throws.

**A distractor caught a bug that would have emptied the whole attention queue.** Petition decisions are `operator.decided` rows with a **NULL** `task_id`, and the queue's `answered` CTE selected `task_id` from all of them. A single NULL in that set makes `w.task_id NOT IN (answered)` evaluate to NULL for *every* task — no task escalation would ever have appeared again. The test that found it was the one asserting "ordinary task escalations still appear alongside petitions", written because the branch had to be *additive*. Without that distractor this ships as a silent, total regression of R18.

**Two self-inflicted errors worth recording.** A fixture omitted `taskId: null`, so every "petition" was a task escalation wearing a petition payload and the tests failed against correct code — the test was wrong, not the query. And a SQL comment containing backticks terminated the TypeScript template literal it sat inside; that is the fourth distinct way a comment has corrupted source in this project, after heredocs and `packages/*/src` closing a block comment.

**Verification.** 20 pure tests + 4 integration tests against real Postgres. 647 worker + 154 memory-fabric integration + 160 + 66 + 50 + 26 green, full workspace build, live restart.

**AC-0 is NOT claimed, and the reason is the interesting part.** The producer is wired, but **it has never fired**. The trigger is deliberately narrow — a petition is warranted only where the learner's own authority cannot reach, which is the budget-versus-value outlier — and no live weak spot carries that reason. The rankings show `observations: 1` per category, because **category fragmentation** means no bucket ever accumulates enough history to show a budget pattern. A ceiling-4 mission run to provoke one did not, because its category was its own bucket.

That makes this the **sixth** place fragmentation has surfaced: weak spots, the fast loop's trigger, decomposition template keys, the workforce lens, context entitlement strings, and now the amendment trigger. It has stopped being a taxonomy nicety and is now throttling four separate learning mechanisms — it is the thing to measure and fix next. Deliberately *not* worked around by loosening the trigger: petitioning over a surrender would ask a human to ratify a constitutional change for something the learner may already fix with a prompt rewrite, and an amendment protocol that fires routinely makes the Constitution a suggestion.

**Outcome:** R29 AC-1 and AC-2 satisfied; AC-0 open on evidence, with `d08191c8` updated from "no producer" to "producer with no fuel".
