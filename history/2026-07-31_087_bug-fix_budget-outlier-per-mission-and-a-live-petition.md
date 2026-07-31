# 087 — The budget outlier is a per-mission pattern, and the first petition fired live

**Date:** 2026-07-31
**Category:** bug-fix

**What:** Replaced the budget-versus-value outlier's pooled ratio with a per-mission count (defect `d08191c8`). A real mission submitted through the API then filed a constitutional petition, which reached the attention queue and renders in the Learning Observatory in a browser. R19 AC-2's petitions clause is no longer a rendering-only proof. R29 AC-0 is still not satisfied, and the reason is now a single named gap.

**Why:** `rankWeakSpots` summed spend and ceiling across every mission in a category and compared the totals. Iteration 72 measured what that hides: a ceiling-4 mission produced `spent 2 of 2 budget (100%)` per mission while `technical writing` pooled to 19/152, about 12.5%. A category that blew its ceiling was invisible behind ten generous ones, so the amendment petition could never fire. The criterion describes a pattern — "a category spends near its ceiling and still surrenders" — and pooling hides a pattern behind volume.

**Details:**

The outlier now counts the missions that individually reached `NEAR_CEILING`, and weights severity by that count, matching how the sibling surrender rule already works. `NEAR_CEILING` is untouched at 0.9: what changed is the population the existing bar applies to, so no constant was invented.

The replacement provably cannot lose a detection the pooled rule would have made, which is why it replaces that rule rather than OR-ing with it. The pooled ratio is a weighted average of the per-mission ratios, with weights `ceiling_i / Σceiling`, and a weighted average never exceeds its largest term — so a pooled ratio at or above 0.9 implies some single mission was already at or above 0.9. The old rule was a strictly weaker form of the new one, and an `OR` would have added a branch that can never be the only one taken. That subsumption is asserted as a test rather than left as an argument in a comment.

7 tests. 6 mutants killed: reverting to the pooled ratio; counting zero-ceiling rows as outliers; loosening the bar to "any spend"; severity no longer scaling with the count; inverting the ratio to ceiling-over-spent; and dropping the mission count from the reason text. The distractors cover a merely busy category — 40 cheap missions, silent — and one sitting just under the bar at 0.89, also silent.

Two variables (`spent`, `ceiling`) became unused when their only consumer was replaced, and were removed with the change that orphaned them.

**Outcome:**

702 worker + 160 + 66 + 50 + 26 green; all six workspaces build; rebuilt **and restarted** before measuring.

A real mission through `POST /missions` at ceiling 4 — an honest input, not planted state, since effort is the count of model calls and a tight ceiling makes a task genuinely spend its budget — produced mission `dab732bd`, then:

    learning.proposal_emitted
      title:     Budget enforcement blocks remedy in "technical writing"
      targets:   constitution
      evidence:  20 event ids from the mission's own trail
      rationale: ... 2 of 12 mission(s) spent at least 90% of budget
                 (worst: 4 of 2) — a budget-versus-value outlier ...

    escalation.awaiting_human  rung: amendment_ratification

`GET /missions/attention` returns it as the top item. Driven through the real UI with Playwright — fleet rail, mission, learning lens — the Learning Observatory's "Amendment petitions, proposals only, never applied" panel renders it with `"status": "proposed"`, `"targets": "constitution"` and the full rationale.

That lifts a carried bound: **R19 AC-2's petitions clause was proven only as a rendering, because no petition had ever existed.** The populated case is now clicked through in a browser.

**What this does not satisfy, stated precisely rather than rounded up.** R29 AC-0 has two clauses. The petition "carries the ledger evidence it is argued from" is now true — 20 real event ids. "Is evaluated against the sealed bench rather than any slice the learner could have optimized against" is false: `evaluateOnSealedBench` has no production caller, and nothing on the petition path touches the bench. R29 AC-0 stays unsatisfied with the sealed-bench evaluation as its single identified blocker, which is the `635b7a9f` thread.

The second blocker on the defect's own diagnosis also remains untouched: no new capability bucket can form, because the planner names the form of work rather than the subject (`e34d178e`).
