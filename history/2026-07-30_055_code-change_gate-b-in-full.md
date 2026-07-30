# 2026-07-30 · 055 · code-change · Gate B in full — and the judge that answered with the question

**What:** Built R34, all four criteria. Gate B ran one tier and carried two of its declared inputs without ever using them.

**Two of them were live for years and did nothing.** `verificationPlan.depth` was copied into the verdict and ignored, so a `redundant` plan verified exactly **once** — a lucky pass genuinely was a pass. `redFlags` were collected from the judge and copied into the verdict while the outcome ignored them, so an output flagged as verification-shaped still **passed**, which is precisely the case AC-2 names. Both looked implemented from the outside; that is what made them worth checking.

**The two tiers do different jobs and fail differently.**

- **Mechanical** — facts, not judgements: an empty deliverable, effort past the ceiling, a contract that granted tools and came back with no actions. A model asked "does this meet the criteria" will sometimes say yes to nothing at all, and the defence is not a better prompt — it is not asking.
- **Semantic intent** — does the output serve what was *wanted*, not merely the letter? Asked as a **separate call** from the completion judge on purpose: the two questions pull opposite ways, and one call invites the model to reconcile them into a single comfortable answer.

Both judges are **required** parameters, following R33's lesson — an optional tier would let a mission verify with half of Gate B silently absent while the gate still reported a pass.

**AC-3 is proven at the database, not asserted.** Raw SQL amend and withdraw of an issued `gate_b.verdict_issued` row are both rejected by the append-only trigger, and a later correction lands as a **new** verdict with **both** still in the trail. That last half matters as much as the first: a correction that erased its predecessor would let time travel reconstruct a past that never happened — a moment when the task had always passed.

**Then live driving found what no test could.** The intent tier returned the **prompt's own example phrases, verbatim** — "an answer shaped like a verification rather than an answer" — as red flags on both attempts of mission `e7dddf91`. It was completing a pattern, not inspecting a deliverable. And because red flags now *discard* work, that was not cosmetic: it would have thrown away good work on nearly every mission.

Fixed twice over, because a prompt fix alone is a hope: the prompt no longer offers phrasings to copy and requires each flag to **quote** the deliverable, and the tier is now sampled with **unanimity required to condemn** — the house pattern, in the direction that preserves work. Before and after on the same objective: parroted flags on every run → `redFlags: []`, with a garbage answer still correctly failing *both* the completion and intent tiers, and `"100"` passing clean.

**Two surviving mutants, both real.** One test claimed to prove "a sample repeating itself is not agreement" while using three samples, where a doubled flag reaches 2 against a required 3 and is dropped by the *arithmetic* rather than by the dedup — so deleting the dedup passed. Rewritten at two samples, the only shape that tests the rule. The second was an equivalent mutant that nonetheless exposed a flaw of my own: a **passing** verdict could carry a **condemning** sample's reason, telling an operator the opposite of what happened.

**ADR-0010** discharges the delegated tier-2 model question: keep `gemma4:12b`, treat sampling as the structural mitigation. Four independent tier-2 consumers have now shown the same over-assertion — the clarity judge, the decompose gate, R33's plan audit, and now the intent tier — and all four were corrected by sampling rather than by changing models. The ADR states its own limit plainly: the full comparative measurement was **not** run, so this is "no change with the mitigation named", not a demonstration that `gemma4:12b` is the better model.

**Verification.** 24 new unit tests + 4 integration, **14 mutants killed** across three files, 375 worker + 85 integration + 66 green, full workspace build, live before/after, browser-confirmed.

**Outcome:** R34 satisfied; ADR-0010 written.
