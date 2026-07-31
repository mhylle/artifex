# 092 — The observatory shows both halves of the ratchet

**Date:** 2026-07-31
**Category:** bug-fix

**What:** The Learning Observatory now shows the science loop's adoption decisions and the weak-spot rankings, not just the fast loop's resolutions (defect `b916a540`). Verified in a real browser. Three mutants survived the first pass and each exposed a genuine gap.

**Why:** A systematic sweep — every event type in the live ledger against every dashboard source — found two of the Learning Agent's outputs mentioned nowhere in the cockpit's code: `learning.weak_spots_ranked` (44 events) and `learning.candidate_evaluated` (1). R19 AC-2 says the observatory shows "adoptions and reverts on the ratchet", and `buildLearningView` sourced both from `fast_loop.hot_fix_resolved` alone. That was right when the fast loop was the only ratchet; since the science loop was wired it also decides adoptions. Find-shape (c): the panel claimed to show the ratchet and showed half of it.

**Details:**

The finding is narrower than the obvious phrasing would suggest, and was checked before being claimed: nothing was invisible. `buildLedgerView` returns every event, so both types already appeared as raw rows in the ledger explorer. What they lacked was purposeful treatment in the lens where the decision is actually read.

The projection gains `candidateDecisions` and `rankings`, kept deliberately separate from `adoptions`/`reverts`. The two loops run at different speeds against different evidence — an in-mission window of two observations versus a bench replay under a fixed budget with replication and a held-out slice — and folding them together would let a reader think they carried the same weight. Rejections are carried rather than filtered, for the reason `AdoptionDecision` already gives: a rejected candidate is a measurement. Today every live decision is a rejection, so a panel showing only adoptions would render empty and read as "the science loop has done nothing".

**The mutation pass was the valuable part.** Three survived the first run:

- A missing `adopt` flag defaulting to ADOPTED. Every fixture set it explicitly, so the case was never tested — and an unrecorded decision must not read as a change the swarm made to itself.
- `heldOutWon: null` collapsing to `false`. These are different findings: `false` means the candidate failed the sealed slice, `null` means no sealed case existed to try it against, and the science loop returns null in exactly that case and says so in its own comment.
- The empty-state guard, which lived as an expression inside the component where no test could reach it. It moved to `hasLearningOutput` in the projection — a rule kept in a template can be neither tested nor mutated. Both an always-true version and a slow-loop-blind version now fail.

The sweep that found the defect was kept honest by asserting up front that it could see a control type the dashboard demonstrably reads. Without that, a mis-globbed directory would have reported all 44 live event types as unread and looked like a dramatic finding rather than a broken probe.

**Outcome:**

731 worker + 175 dashboard (up from 165) + 66 + 50 + 26 green; all six workspaces build. Only the dashboard changed, so the worker and API were left running.

Live, driven through the real UI with Playwright:

    Science loop  bench-tested candidates — the slow ratchet
    REJECTED   0W / 2L · held out: lost
    won 0 time(s) — a single lucky run adopts nothing, and 2 independent wins
    are needed before a result counts as replicated

    Weak spots  what the next hypothesis aims at
    52 categories ranked
    technical writing — severity 10.05, 13 observations

rendered with `class="outcome outcome-reject"`. Markup and CSS live in their own files per the package rule, and the outcome word is always present in the text so colour is never the only signal.

One honest note on the first attempt: the decision row read "No candidate has been bench-tested yet" until the right mission was selected. That was correct behaviour — the lens is per-mission and the decision belongs to the mission whose run produced it — not a bug, and worth recording so the next reader does not mistake a per-mission lens for a broken one.
