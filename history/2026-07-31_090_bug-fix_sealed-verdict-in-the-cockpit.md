# 090 — The sealed verdict reaches the cockpit

**Date:** 2026-07-31
**Category:** bug-fix

**What:** The Learning Observatory now shows the sealed-bench verdict beside the petition it judges (defect `78e4e5cf`). Verified in a real browser: `SEALED BENCH: SUPPORTED (1/1 CASE)` above the petition it belongs to.

**Why:** The petition path records two events — `learning.proposal_emitted`, what the Learning Agent argued, and `learning.petition_evaluated`, what the sealed bench answered. The panel read only the first. R29 AC-1 puts the petition in front of a human for an out-of-band decision, and the whole point of the sealed slice is that the human's decision rests on evidence the learner could not choose. Showing the argument without the answer inverts that. Find-shape (o): a result the ledger records but the cockpit never shows.

**Details:**

The pairing belongs in the projection, not the template. `buildLearningView` now returns `PetitionView { event, verdict, supported, evaluated }`, keyed on the petition's own event id — the same shape by which `experiments` already pairs with its resolution. The two ledger events stay separate at the source deliberately: collapsing them there would let a reader mistake the learner's own filing for a judgement made against evidence it never chose.

Matched by id, never by recency. A mission can raise more than one weak spot over its life, and "the latest verdict" would attach one petition's judgement to another — that mutant is written and killed. An orphan verdict invents no petition, which is the rule resolutions already follow.

5 tests, 5 mutants killed: an unjudged petition defaulting to `supported`; matching by recency; every verdict reported as `supported`; the counts dropped so a verdict shows with no weight; and an orphan verdict inventing a petition. The distractors assert both sides — `unsupported` is reported as itself rather than as an absence, because a bench arguing *against* amending is the outcome that most needs to reach the person deciding.

Markup and CSS live in `lens-panels.html` and `lens-panels.css`, per the package's standing rule that nothing goes inline in a decorator. The colour carries no meaning on its own: the verdict word is always present in the text, so the panel still reads without distinguishing the hues.

**Outcome:**

722 worker + 165 dashboard (up from 160) + 66 + 50 + 26 green; all six workspaces build.

Driven through the real UI with Playwright — fleet rail, mission, learning lens:

    SEALED BENCH: SUPPORTED (1/1 CASE)
    { "title": "Budget enforcement blocks remedy in \"technical writing\"",
      "status": "proposed", "targets": "constitution", "appliedBy": null, ... }

rendered with `class="verdict verdict-supported"`, and the pluralisation correct at one case. Only the dashboard changed, so the worker and API were left running rather than restarted — nothing in this change could reach them.

R29's bound still stands and is worth repeating rather than quietly dropping: AC-0 was satisfied against a single sealed case, and unanimity over one case is thin. As the bench grows, that verdict should be re-checked rather than assumed.
