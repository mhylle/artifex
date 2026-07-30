/**
 * R27 — the science loop: mine, hypothesize, experiment, replicate, adopt.
 *
 * R11 gave the Learning Agent a read-only projection and a propose-only
 * emitter, both per-mission. What was missing is the loop that turns many
 * missions into a ranked list of weak spots, tests candidates comparably, and
 * refuses to adopt anything on the strength of one good run.
 *
 * The whole requirement is one idea applied four times: **evidence, not
 * enthusiasm**. Rank from what the ledger recorded rather than a hunch; give
 * every candidate the same budget so the comparison means something; demand a
 * result that reproduces; and demand it hold on a slice it was never tuned
 * against.
 */
import { describe, expect, it } from 'vitest';

import { adoptionDecision, experimentPlan, rankWeakSpots } from './science-loop.js';
import type { CandidateResult, MissionEvidence } from './science-loop.js';

const evidence = (over: Partial<MissionEvidence> = {}): MissionEvidence => ({
  missionId: 'm-1',
  category: 'answering',
  gateBAttempts: 2,
  gateBPasses: 2,
  escalations: 0,
  budgetSpent: 5,
  budgetCeiling: 20,
  surrendered: false,
  ...over,
});

describe('R27 AC-0 — weak spots are ranked from evidence, not from a hunch', () => {
  it('ranks a category with a poor compliance rate above a healthy one', async () => {
    const ranked = rankWeakSpots([
      evidence({ category: 'healthy', gateBAttempts: 4, gateBPasses: 4 }),
      evidence({ category: 'struggling', gateBAttempts: 4, gateBPasses: 1 }),
    ]);

    expect(ranked[0]?.category).toBe('struggling');
    expect(ranked[0]?.reasons.join(' ')).toMatch(/complian|pass/i);
  });

  it('names ESCALATION HOT SPOTS — work that only ever succeeds by climbing', async () => {
    // A category that passes eventually but always after escalation is not
    // healthy: it is expensive, and the cost is invisible in a pass rate.
    const ranked = rankWeakSpots([
      evidence({ category: 'cheap', gateBAttempts: 2, gateBPasses: 2, escalations: 0 }),
      evidence({ category: 'costly', gateBAttempts: 2, gateBPasses: 2, escalations: 6 }),
    ]);

    expect(ranked[0]?.category).toBe('costly');
    expect(ranked[0]?.reasons.join(' ')).toMatch(/escalat/i);
  });

  it('names BUDGET-VERSUS-VALUE outliers — near the ceiling for the same result', async () => {
    const ranked = rankWeakSpots([
      evidence({ category: 'lean', budgetSpent: 2, budgetCeiling: 20 }),
      evidence({ category: 'expensive', budgetSpent: 19, budgetCeiling: 20 }),
    ]);

    expect(ranked[0]?.category).toBe('expensive');
    expect(ranked[0]?.reasons.join(' ')).toMatch(/budget|ceiling/i);
  });

  it('counts SURRENDERS as the strongest signal a category is weak', async () => {
    // The surrendering category is otherwise HEALTHY — every verdict it got, it
    // passed. It still outranks a category that merely fails a lot, because
    // stopping is worse than struggling.
    //
    // A first version gave the surrendering category a 0/1 pass rate too, so it
    // ranked first on compliance alone and a mutant that all but removed the
    // surrender weight survived. The fixture has to isolate the one signal it
    // claims to be testing.
    const ranked = rankWeakSpots([
      evidence({ category: 'failing', gateBAttempts: 4, gateBPasses: 0 }),
      evidence({ category: 'blocked', gateBAttempts: 2, gateBPasses: 2, surrendered: true }),
    ]);

    expect(ranked[0]?.category).toBe('blocked');
    expect(ranked[0]?.reasons.join(' ')).toMatch(/surrender/i);
  });

  it('aggregates ACROSS missions — one bad mission is not a weak category', async () => {
    // The criterion says "a completed mission history". A single failure is
    // noise; a category that fails repeatedly is a weak spot. Ranking per
    // mission would promote whichever mission happened to go worst last.
    const ranked = rankWeakSpots([
      evidence({ missionId: 'm-1', category: 'mostly-fine', gateBAttempts: 10, gateBPasses: 10 }),
      evidence({ missionId: 'm-2', category: 'mostly-fine', gateBAttempts: 2, gateBPasses: 0 }),
      evidence({ missionId: 'm-3', category: 'always-bad', gateBAttempts: 4, gateBPasses: 1 }),
    ]);

    expect(ranked[0]?.category).toBe('always-bad');
  });

  it('DISTRACTOR: only categories the history actually contains are ranked', async () => {
    // Ranking something never observed would be exactly the unevidenced hunch
    // the criterion forbids.
    //
    // A first version passed a HEALTHY category here and expected to see it
    // ranked, which was simply the wrong input: a healthy category is correctly
    // ranked as nothing at all. Corrected to a weak one, so the assertion is
    // about which categories can appear rather than about severity.
    const ranked = rankWeakSpots([evidence({ category: 'observed', gateBAttempts: 4, gateBPasses: 0 })]);

    expect(ranked.map((r) => r.category)).toEqual(['observed']);
  });

  it('DISTRACTOR: a healthy history ranks nothing as weak', async () => {
    // "Always find something to fix" would send the loop chasing noise forever.
    const ranked = rankWeakSpots([
      evidence({ category: 'fine', gateBAttempts: 8, gateBPasses: 8, escalations: 0, budgetSpent: 3 }),
    ]);

    expect(ranked).toEqual([]);
  });

  it('every ranked entry carries the EVIDENCE for its rank', async () => {
    const ranked = rankWeakSpots([evidence({ category: 'bad', gateBAttempts: 4, gateBPasses: 0 })]);

    expect(ranked[0]?.observations).toBeGreaterThan(0);
    expect(ranked[0]?.reasons.length).toBeGreaterThan(0);
  });
});

describe('R27 AC-1 — every candidate gets the SAME fixed evaluation budget', () => {
  it('assigns an identical budget to heterogeneous candidates', async () => {
    const plan = experimentPlan(['prompt-tweak', 'new-tier-policy', 'different-decomposition'], {
      totalBudget: 30, benchCases: ['c-1', 'c-2'],
    });

    expect(plan.map((p) => p.budget)).toEqual([10, 10, 10]);
  });

  it('gives every candidate the SAME cases — a different bench is a different exam', async () => {
    const plan = experimentPlan(['a', 'b'], { totalBudget: 20, benchCases: ['c-1', 'c-2'] });

    expect(plan[0]?.cases).toEqual(plan[1]?.cases);
  });

  it('DISTRACTOR: refuses to plan when the budget cannot be split evenly enough to compare', async () => {
    // An unequal split makes the comparison meaningless while still producing
    // numbers, which is worse than refusing: nobody would notice.
    expect(() => experimentPlan(['a', 'b', 'c'], { totalBudget: 2, benchCases: ['c-1'] }))
      .toThrow(/budget|comparable/i);
  });

  it('DISTRACTOR: refuses to plan against an EMPTY bench', async () => {
    // Zero cases produces a perfect score for every candidate.
    expect(() => experimentPlan(['a'], { totalBudget: 10, benchCases: [] })).toThrow(/bench|cases/i);
  });
});

const result = (over: Partial<CandidateResult> = {}): CandidateResult => ({
  candidateId: 'cand-1',
  runs: [{ won: true, slice: 'open' }, { won: true, slice: 'open' }],
  heldOut: { won: true, slice: 'sealed' },
  ...over,
});

describe('R27 AC-2 — adoption needs replication AND a held-out win', () => {
  it('adopts a candidate that replicated and held out', async () => {
    expect(adoptionDecision(result()).adopt).toBe(true);
  });

  it('REFUSES a candidate that replicated but failed the held-out slice', async () => {
    // Winning only where it was tuned is the definition of overfitting, and the
    // held-out slice exists precisely to catch it.
    const d = adoptionDecision(result({ heldOut: { won: false, slice: 'sealed' } }));

    expect(d.adopt).toBe(false);
    expect(d.reason).toMatch(/held-out|tuned/i);
  });

  it('REFUSES a candidate with no held-out run at all', async () => {
    // Absent is not a pass. An untested slice would let a candidate be adopted
    // on the strength of the only exam it sat.
    const d = adoptionDecision(result({ heldOut: null }));

    expect(d.adopt).toBe(false);
    expect(d.reason).toMatch(/held-out|never/i);
  });
});

describe('R27 AC-3 — one lucky win adopts nothing, and the loss is still evidence', () => {
  it('refuses a candidate that won exactly once', async () => {
    const d = adoptionDecision(result({ runs: [{ won: true, slice: 'open' }] }));

    expect(d.adopt).toBe(false);
    expect(d.reason).toMatch(/once|replicat|single/i);
  });

  it('refuses a candidate that won once and lost once — that is noise, not a win', async () => {
    const d = adoptionDecision(result({ runs: [{ won: true, slice: 'open' }, { won: false, slice: 'open' }] }));

    expect(d.adopt).toBe(false);
  });

  it('RECORDS the discarded result as evidence for future hypotheses', async () => {
    // The half people forget. A rejected candidate is a measurement, and
    // throwing it away means the next hypothesis re-runs the same experiment.
    const d = adoptionDecision(result({ runs: [{ won: true, slice: 'open' }] }));

    expect(d.evidence).toMatchObject({ candidateId: 'cand-1', wins: 1, losses: 0 });
  });

  it('DISTRACTOR: a rejected candidate still records its HELD-OUT outcome', async () => {
    // Knowing it failed the held-out slice is the most useful thing about it —
    // it says the idea does not transfer, which is different from it being weak.
    const d = adoptionDecision(result({ heldOut: { won: false, slice: 'sealed' } }));

    expect(d.evidence.heldOutWon).toBe(false);
  });

  it('DISTRACTOR: an ADOPTED candidate records its evidence too', async () => {
    // Evidence is not a consolation prize for losers. A later regression needs
    // to know what the adoption was based on.
    const d = adoptionDecision(result());

    expect(d.adopt).toBe(true);
    expect(d.evidence).toMatchObject({ wins: 2, losses: 0, heldOutWon: true });
  });
});
