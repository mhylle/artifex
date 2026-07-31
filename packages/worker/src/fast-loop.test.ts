/**
 * R26 — the fast loop: bounded in-mission hot-fixes that auto-revert.
 *
 * The other half of the two-speed learning cadence. R27 built the SLOW loop —
 * mine, hypothesize, experiment, replicate, transfer-test, adopt by ratchet,
 * all between missions. This one runs WHILE a mission runs, which is what makes
 * every one of its bounds load-bearing: there is no human in the way and no
 * between-missions pause in which to notice a mistake.
 *
 * Two constants that are deliberately NOT invented here:
 *
 *   "repeatedly"  — the trigger reuses the contract's own
 *                   `stoppingConditions.stallLimit`, which is already the
 *                   system's definition of "the same thing has happened enough
 *                   times to act on it" (R36's stall counter uses it for exactly
 *                   that). A second, different number for the same idea would be
 *                   two answers to one question.
 *
 *   the window    — the evaluation window is the number of observations the
 *                   BASELINE rests on, so before and after are compared over
 *                   equal evidence. Anything else compares a long record against
 *                   a short one and calls the difference an effect.
 *
 * And one that is deliberately absent: there is no significance threshold. The
 * revert rule is "revert unless it strictly improved", which is AC-1's own
 * wording ("does not move") and needs no magnitude. See ADR-0013.
 */
import { describe, expect, it } from 'vitest';

import {
  detectHotSpot,
  hotFixPlan,
  revertDecision,
  type GateBOutcome,
} from './fast-loop.js';

/** `n` Gate B results for one category/criterion, `failed` of them failures. */
function outcomes(
  category: string,
  criterionId: string,
  results: readonly boolean[],
): GateBOutcome[] {
  return results.map((passed, i) => ({
    taskId: `task-${category}-${criterionId}-${i}`,
    category,
    criterionId,
    passed,
  }));
}

describe('R26 AC-0 — the trigger: one category failing Gate B repeatedly on the SAME criterion', () => {
  it('fires once the same criterion has failed stallLimit times', async () => {
    const spot = detectHotSpot(outcomes('summarising', 'c-1', [false, false]), 2);

    expect(spot?.category).toBe('summarising');
    expect(spot?.criterionId).toBe('c-1');
  });

  it('DISTRACTOR: does NOT fire below the limit', async () => {
    // One failure is a task going wrong; that is what the escalation ladder is
    // for. Patching the worker layer on a single observation would make the
    // fast loop the noisiest thing in the system.
    expect(detectHotSpot(outcomes('summarising', 'c-1', [false]), 2)).toBeNull();
  });

  it('DISTRACTOR: failures spread across DIFFERENT criteria do not add up', async () => {
    // The criterion names the pattern. Two failures on two different criteria
    // are two different problems, and a patch aimed at their sum is aimed at
    // nothing. This is the fixture the naive `count failures per category`
    // implementation gets wrong.
    const spread = [
      ...outcomes('summarising', 'c-1', [false]),
      ...outcomes('summarising', 'c-2', [false]),
    ];

    expect(detectHotSpot(spread, 2)).toBeNull();
  });

  it('DISTRACTOR: failures on the same criterion in DIFFERENT categories do not add up', async () => {
    // The mirror image, and the one a "count per criterion" implementation gets
    // wrong. Criterion ids are only unique within a contract, so summing across
    // categories would merge unrelated tasks that happen to share `c-1`.
    const spread = [
      ...outcomes('summarising', 'c-1', [false]),
      ...outcomes('extracting', 'c-1', [false]),
    ];

    expect(detectHotSpot(spread, 2)).toBeNull();
  });

  it('DISTRACTOR: a category that PASSES is not a hot spot however often it runs', async () => {
    expect(detectHotSpot(outcomes('summarising', 'c-1', [true, true, true, true]), 2)).toBeNull();
  });

  it('picks the WORST hot spot when several qualify, not merely the first', async () => {
    // Two candidates, and the weaker one is deliberately placed FIRST so that
    // "first match" and "worst match" cannot coincide — a fixture where they do
    // is the one that lets a `find()` masquerade as a ranking.
    const both = [
      ...outcomes('mild', 'c-1', [false, false, true, true]), // 2 of 4 fail
      ...outcomes('severe', 'c-1', [false, false, false, false]), // 4 of 4 fail
    ];

    expect(detectHotSpot(both, 2)?.category).toBe('severe');
  });
});

describe('R26 AC-0 — the patch: exactly one, bounded, with its bounds and predicted effect', () => {
  const spot = () => detectHotSpot(outcomes('summarising', 'c-1', [false, false, false, true]), 2)!;

  it('produces exactly ONE patch', async () => {
    // "applies exactly one bounded worker-layer patch". A fast loop that fires
    // three changes at once cannot attribute the result to any of them, which
    // makes the auto-revert in AC-1 meaningless.
    const plan = hotFixPlan(spot(), { designId: 'design-1', roleInstructions: 'Summarise it.' });

    expect(plan.patches).toHaveLength(1);
  });

  it('targets the WORKER layer', async () => {
    const plan = hotFixPlan(spot(), { designId: 'design-1', roleInstructions: 'Summarise it.' });

    expect(plan.patches[0]!.target.layer).toBe('worker');
  });

  it('carries its BOUNDS — the evaluation window, sized to the baseline evidence', async () => {
    // 4 observations behind the baseline, so the window is 4. Equal evidence on
    // both sides, derived rather than chosen.
    const plan = hotFixPlan(spot(), { designId: 'design-1', roleInstructions: 'Summarise it.' });

    expect(plan.bounds.windowObservations).toBe(4);
  });

  it('carries its PREDICTED EFFECT, derived from what the category manages elsewhere', async () => {
    // The first version of this test used a single-criterion fixture, where the
    // predicted rate could only equal the baseline — and "predicted = baseline"
    // predicts nothing. The fixture was the thing that was wrong: a prediction
    // needs a reference, and the system already has one. `c-1` fails 3 of 4
    // while the same category's `c-2` fails 1 of 10, so the fix predicts `c-1`
    // comes down toward the 0.1 its peers manage — measured, not chosen.
    const withPeers = [
      ...outcomes('summarising', 'c-1', [false, false, false, true]),
      ...outcomes('summarising', 'c-2', [false, true, true, true, true, true, true, true, true, true]),
    ];
    const plan = hotFixPlan(detectHotSpot(withPeers, 2)!, {
      designId: 'design-1', roleInstructions: 'Summarise it.',
    });

    expect(plan.predictedEffect.baselineFailureRate).toBeCloseTo(0.75, 5);
    expect(plan.predictedEffect.predictedFailureRate).toBeCloseTo(0.1, 5);
    expect(plan.predictedEffect.basis).toBe('peer_criteria');
  });

  it('DISTRACTOR: with NO peer criteria the prediction degrades honestly, it does not invent one', async () => {
    // The fallback must be the weakest true claim — strictly better than
    // baseline — and must SAY that is what it is. Defaulting to some fraction of
    // the baseline would be exactly the invented constant this design avoids,
    // and it would be indistinguishable from a measured prediction downstream.
    const plan = hotFixPlan(spot(), { designId: 'design-1', roleInstructions: 'Summarise it.' });

    expect(plan.predictedEffect.basis).toBe('strict_improvement');
    expect(plan.predictedEffect.predictedFailureRate).toBeCloseTo(0.75, 5);
  });

  it('DISTRACTOR: a peer rate that is not BETTER than the baseline is not used as a prediction', async () => {
    // Peers failing worse than the patched criterion would set a bar the fix
    // clears by standing still. The basis has to fall back, or the recorded
    // "prediction" would be a licence rather than a claim.
    // Getting here needs care, and the first fixture missed it: the hot spot is
    // the WORST qualifying pair, so its peers are usually better by
    // construction. A peer can still be worse when it has not yet qualified —
    // `c-2` fails its only attempt (rate 1.0) but one failure is below the
    // repeat limit, so `c-1` is the hot spot at 0.5 with a peer pooling to 1.0.
    const worsePeers = [
      ...outcomes('summarising', 'c-1', [false, false, true, true]), // 0.5, qualifies
      ...outcomes('summarising', 'c-2', [false]), // 1.0, only one failure — not a hot spot
    ];
    const plan = hotFixPlan(detectHotSpot(worsePeers, 2)!, {
      designId: 'design-1', roleInstructions: 'Summarise it.',
    });

    expect(plan.predictedEffect.basis).toBe('strict_improvement');
  });
});

describe('R26 AC-1 — revert is the DEFAULT, not the exception', () => {
  const plan = () =>
    hotFixPlan(detectHotSpot(outcomes('summarising', 'c-1', [false, false, false, true]), 2)!, {
      designId: 'design-1',
      roleInstructions: 'Summarise it.',
    });

  it('reverts when the failure rate does not move', async () => {
    // Same 3-in-4 after the patch as before it.
    const decision = revertDecision(plan(), outcomes('summarising', 'c-1', [false, false, false, true]));

    expect(decision.revert).toBe(true);
    expect(decision.windowClosed).toBe(true);
  });

  it('reverts when the failure rate gets WORSE', async () => {
    const decision = revertDecision(plan(), outcomes('summarising', 'c-1', [false, false, false, false]));

    expect(decision.revert).toBe(true);
  });

  it('KEEPS a hot-fix whose failure rate strictly improved', async () => {
    // The rule has to be able to say yes, or it is not a rule, it is a delete.
    const decision = revertDecision(plan(), outcomes('summarising', 'c-1', [false, true, true, true]));

    expect(decision.revert).toBe(false);
  });

  it('DISTRACTOR: a window that closed with NO observations reverts', async () => {
    // The strongest form of "revert is the default". An improvement nobody
    // measured is not an improvement, and treating "no evidence against" as
    // "evidence for" is how an unevaluated change becomes permanent.
    //
    // The first version of this test drove `revertDecision(plan(), [])` and
    // expected a revert, which exposed a real hole rather than a wrong
    // expectation: a window that closes ONLY by filling can never close when the
    // patched category stops appearing, so the hot-fix would outlive the mission
    // that made it — precisely what AC-1 forbids. The window therefore also
    // closes when the mission ends, and the test now drives that.
    const decision = revertDecision(plan(), [], { missionEnded: true });

    expect(decision.windowClosed).toBe(true);
    expect(decision.revert).toBe(true);
    expect(decision.reason).toMatch(/no observ|unmeasured|no evidence/i);
  });

  it('a mission ending closes a PARTIALLY filled window too, and it still reverts', async () => {
    // Two observations against a window of four, both passes. Under-evidenced is
    // not the same as improved, and the mission is over — there will be no more
    // evidence. Revert.
    const decision = revertDecision(plan(), outcomes('summarising', 'c-1', [true, true]), {
      missionEnded: true,
    });

    expect(decision.windowClosed).toBe(true);
    expect(decision.revert, 'a half-filled window was accepted as proof').toBe(true);
  });

  it('DISTRACTOR: the window is not closed until it has filled, and nothing is decided early', async () => {
    // A lucky first result must not end the evaluation. Judging at n=1 would
    // make the verdict a coin flip and the auto-revert theatre.
    const decision = revertDecision(plan(), outcomes('summarising', 'c-1', [true]));

    expect(decision.windowClosed, 'a 1-observation window was treated as closed').toBe(false);
    expect(decision.revert, 'an open window must not revert either — it is simply undecided').toBe(false);
  });

  it('DISTRACTOR: only observations of the PATCHED category and criterion count', async () => {
    // The window measures the thing the patch aimed at. Filling it with an
    // unrelated category's passes would let any patch look successful by being
    // followed by unrelated good news.
    const decision = revertDecision(plan(), outcomes('extracting', 'c-9', [true, true, true, true]));

    expect(decision.windowClosed, 'unrelated observations filled the window').toBe(false);
  });
});
