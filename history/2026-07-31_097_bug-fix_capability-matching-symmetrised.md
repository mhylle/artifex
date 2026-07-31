# 097 — Both sides of the capability comparison, and a warning that did not survive measurement

**Date:** 2026-07-31
**Category:** bug-fix

**What:** Defects `e34d178e` and `6d58e8ef` resolved together. `resolveCapability` now normalises both sides of its comparison, and `knownCapabilities` no longer offers categories nothing can staff. Half the registry moved from unreachable to reachable for reuse. The tightening the defect demanded was measured and rejected (ADR-0019).

**Why:** `resolveCapability(proposed, known)` normalised the proposal with `capabilityOf` and compared its tokens against the registry category **verbatim**. Two sides of one comparison, normalised differently — the third instance of house find-shape (k). Measured live: **12 of 24 proposable categories were unreachable for reuse**, including `Description Task`, `Hand Tool Overview`, `Tool Identification & Description`. Those rows carry the observations, so their unreachability silently capped R38 AC-1 at the subset of rows that happen to be lowercase.

**Details:**

The defect carried an explicit instruction not to fix it alone: normalising both sides increases matching, `ad116ead` had measured that more matching produces wrong merges, so *"either fix both together or neither, and measure the merge list — not just the bucket count."*

**The measurement refuted the warning.** A probe imported the real `resolveCapability` from `dist` and replayed all 115 distinct raw ledger categories against a registry that **grows**, as production's does. 31 capabilities before, 30 after, 9 resolutions changed — and every one of the 9, inspected individually, is a correct merge: five physics proposals joining the physics row, `Culinary Instruction` and `Shogi Instruction` joining an instruction capability, `Kitchenware Description` and `Description Task` joining a description capability. Different subjects, same skill, in every case.

**The measurement tool lied first, and the lie was caught before it decided anything.** A first version resolved every proposal against a **frozen** registry snapshot, so a proposal that formed a new capability could not be matched by the next one. It overstated fragmentation by roughly a third and made the head-noun rule look far worse than it is. That number was discarded, not corrected after the fact.

**The proposed tightening was nearly adopted, and was rejected on the requirement's own evidence.** Matching on the HEAD noun rather than any shared token is genuinely *derived*: the `category` field's schema description says the value is *"the capability an agent would need, not the subject matter it happens to be about"*, and in an English noun phrase the modifiers carry the topic while the head carries the skill. It separates on a discriminator the current rule cannot — `Hand Tool Overview` vs `Hand Tool Fabrication` merges under symmetric matching and does not under head matching — and it dissolves the chained bucket single-linkage builds, where the current rule's largest capability holds **34 distinct raw names** spanning writing, research, instruction and number theory because A shares `technical` with B and B shares `analysis` with C.

It was rejected because it splits **R38 AC-0's own live evidence**. The criterion is pinned on mission `77b83c64`, where five names for one job collapse onto one capability; under the head rule they become four, because `overview`, `description` and `instruction` are different heads. The rule's premise is that the head is the skill; on that data the head is the *deliverable*, and three deliverables are one skill. Aggregate legibility does not outrank the evidence a satisfied criterion rests on. ADR-0019 records the option, the tables, and where it lands on the roadmap.

**Fixing one defect revealed another, logged separately and shipped in the same change.** `bestForCategory` filters `active = true`; `knownCapabilities` did not — so a category whose designs are all retired was offered to the planner and to `resolveCapability`, then staffed by asking `bestForCategory`, which returns null for it. A guaranteed no-bid for a name the system suggested itself, feeding the surrender signal that counts unserved capabilities. Under the asymmetric comparison the live instance was unreachable anyway; the symmetry fix made it reachable by 2 of 115 proposals, so shipping `e34d178e` alone would have routed real work onto a retired dogfood design.

**A third defect was found, measured, and deliberately NOT fixed** (`c09b15c6`). The planner is told to reuse a listed capability; on mission `feb66cf8` it complied verbatim — `Technical Description / Instructional Content`, a real row — and was staffed as `technical writing`, because rank 0 shares the modifier `technical` and wins before the exactly-named row is reached. Making an exact match win first was measured: 30 capabilities to **37**, routing work onto legacy rows with 0–1 observations. That is R38 AC-0's own failure mode bought in exchange for obedience. The cause underneath is data, not rules — the registry holds pre-normalisation duplicates (`Hand Tool Overview` *and* `hand tools overview` are one capability stored twice) — so the fix is sequenced behind a duplicate-fold migration.

9 mutants killed across the two packages, each verified to change behaviour before being counted. The two that earned their keep: the candidate merely **lowercased** rather than passed through `capabilityOf`, which would have lent `writing` and `materials` to any writing task and staffed it with a physics design; and the active filter moved to **`HAVING`**, which keeps the category out of the offered list and silently gets the *ordering* wrong — caught only by the ranking test, because the ordering is `resolveCapability`'s tie-break.

**Outcome:**

752 worker (+6) + 175 + 66 + 50 + 26 green, plus 167 memory-fabric integration tests (+3); all six workspaces build; worker rebuilt, restarted, queue drained before measuring.

Live, through the real exported functions against the real registry and real ledger proposals:

    offered as staffable   before 40  ->  after 39   (dropped: research.dogfood.1785397657889)
    proposable capitalised categories, previously unreachable:  11 of 23
    live raw proposals resolving differently:                   10 of 118

    "Physics Instructional Design"  — proposed by a live planner today, mission c24efc3e
        was -> "physics instructional design"            a fresh one-off capability, no bid
        now -> "Physics/Chemistry of Writing Materials"  bestForCategory -> 3fc03b7d, obs=6

A proposal that previously minted an evidence-free capability now reuses a design with a six-observation track record. That is R38 AC-1 on a path that could not previously be taken.

**Bound, stated rather than rounded up.** No live **staffing event** joined a capitalised row. Five missions were run to try: two were kept whole by the decompose gate, two proposed categories sharing `technical` or `tool` with a higher-ranked lowercase row and resolved to it, and the one that did propose a qualifying category surrendered at Gate A before staffing. The window is narrow because the four highest-ranked lowercase rows absorb most planner phrasings first — the chained-bucket weakness ADR-0019 documents and does not fix. A negative result from a working mechanism, not a failed fix.

Separately, the architecture-drift pillar moved **8 → 6**: both `stale` entries were cleared honestly by refreshing `API Composition Root` and `Mission Intake` against what those files actually contain today. Refreshing a component so it describes the real file is the tool's own prescribed remedy. The 6 remaining `orphaned` entries all cite files that **exist** — the walker inventories only NestJS-convention filenames, 7 of 142 sources (friction `7ef7a267`) — and deleting truthful references to go green is the `cd18baa0` failure shape.
