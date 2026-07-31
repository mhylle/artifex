# ADR-0011 — A budget-exhausted task produces its redesign, but never runs it

- **Status:** accepted
- **Date:** 2026-07-31
- **Context:** R28 AC-0, defects `e758f460` and `cb939996`

## Context

`budget_exhaustion` is the only error class mapped to the `agent_redesign` rung
(`escalation.ts`), and that rung is the only thing in Artifex that gives a design
a parent. No parent, no lineage; no lineage, no clade score; and R28 AC-0's
"given a design with ancestors in the registry" is unreachable. The live
database confirmed it: **0 rows** with a non-null `parent_design_id`.

Driving the system rather than reading it exposed why the rung was dead, and it
was not the reason previously assumed:

1. Gate B's mechanical tier raises the over-ceiling finding when **one bundle's**
   `effortSpent` exceeds the contract ceiling. But the loop accumulates that same
   `effortSpent` into `spent`. So a budget-exhaustion finding **implies**
   `spent >= ceiling`, always, by construction.
2. The loop's pre-attempt guard breaks out when `spent >= effectiveCeiling` —
   *before* staffing. So the redesign could never be staffed, on any input.

The rung was therefore climbed and recorded on the ledger while nothing was ever
redesigned. Verified live: mission `39a621b3` climbed to `agent_redesign` with
`entryClass: budget_exhaustion` and surrendered with the registry untouched.

Stepping is not an alternative route. A live mission's ladder carries
`maxAttempts: 3`, and one rung per failure reaches `agent_redesign` only as the
*final* climb — after the last attempt has already been spent.

## Options considered

1. **Let the redesign execute.** Rejected: the task has already overrun its
   ceiling. Spending further breaks invariant 7 outright and makes the ceiling
   decorative — "a ceiling that stops nothing is not a ceiling", which is the
   loop's own comment at the guard.
2. **Re-map `budget_exhaustion` to a different rung.** Rejected: it leaves
   `agent_redesign` with no entry class at all, so the rung stays dead and the
   dead-name count goes from eight to nine. It also contradicts the mapping's
   stated reasoning — a design that cannot fit its budget is exactly what a
   *cheaper design* remedies.
3. **Raise `maxAttempts` at intake so stepping reaches the rung.** Rejected:
   inventing a constant to make a mechanism reachable, and it would change the
   attempt economics of every mission in the system to fix one rung.
4. **Produce the redesign; do not run it.** Chosen.

## Decision

When a task exhausts its budget while standing on the `agent_redesign` rung, the
Agent Creator **authors and registers the replacement design** — with the
overspending design as its `parentDesignId` — and the mission loop records an
`agent.redesigned` event saying it was produced but not run. The task then
surrenders as before. No further attempt executes.

Both halves stay honest:

- The **ceiling still stops the spend.** Nothing new executes, so invariant 7 is
  untouched. A distractor test asserts exactly one `task.executed` on this path.
- The **ladder stops lying.** A rung the ledger records as climbed now leaves
  behind the remedy it named. Authoring is an Agent Creator cost, which has never
  been charged to a task's work budget (`spent` accumulates only
  `bundle.effortSpent`), so this introduces no new accounting.

The replacement arrives **unproven**: zero observations, no track record, and —
by R28 AC-2 — unpromotable until a validation harness has graded it. It is not a
reward for failing. It is a cheaper candidate the next task in that category may
bid, carrying its ancestry so its lineage can be scored.

The remedy is taken **only where the contract granted it**. A ladder that
withholds `agent_redesign` mints no lineage, matching `entryRungFor`'s existing
rule that a contract granting only cheap remedies did not silently grant the
expensive ones. That condition was found untested by a mutant that survived all
509 worker tests, and now has a distractor.

## Also fixed here

`redesignFrom` was read from a `let manifest;` declared **inside** the attempt
loop, so it was always `undefined` at the moment it was read and `?? null` turned
that into `null`. Since `parentDesignId` is `typeof redesignFrom === 'string' ?
redesignFrom : null`, every redesign registered as an **origin**. Even had the
rung been reachable, lineage would still never have been born. The design that
last ran is now tracked across attempts.

## Consequences

- **Reversible.** Deleting the block at the guard restores the previous
  behaviour exactly; nothing else depends on it.
- Proven live: mission `6e4c2130` produced design `6934528b` with
  `parent_design_id = 6e25f754`, the first non-null ancestry in the database. The
  recursive clade walk over that real two-generation lineage returns
  `score 0.452, observations 42` for a child with **zero** observations of its
  own — which is the criterion's substance.
- **AC-0 is still not satisfied.** `cladeScoreFor` is called by nothing:
  `bestForCategory` selects on a design's *own* `clade_score`, so the redesign's
  inherited record is ignored and it can never be bid. Carried as a defect.
