# 086 — Why the amendment petition cannot fire, and a claim of mine that was wrong

**Date:** 2026-07-31
**Category:** discovery

**What:** Three live probes established why the constitutional petition has never fired, correcting `d08191c8`'s framing from "the emitter is never constructed" (false) to a measured account of two independent blockers. Separately, a provenance argument made in iteration 71 turned out to be worthless, and ADR-0015 was corrected in place.

**Why:** `d08191c8` was the last thing standing between the ranking work of the previous four iterations and R29 AC-0, which needs a live petition. The ranking now surfaces real capabilities, so the trigger was supposed to be unblocked.

**Details:**

`ProposalEmitter` **is** constructed in the running worker, at `index.ts:221`, inside the petition path — `petitionFromWeakSpots` then `petitionRefusal` then `new ProposalEmitter` then `propose`, followed by an attention item for an operator. The defect's title said it never was. That was stale, and the title is rewritten rather than worked around.

What has never happened is the trigger firing for a mission submitted through the real API. Three probes, each a real mission through the intake endpoint:

1. **Tight ceiling, 8 effort-units.** Delivered; 2 tasks at 2 effort each against a per-task ceiling of 4, so the ratio was 0.5 — under the 0.9 `NEAR_CEILING` bar. A useful negative: effort is the count of model calls, so it does not scale with the budget, and a lower ceiling genuinely raises the ratio.
2. **Ceiling 4.** This did produce the outlier per mission — `spent 2 of 2 budget (100%) — a budget-versus-value outlier` for both categories — and still yielded `budget-outliers across ALL history: 0`. `rankWeakSpots` pools spend and ceiling per category across every mission, so `technical writing` sits at 19/152, about 12.5%. One tight mission cannot move a category that already has generous history, and the petition reads the pooled ranking.
3. **A fresh bucket.** A tight-ceiling mission on heraldry, chosen to share no token with any existing capability, so its lifetime ratio would be 100%. It staffed under `technical writing`. The planner's raw categories were `Technical Writing / Instruction Content` and `Technical Description / Instructional Content`: it names the form of the work, not the subject. `capabilityOf` takes the first segment, and `resolveCapability` merges description into writing on the shared token `technical`.

So the trigger is not merely unfired, it is unreachable in practice: established categories dilute any single outlier, and no new category can be established, because the planner categorises by form and nearly all of the swarm's work is one form.

Two candidate remedies are recorded on the defect and neither is built here, because each needs its own RED test and a decision about the yardstick. Rank the outlier on the fraction of missions in a category that ran near or over ceiling, rather than the pooled ratio — a pattern is what the criterion describes, and pooling hides it behind volume. Or change what the planner names, which is the `e34d178e` over-merge thread and must not be touched alone.

**Outcome:**

The more important half is a retraction. Iteration 71 argued that R13's `action.invoked` events came from scripts rather than the running system *because their missions carried no `requestedBy`*. That inference is worthless:

    select distinct type from ledger_event where payload ? 'requestedBy';
    -> (0 rows)

No ledger event carries `requestedBy` at all, for real API-submitted missions as much as for synthetic ones. The check looked like a provenance test and was a constant — it would have answered "script-produced" for any event ever recorded, including one produced live seconds earlier. It had also been promoted into the loop's standing rules as a technique, which is worse than making the mistake once.

ADR-0015's decision is unaffected and was corrected in place rather than quietly deleted: R13's four missing links are facts about the code — no tool-calling in the model router, `toolEntitlements: []` hardcoded at intake, `new ActionBroker` only in tests, no path from `work.execute` — each sufficient on its own and none depending on ledger provenance. The retracted paragraph is left visible with its correction, because a plausible-looking measurement that silently answers the same way for every input is precisely what this project keeps being bitten by.

That `requestedBy` is accepted at intake and never recorded is itself find-shape (g) — an event saying *what* but not *who* — and is logged as defect `526baf8f`, with the note that R22's audience scoping cannot key on a requester the trail never names.

A sixth heredoc corruption occurred while writing this entry: a shell heredoc containing apostrophes and quoted measurements aborted the whole command with an unmatched-quote error, so nothing landed. The entry and the commit message were written with the file-writing tool instead. The standing rule already said not to use heredocs for source; it applies to prose with punctuation just as much.

695 worker + 160 + 66 + 50 + 26 green; no source changed this iteration.
