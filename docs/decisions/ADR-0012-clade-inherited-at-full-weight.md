# ADR-0012 — An inherited clade score is used at full weight, with no generation decay

- **Status:** accepted
- **Date:** 2026-07-31
- **Context:** R28 AC-0, defect `e4b171c1`

## Context

`AssetRegistryRepository.cladeScoreFor()` — the recursive CTE that walks a
design's ancestors and takes an observation-weighted mean — was correct,
thoroughly tested, and **called by nothing**. The ninth "name in the vocabulary
with no behaviour" this project has found.

The one place a design's standing decides anything, `bestForCategory`, filtered
and ordered on the design's **own** `clade_score` column. So the clade walk sat
beside the decision rather than inside it, and AC-0 — "when its promotion is
*considered*, then the *decision* uses a clade score aggregating how its whole
lineage performed" — was unmet. A query nobody calls considers nothing.

Measured on the live database: the first redesigned child ever produced
(`6934528b`, parent `6e25f754`) carried `clade_score NULL, observations 0` and
was excluded from every bid, while the walk over its real lineage returned
`score 0.452` across `42` observations.

## The question

Once the decision reads the lineage, should an inherited score be **discounted by
generation distance**? An unproven child is not its parent, and letting it
inherit a thirty-run reputation intact is a real risk.

## Options considered

1. **A decay factor per generation** (e.g. multiply by 0.9 per hop). Rejected:
   the factor would be invented. Nothing in the ledger, the registry, or the
   dossier says what a generation is worth, and a constant chosen to feel right
   is exactly the shape this project has repeatedly had to remove (`effortSpent`
   was `1`; see entry 066).
2. **Require some minimum of the design's OWN observations before it can bid.**
   Rejected: it re-creates the bug. A freshly redesigned agent has zero own
   observations by definition, so the escalation ladder's redesigns would remain
   unbiddable and the rung would still change nothing.
3. **Full weight, relying on the existing observation weighting.** Chosen.

## Decision

The inherited score is used **unchanged**, and the evidence bar
(`minObservations`, default 3) counts the **lineage's** observations rather than
the design's own.

The observation weighting *is* the discount, and it is **derived rather than
chosen**: a child's single run barely moves a parent's thirty-run mean, and the
mean shifts toward the child exactly as fast as the child accumulates evidence.
That is the same anti-anecdote property the criterion asks for — "not the outcome
of one lucky audition" — applied to inheritance instead of to a short record. A
decay term would add a second, arbitrary discount on top of a principled one.

**Ties break on the design's own observations.** A child and its parent share one
lineage, so their clade scores are identical by construction. Without a
deterministic tie-break an unrun redesign could evict the incumbent it was
derived from — inheriting standing it had done nothing to earn. Inherited
standing gets a design into the room; its own record wins the seat. This follows
the ordering the query already used and introduces no new constant.

## Consequences

- **Reversible.** The change is confined to one query; restoring the previous
  `WHERE`/`ORDER BY` restores the old behaviour exactly.
- Proven live, both directions, against the real database:

  | rule | candidates for category `mission` |
  |---|---|
  | old | `6e25f754` only — the redesign was invisible to the decision |
  | new | `6e25f754` (own 42) **and** `6934528b` (own **0**, clade 0.4524 over **42** inherited observations) |

  Mission `a4696805` then ran through the new selection end to end and delivered,
  reusing the proven incumbent — the tie-break holding in the live system.
- A retired (`active = false`) design is still never bid, but its record remains
  in its descendants' lineage. That is the intended reading of "down-weight,
  never delete": the design stops competing, its evidence does not evaporate.
- **Known limitation, deliberately not fixed here.** The evidence bar can now be
  cleared entirely by ancestry: a design with zero runs of its own is biddable if
  its lineage has three. That is the point — it is what makes a redesign usable —
  but it means the *first* run of a redesigned agent is taken on inherited
  credit. The tie-break confines the exposure to categories where the incumbent
  is retired or absent. If that proves too loose, the derived fix is a floor on
  own observations *once the design has been bid at least once*, not a decay
  constant.
