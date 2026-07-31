# ADR-0014 — Decomposition templates live in their own store, not in `agent_design`

- **Status:** accepted
- **Date:** 2026-07-31
- **Context:** R31 AC-2, defect `68f6c31c`

## Context

R31 AC-2 says: *"Given a decomposition template **in the Asset Registry** matching
the kind of work, when the Orchestrator splits, then the template guides the
split and its use is recorded, so templates accumulate evidence and become
learnable assets."*

Taken literally, "in the Asset Registry" points at `agent_design` — the table
that already exists, already has `clade_score` / `observations` / `active`, and
would need no migration. That was the first option considered, and it is wrong.

## Options considered

1. **Reuse `agent_design` with a `decomposition.*` category.** No migration, and
   the earned-permanence columns come for free. Rejected on three counts:

   - **R26's fast loop patches `role_instructions` on that table.** A recipe
     stored there could be silently rewritten mid-mission by an optimiser that
     believes it is tuning an agent prompt. The fast loop's reach is bounded to
     "worker-layer role instructions" by a type, a constitutional guard and a
     CHECK constraint — all three of which would happily admit a template that
     had been filed as a design.
   - **`bestForCategory` would bid templates as agents.** A template has no
     `capabilities` and cannot execute anything; staffing one fails at the point
     where it is hardest to diagnose.
   - **They are scored on different things.** A design's score is its Gate B pass
     rate. A template's is whether the *split it guided* survived Gate A. Sharing
     a column averages two unrelated measurements into one meaningless number.

2. **A separate `decomposition_template` table, modelled on the registry's
   earned-permanence shape.** Chosen.

## Decision

Templates get their own store with the same *properties* the Asset Registry has
— accumulate observations, carry a score, down-weight rather than delete, one
row per capability — and none of its *machinery*. "In the Asset Registry" is read
as **"a registry-governed asset"**, which is what the surrounding dossier text
means by it ("reusable recipes that are themselves learnable assets"), rather
than as "a row in `agent_design`".

Three decisions inside that:

**Keyed by capability**, the taxonomy R38's clustering already converges — so
templates accumulate per *kind of work* rather than per task, which is what makes
them learnable at all. A `unique(capability)` constraint enforces it: two
templates for one kind of work fragment the evidence the template exists to
accumulate.

**`minObservations` defaults to 0**, deliberately unlike the design registry's
bar of 3. An unproven *design* may be staffed and produce bad work; an unproven
*template* only adds a sentence to a prompt the planner is free to ignore, and
Gate A still audits whatever comes out. Withholding it until it had three
observations would mean it could never *get* three, because nothing else offers
templates — the evidence bar would be its own blocker.

**Scored on Gate A survival, not mission success.** A template's job is to
produce a well-formed decomposition; blaming it for a worker that later failed
would grade it on something it cannot influence.

**`remember` does not overwrite.** A second distillation for the same capability
keeps the incumbent, because the incumbent carries the evidence and the newcomer
carries none. Overwriting would reset the record every time the swarm split that
kind of work again, and no template would ever accumulate anything.

## The producer, without which the criterion is unreachable

Nothing else creates templates, so a split that survives Gate A **with no
template guiding it** is distilled into one. The recipe is the shape of the split
that worked, in the planner's own words — asking a model to summarise "how to
split this kind of work" would be a new seam and a new thing to be wrong about,
where the objectives that passed Gate A are evidence rather than a guess. A
*rejected* split teaches nothing, or the store would fill with recipes for
producing rejected decompositions.

## Consequences

- **Reversible.** Migration 0009 is additive with a `down`; the seam is optional
  on `MissionSeams`, so removing the store restores previous behaviour exactly.
- Proven live end to end. Mission `3c0923dc` split, survived Gate A, and emitted
  `decomposition.template_learned` (observations 0, score null — unproven, as it
  should be). Mission `d8e07ce4` then emitted `decomposition.template_used`
  carrying that recipe, survived Gate A, and the row moved to `observations 1,
  score 1.0`.
- **Known limitation, inherited rather than introduced.** Both live missions
  keyed the template to capability `mission`, because the planner still invents a
  category per task and R38's clustering has not converged the taxonomy (the
  carried "category fragmentation" item). Templates are only as well-targeted as
  the capability taxonomy is, so fixing fragmentation improves them for free —
  and until it is fixed, a template is coarser than the criterion intends.
