# ADR-0019 — Capability matching is symmetrised, and deliberately NOT tightened

**Date:** 2026-07-31
**Status:** Accepted
**Context:** R38 AC-0 (clustering into capability categories), defects `e34d178e`, `6d58e8ef`

## Context

`resolveCapability(proposed, known)` decides whether a freshly invented category
joins a capability the registry already holds. It normalised the **proposal**
with `capabilityOf` — first segment, lowercase, punctuation stripped — and then
compared its tokens against the registry category **verbatim**. Two sides of one
comparison, normalised differently.

Measured against the live registry: **12 of 24 proposable categories were
unreachable for reuse.** Every token they own is capitalised or punctuated, so no
proposal could ever match them — `Description Task`, `Hand Tool Overview`,
`Tool Identification & Description`, `Instructional Writing / Technical
Description` among them. A thirteenth, `Physics/Chemistry of Writing Materials`,
was matchable only through the stopword `of`.

Those rows carry observations. Their unreachability silently capped R38 AC-1's
"reuse beats creation whenever the record supports it" at the subset of rows that
happen to be lowercase.

The defect carried an explicit warning against fixing this alone: normalising
both sides increases matching, and defect `ad116ead` had already measured that
more matching under a single-shared-token rule produces wrong merges. *"Either
fix both together or neither, and measure the merge list — not just the bucket
count."*

## The measurement

A probe imported the real `resolveCapability` from `packages/worker/dist` and
replayed **all 115 distinct raw categories in the live ledger** against a
registry that **grows** as production's does — a proposal that forms a new
capability is registered, so the next proposal can match it. (A first version
resolved every proposal against a frozen snapshot and overstated fragmentation by
roughly a third; the number it produced was wrong and was discarded.)

| rule | capabilities, seeded from the live registry | from empty |
|---|---|---|
| current (asymmetric, any shared token) | 31 | 28 |
| symmetric, any shared token | 30 | 28 |
| symmetric, shared HEAD noun | 47 | 47 |

**The warning did not survive the measurement.** Symmetrising alone changes 9 of
115 resolutions and moves the taxonomy from 31 capabilities to 30. Every one of
the 9 was inspected individually:

- five physics proposals (`Physics / Data Analysis`, `Physics/Meteorology
  Fundamentals`, `Computational Physics / Fluid Dynamics Simulation`,
  `Physics / Science Communication` ×2) join `Physics/Chemistry of Writing
  Materials`, whose first segment *is* `physics`;
- `Culinary Instruction` and `Shogi Instruction` join
  `Tool Identification & Instruction`;
- `Kitchenware Description` and `Description Task` join
  `Technical Description / Instructional Content`.

Different subjects, same skill, in every case. The prediction that over-merge
would get worse is **retracted, with the measurement that refutes it.**

## Options considered

**A. Symmetrise the comparison only.** — *Chosen.*

**B. Tighten to a shared HEAD noun as well.** Rejected, and the reasoning is
worth keeping because it was nearly adopted.

The head rule is genuinely *derived* rather than invented. The `category` field's
own schema description says: *"the capability an agent would need, not the
subject matter it happens to be about. Two subtasks on different topics that call
for the same skill should get the same value here; two subtasks on one topic that
call for different skills should not."* In an English noun phrase the modifiers
carry the topic and the head carries the skill — `hand tool overview` is an
*overview* (skill) about *hand tools* (topic). Matching on the head and ignoring
modifiers mechanises the field's own stated contract.

It also separates cleanly on a discriminator the current rule cannot:

| | current | symmetric | head |
|---|---|---|---|
| POSITIVE `Hand Tool Overview` vs `Rail Travel Overview` | no | yes | yes |
| POSITIVE `Technical Writing / Instructional Content` vs `Scientific Writing` | no | yes | yes |
| NEGATIVE `Hand Tool Overview` vs `Hand Tool Fabrication` | no | **yes** | no |
| NEGATIVE `Technical Writing` vs `Technical Review` | no | **yes** | no |

And it dissolves the chained garbage bucket the current rule builds. From empty,
the current rule's largest capability holds **34 distinct raw names** — writing,
research, instruction, identification, maintenance analysis and *complex
analysis in number theory*, all staffed by one design — because A shares
`technical` with B and B shares `analysis` with C. Single-linkage collapse. The
head rule's taxonomy is legible instead: 16 writing, 14 analysis, 7 engineering,
6 description, 5 definition (`Parameter` / `Scientific` / `Economic`), 4
education (`Rail Transport` / `Hand Tool` / `Technical`), 4 instruction
(`Culinary` / `Shogi` / `Technical` / `Tool`).

**It was rejected because it splits R38 AC-0's own live evidence.** The criterion
is pinned on mission `77b83c64`, where the planner produced five names for one
job — `Hand Tool Overview`, `Tool Identification & Description`, `Tool
Description`, `Tool Identification & Instruction`, `Woodworking Tools` — and the
test asserts they collapse onto **one** capability. Under the head rule they
become **four**: `overview`, `description`, `instruction` and `tool` are
different heads. The rule's premise is that the head is the skill; on this data
the head is the *deliverable*, and three deliverables are one skill.

Adopting it would un-satisfy a satisfied criterion on the evidence that
established it. The taxonomy it builds is more legible on aggregate and wrong on
the case the requirement is anchored to, and aggregate legibility does not
outrank the requirement's own evidence.

**C. Both.** Excluded by B.

**D. Neither.** Leaves half the registry unreachable. Rejected.

Also measured and not adopted: treating `&` as a segment break the way `/` and
`;` already are. It produced 49 capabilities against the head rule's 47 with no
identified benefit, and neither `/` nor `;` was introduced without evidence.

## Decision

`resolveCapability` normalises **both** sides with `capabilityOf` before
tokenising. The token rule is unchanged.

Normalising the candidate is not the same as lowercasing it, and the difference
is load-bearing. `capabilityOf` takes the **first segment**, so
`Physics/Chemistry of Writing Materials` is compared as the capability `physics`
rather than lending `writing` and `materials` to any writing task that comes
along. A lazy `toLowerCase()` fix would have staffed writing work with a physics
design; a mutant asserting exactly that is killed by the distractor.

The resolved category is still returned **verbatim**. It is the key
`bestForCategory` is queried by, so returning a normalised form would resolve
onto a row and then fail to find it — reuse that resolves correctly and reuses
nothing.

### The half that had to ship with it

Symmetrising exposed a second gap, logged separately as `6d58e8ef`:
`bestForCategory` filters `active = true`; `knownCapabilities` did not. A
category whose designs are all retired was still offered to the planner as a
capability the swarm handles and to `resolveCapability` as a merge target — then
staffed by asking `bestForCategory`, which returns null for it. A guaranteed
no-bid for a name the system suggested itself, feeding the surrender signal that
counts unserved capabilities.

Under the asymmetric comparison the live instance was unreachable anyway. Under
the fix it becomes reachable, and 2 of the 115 proposals resolve onto a **retired
dogfood design**. That regression is real and would have shipped, so the filter
went in the same change. `WHERE` rather than `HAVING`, so the observation
ordering counts only evidence that can still bid.

Live count: 1 of 24 proposable categories, `research.dogfood.1785397657889` —
an artefact of this project's own dogfood probes, and it is worth noting that the
rule change is what made a piece of test residue capable of absorbing real work.

## Consequence, and a correction to an earlier judgement

Defect `ad116ead` recorded `hand tools overview` absorbing `Rail Travel Overview`
as evidence of over-merging. Under the `category` field's own contract that merge
is **correct** — same skill, different topic — and treating "more merging" as
automatically worse is what made the coupling in `e34d178e` look mandatory. The
count is not the measure; the merge list is. Recorded here rather than reopening
a resolved defect.

The chained 34-name bucket remains. It is a real weakness of single-linkage
token matching and it is not fixed here, because the one tightening measured
against it costs a satisfied criterion its evidence. Separating a *deliverable*
(`overview`, `description`, `instruction`) from a *skill* needs a signal the
token rule does not have, and a closed synonym list would freeze a taxonomy the
dossier makes a **learnable** asset (R23/R38). It stays on the roadmap as a
learning-loop question — which names the registry has evidence of behaving alike
— rather than as a string rule.
