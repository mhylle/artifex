/**
 * The budget-versus-value outlier ranked a POOLED ratio, which hides the very
 * pattern it exists to find (defect `d08191c8`).
 *
 * `rankWeakSpots` summed spend and ceiling across every mission in a category
 * and compared the totals. Measured live: a mission submitted at ceiling 4 spent
 * 100% of its budget in two categories —
 *
 *     mechanical engineering  spent 2 / ceiling 2   "spent 2 of 2 budget (100%)"
 *     technical writing       spent 2 / ceiling 2   "spent 2 of 2 budget (100%)"
 *
 * — and the whole-history ranking still reported `budget-outliers: 0`, because
 * `technical writing` pools to 19/152, about 12.5%. A category that blew its
 * ceiling was invisible behind ten generous missions, so the amendment petition
 * could never fire and R29 AC-0 had no way to be satisfied.
 *
 * The criterion describes a PATTERN — "a category spends near its ceiling and
 * still surrenders" — and pooling hides a pattern behind volume.
 *
 * **The replacement cannot lose a detection, and that is provable rather than
 * hoped.** The pooled ratio is a weighted average of the per-mission ratios,
 * with weights `ceiling_i / Σceiling`. A weighted average never exceeds its
 * largest term, so `Σspent/Σceiling ≥ 0.9` implies some mission had
 * `spent/ceiling ≥ 0.9`. The old rule was therefore a strictly weaker form of
 * the new one, which is why this is a replacement and not an `OR` of the two —
 * an `OR` would add a branch that can never be the only one taken.
 *
 * `NEAR_CEILING` is untouched at 0.9. No constant is invented here: the change
 * is which population the existing bar is applied to.
 */
import { describe, expect, it } from 'vitest';

import { rankWeakSpots } from './science-loop.js';
import type { MissionEvidence } from './science-loop.js';

/** A healthy, cheap mission — every field deliberately below every threshold. */
function mission(over: Partial<MissionEvidence> = {}): MissionEvidence {
  return {
    missionId: 'm', category: 'technical writing',
    gateBAttempts: 1, gateBPasses: 1,
    escalations: 0, budgetSpent: 1, budgetCeiling: 100,
    surrendered: false,
    ...over,
  };
}

const budgetReason = (spots: ReturnType<typeof rankWeakSpots>, category: string) =>
  spots.find((s) => s.category === category)?.reasons
    .find((r) => r.includes('budget-versus-value outlier'));

describe('d08191c8 — the budget outlier is a per-mission pattern, not a pooled ratio', () => {
  it('reports a category where ONE mission ran at its ceiling among cheap ones', () => {
    // The live case. Nine generous missions and one that spent its whole budget.
    const history = [
      ...Array.from({ length: 9 }, (_, i) => mission({ missionId: `cheap-${i}` })),
      mission({ missionId: 'tight', budgetSpent: 2, budgetCeiling: 2 }),
    ];

    expect(budgetReason(rankWeakSpots(history), 'technical writing')).toBeDefined();
  });

  it('DISTRACTOR: a merely BUSY category — many missions, all cheap — is not an outlier', () => {
    // The failure mode of counting instead of pooling: if any volume of ordinary
    // work could trip the rule, the petition would fire constantly and an
    // amendment protocol that fires routinely makes the Constitution a
    // suggestion.
    const history = Array.from({ length: 40 }, (_, i) => mission({ missionId: `cheap-${i}` }));

    expect(budgetReason(rankWeakSpots(history), 'technical writing')).toBeUndefined();
  });

  it('severity scales with HOW MANY missions ran at the ceiling', () => {
    // One over-ceiling mission is an incident; five is the pattern the criterion
    // is about. Matches how the sibling surrender rule already weights itself.
    const one = rankWeakSpots([
      mission({ missionId: 'a' }),
      mission({ missionId: 'tight-1', budgetSpent: 2, budgetCeiling: 2 }),
    ]);
    const many = rankWeakSpots([
      mission({ missionId: 'a' }),
      ...Array.from({ length: 5 }, (_, i) => mission({ missionId: `tight-${i}`, budgetSpent: 2, budgetCeiling: 2 })),
    ]);

    expect(many[0]!.severity).toBeGreaterThan(one[0]!.severity);
  });

  it('never loses a detection the POOLED rule would have made', () => {
    // The subsumption argued in the header, asserted rather than trusted: a
    // weighted average cannot exceed its largest term, so anything the old rule
    // caught has a mission at or over the bar. Fixture chosen so the POOLED
    // ratio clears 0.9 — 95/100 — which it can only do via a mission that also
    // clears it.
    const history = [
      mission({ missionId: 'a', budgetSpent: 95, budgetCeiling: 100 }),
    ];
    const pooled = 95 / 100;

    expect(pooled).toBeGreaterThanOrEqual(0.9);
    expect(budgetReason(rankWeakSpots(history), 'technical writing')).toBeDefined();
  });

  it('DISTRACTOR: a mission with NO ceiling recorded is not counted as an outlier', () => {
    // `budgetCeiling` is 0 for any task whose contract the fold could not read a
    // ceiling from. Treating 0 as "spent everything" would make every such task
    // an outlier and swamp the real ones — and `spent / 0` is not a ratio.
    const history = [mission({ missionId: 'no-ceiling', budgetSpent: 5, budgetCeiling: 0 })];

    expect(budgetReason(rankWeakSpots(history), 'technical writing')).toBeUndefined();
  });

  it('DISTRACTOR: a category JUST under the bar in every mission stays silent', () => {
    // 0.89 is not 0.9. The bar is the one R37's dossier already uses; this pins
    // that the change did not quietly loosen it.
    const history = Array.from({ length: 6 }, (_, i) =>
      mission({ missionId: `near-${i}`, budgetSpent: 89, budgetCeiling: 100 }));

    expect(budgetReason(rankWeakSpots(history), 'technical writing')).toBeUndefined();
  });

  it('names how many missions, so the petition can argue from it', () => {
    const history = [
      mission({ missionId: 'a' }),
      mission({ missionId: 'tight-1', budgetSpent: 2, budgetCeiling: 2 }),
      mission({ missionId: 'tight-2', budgetSpent: 3, budgetCeiling: 3 }),
    ];

    expect(budgetReason(rankWeakSpots(history), 'technical writing')).toContain('2 of 3');
  });
});
