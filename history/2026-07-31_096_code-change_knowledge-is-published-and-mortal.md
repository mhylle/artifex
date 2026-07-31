# 096 — Knowledge is published, and mortal

**Date:** 2026-07-31
**Category:** code-change

**What:** The second half of defect `913ead75`. Corroborated entries now publish with a finite life (ADR-0018), and the commons serves published knowledge through the broker for the first time — 0 → 3 published, with the impact asymmetry visible in the stored rows.

**Why:** Iteration 81 made corroboration fire, which made entries eligible for publication for the first time. Nothing called `publish`, and it could not be called without deciding how long a published entry lives.

**Details:**

The fuel check came first, as it has for four iterations: 4 corroborated entries still in quarantine (3 high, 1 low), all with `self_corroborated = false`, and 0 published.

Everything downstream already existed. `retrieve` labels an entry past its expiry as `expired` with `current: false`, and the broker serves only entries labelled `published`. The single missing input was the lifetime.

**Nothing the system records determines how long a fact stays true.** The ledger knows when a claim was made and by whom; it cannot know whether the boiling point of water will change. So ADR-0018 makes the choice openly rather than picking a number and justifying it afterwards.

**The shape of the rule is derived even though the magnitudes are not.** AC-2 says "stale certainty is worse than honest absence" — a claim about cost. Where being wrong costs more, stale certainty costs more, so a high-impact entry expires *sooner*, not later: one day against seven. That is the opposite of the intuitive reading, where important facts feel like they deserve longer lives, and it is the reading the requirement supports, since `impact` is derived from blast radius and blast radius already says what being wrong costs. The mutant that inverts the asymmetry dies.

Corroboration gates publication for both impact levels, although the store only enforces it for high. Publishing a low-impact entry on submission would make quarantine a formality for most of the commons, and "guilty until proven useful" is the whole design.

6 mutants killed: publication removed, the asymmetry inverted, one lifetime for both impacts, a zero TTL — which the store refuses, turning publication into silence — the ledger record dropped, and publishing *before* corroborating, an ordering the store rejects for a high-impact entry so the swallow would hide it. One mutant of mine was a no-op, `await Promise.resolve()` before the call, and is recorded as such rather than counted; rewritten as the ordering mutant it dies. That is the second no-op mutant in two iterations, and the rule earned from the first was clearly not enough on its own.

**Outcome:**

746 worker + 175 + 66 + 50 + 26 green, plus 164 memory-fabric integration tests; all six workspaces build; rebuilt, restarted, queue drained before measuring.

Live, from re-asking an earlier mission's question — an honest input:

    published before:  0
    published after:   high  1  lifetime 1 day
                       low   2  lifetime 7 days
    knowledge.published:  high ttl=86400 x1,  low ttl=604800 x2

The ADR's decision is visible in the stored rows rather than only in the code. And the broker serves them, which is what AC-2 is about:

    published (served as current fact): 3
    unproven  (held back by the filter): 56
    expired   (NOT served as current)  : 0

**One bound, stated rather than rounded up.** The expiry path itself has still never run on a real row: the shortest lifetime is a day, so nothing live has passed its expiry yet. `retrieve`'s labelling and the broker's filter are covered by the store's integration tests, so this is pinned by tests rather than observed live — a state that cannot be caught live without waiting a day.

A stale comment in `worker-seams.ts` already claimed the commons "publishes on corroboration (R24)" while nothing did. It described an intended design, and this makes it true rather than deleting it.
