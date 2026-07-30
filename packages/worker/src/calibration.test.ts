/**
 * R35 — the reviewer is measured, not trusted.
 *
 * Every gate in Artifex is a model asked a question, and the constitution says
 * the learner does not own the yardstick. But nothing ever checked the
 * *yardstick itself*: a verdict was issued once and never compared against a
 * second opinion, and rubber-stamping was assumed away rather than measured.
 *
 * Three mechanisms, and they fail differently on purpose:
 *
 *   calibration    re-review a sample and record DISAGREEMENT. Catches drift and
 *                  noise — a reviewer that is inconsistent with itself.
 *   probes         inject work that is known-bad and record a MISS. Catches the
 *                  failure calibration cannot: a reviewer consistently wrong in
 *                  the same direction agrees with itself perfectly.
 *   independence   the verifier must not be the agent that produced the work.
 *
 * The middle one is why `627cd71c` matters. Unanimity sampling (ADR-0010) catches
 * an unreliable judge; when every sample is wrong the same way, sampling is
 * silent. Only a known answer catches that.
 */
import { describe, expect, it } from 'vitest';

import { calibrationOf, independenceViolation, probeMisses } from './calibration.js';
import type { MissionSeams } from './mission-loop.js';
import type { IssuedVerdict, ReReview } from './calibration.js';

const verdict = (
  taskId: string,
  outcome: 'pass' | 'fail',
  reviewerId = 'reviewer-1',
): IssuedVerdict => ({ taskId, outcome, reviewerId, verdictId: `v-${taskId}` });

const reReview = (taskId: string, outcome: 'pass' | 'fail'): ReReview => ({
  taskId, outcome, reviewerId: 'reviewer-2',
});

describe('R35 AC-0 — disagreement between a verdict and its re-review is a measurement', () => {
  it('records agreement and disagreement as a rate, not a verdict', async () => {
    // A calibration measurement is DATA about the reviewer. Turning it into a
    // verdict would put the yardstick in the business of overruling the thing it
    // is measuring, which is the constitution's line about the learner not
    // owning the yardstick.
    const sampled = [verdict('t-1', 'pass'), verdict('t-2', 'fail'), verdict('t-3', 'pass')];
    const re = [reReview('t-1', 'pass'), reReview('t-2', 'pass'), reReview('t-3', 'pass')];

    const c = calibrationOf(sampled, re);

    expect(c.compared).toBe(3);
    expect(c.disagreements).toBe(1);
    expect(c.agreementRate).toBeCloseTo(2 / 3);
  });

  it('names WHICH task disagreed, so the measurement is investigable', async () => {
    const c = calibrationOf([verdict('t-1', 'pass')], [reReview('t-1', 'fail')]);

    expect(c.disagreed).toEqual([{ taskId: 't-1', original: 'pass', reReview: 'fail' }]);
  });

  it('DISTRACTOR: a verdict with NO re-review is not counted as agreement', async () => {
    // Silence is not agreement — the same rule Gate A applies to an unassessed
    // criterion. Counting unreviewed verdicts as agreeing would make a reviewer
    // that is never sampled look perfectly calibrated.
    const c = calibrationOf([verdict('t-1', 'pass'), verdict('t-2', 'fail')], [reReview('t-1', 'pass')]);

    expect(c.compared).toBe(1);
    expect(c.agreementRate).toBe(1);
  });

  it('DISTRACTOR: a re-review of a task with NO original verdict counts nothing', async () => {
    // Calibration compares a verdict against a second opinion. A second opinion
    // with no first opinion has nothing to disagree WITH, and counting it would
    // inflate the sample size with comparisons that never happened.
    //
    // Added because a mutant that counted these survived: the earlier tests
    // passed MORE issued verdicts than re-reviews, and the loop walks the
    // re-reviews, so the unmatched branch was never reached. The reachable
    // shape is the opposite one — a re-review nobody issued a verdict for.
    const c = calibrationOf([verdict('t-1', 'pass')], [reReview('t-1', 'pass'), reReview('t-99', 'fail')]);

    expect(c.compared).toBe(1);
    expect(c.agreementRate).toBe(1);
  });

  it('DISTRACTOR: a re-review by the SAME reviewer is not independent and is refused', async () => {
    // "Independently re-reviewed" is the criterion. A reviewer agreeing with
    // itself measures nothing at all, and would report a flawless agreement rate
    // precisely when the reviewer is most consistently wrong.
    const sameReviewer: ReReview = { taskId: 't-1', outcome: 'pass', reviewerId: 'reviewer-1' };

    const c = calibrationOf([verdict('t-1', 'pass')], [sameReviewer]);

    expect(c.compared).toBe(0);
    expect(c.refused).toEqual([{ taskId: 't-1', reason: 'the re-review came from the original reviewer' }]);
  });

  it('DISTRACTOR: nothing sampled reports no rate rather than a perfect one', async () => {
    // 0/0 is not 100%. A confident "1.0" from an empty sample is the most
    // misleading number this function could return.
    const c = calibrationOf([], []);

    expect(c.compared).toBe(0);
    expect(c.agreementRate).toBeNull();
  });
});

describe('R35 AC-1 — a planted known-bad output that passes is a recorded MISS', () => {
  const probe = (taskId: string, shouldFail: boolean) => ({ taskId, expected: shouldFail ? 'fail' as const : 'pass' as const });

  it('records a miss when the reviewer passes work planted as bad', async () => {
    const misses = probeMisses([probe('p-1', true)], [verdict('p-1', 'pass')]);

    expect(misses).toEqual([{ taskId: 'p-1', expected: 'fail', actual: 'pass' }]);
  });

  it('DISTRACTOR: catching the planted bad output is NOT a miss', async () => {
    // Without this, "everything is a miss" would satisfy the test above.
    expect(probeMisses([probe('p-1', true)], [verdict('p-1', 'fail')])).toEqual([]);
  });

  it('DISTRACTOR: a known-GOOD probe failed is also a miss — over-rejection is a defect too', async () => {
    // Rubber-stamping is one failure mode; reflexive rejection is the other, and
    // the tier-2 judges have shown far more of the second (ADR-0010). A
    // calibration that only measured leniency would have missed all of it.
    const misses = probeMisses([probe('p-2', false)], [verdict('p-2', 'fail')]);

    expect(misses).toEqual([{ taskId: 'p-2', expected: 'pass', actual: 'fail' }]);
  });

  it('DISTRACTOR: a probe the reviewer never saw is not scored', async () => {
    // An unprocessed probe says nothing about the reviewer. Counting it as a
    // miss would punish the reviewer for work that never reached it.
    expect(probeMisses([probe('p-3', true)], [])).toEqual([]);
  });
});

describe('R35 AC-2 — the verifier is not the agent that produced the work', () => {
  it('refuses a verifier that IS the producing design', async () => {
    expect(independenceViolation({ producerDesignId: 'd-1', verifierDesignId: 'd-1' }))
      .toMatch(/same design/i);
  });

  it('refuses a verifier that shares an ANCESTOR with the producer', async () => {
    // Lineage, not identity. Two designs promoted from one parent inherit its
    // prompt and its blind spots, so one grading the other is closer to
    // self-review than to independent verification.
    const violation = independenceViolation({
      producerDesignId: 'd-1',
      verifierDesignId: 'd-2',
      producerAncestry: ['d-0'],
      verifierAncestry: ['d-0'],
    });

    expect(violation).toMatch(/lineage|ancestor/i);
  });

  it('DISTRACTOR: unrelated designs are allowed — independence is the rule, not scarcity', async () => {
    // A check that refused everything would make verification impossible rather
    // than independent.
    expect(independenceViolation({
      producerDesignId: 'd-1',
      verifierDesignId: 'd-2',
      producerAncestry: ['d-0'],
      verifierAncestry: ['d-9'],
    })).toBeNull();
  });

  /**
   * A limitation, stated rather than hidden.
   *
   * Nothing in Artifex sets `parent_design_id` today (defect `cb939996`), so no
   * live design HAS recorded ancestry and the lineage half of this check cannot
   * fire in production. The identity half can and does.
   *
   * Left as a real check rather than deferred, because the data it needs is
   * already modelled — R28 added the column and the recursive clade query — and
   * a check written when the producer arrives is a check written under pressure.
   */
  it('KNOWN LIMITATION: with no recorded ancestry, only the identity check can fire', async () => {
    expect(independenceViolation({ producerDesignId: 'd-1', verifierDesignId: 'd-2' })).toBeNull();
    expect(independenceViolation({ producerDesignId: 'd-1', verifierDesignId: 'd-1' })).not.toBeNull();
  });
});

/**
 * The producer half — because a correct measurement nothing runs is inert, the
 * failure shape this project has hit four times.
 */
describe('R35 — the mission loop actually measures its reviewer', () => {
  it('records a calibration measurement on a DELIVERED mission', async () => {
    const { runMission } = await import('./mission-loop.js');
    const { seams, mission } = await import('./__fixtures__/calibration-fixture.js');

    const result = await runMission(mission(), seams({ reReviewAs: 'fail' }), { now: () => '2026-07-31T09:00:00.000Z' });

    const measured = result.trail.find((e) => e.type === 'reviewer.calibrated');
    expect(measured, 'the reviewer was never measured').toBeDefined();
    expect(measured?.payload['disagreements']).toBe(1);
  });

  it('records one on a SURRENDERED mission too — those verdicts most need re-review', async () => {
    // R37's pedigree was attached to only one of two terminal paths and silently
    // missed half the missions. Same shape, so both paths are asserted.
    const { runMission } = await import('./mission-loop.js');
    const { seams, mission } = await import('./__fixtures__/calibration-fixture.js');

    const result = await runMission(mission(), seams({ reReviewAs: 'fail', gateBPasses: false }), { now: () => '2026-07-31T09:00:00.000Z' });

    expect(result.outcome).toBe('surrendered');
    expect(result.trail.map((e) => e.type)).toContain('reviewer.calibrated');
  });

  it('DISTRACTOR: a probe the reviewer got wrong is recorded as a MISS', async () => {
    const { runMission } = await import('./mission-loop.js');
    const { seams, mission } = await import('./__fixtures__/calibration-fixture.js');

    const result = await runMission(
      mission(),
      seams({ reReviewAs: 'pass', probeExpecting: 'fail' }),
      { now: () => '2026-07-31T09:00:00.000Z' },
    );

    const measured = result.trail.find((e) => e.type === 'reviewer.calibrated');
    expect((measured?.payload['misses'] as unknown[]).length).toBe(1);
  });

  it('DISTRACTOR: a mission with NO verdicts records no measurement at all', async () => {
    // A mission that surrenders before Gate B ever runs has produced nothing to
    // calibrate against. Recording an empty measurement would put a row in the
    // trail that reads as "the reviewer was checked and found faultless" — the
    // same 0/0-is-not-100% trap `calibrationOf` already guards, one layer up.
    //
    // Added because a mutant removing the guard survived: every other fixture
    // produces at least one verdict, so the branch was unreachable.
    const { runMission } = await import('./mission-loop.js');
    const { seams, mission } = await import('./__fixtures__/calibration-fixture.js');

    const noVerdicts: MissionSeams = {
      ...seams({ reReviewAs: 'fail' }),
      clarityJudge: {
        async assess() {
          // Bounced forever: the worker never delivers, so Gate B never runs.
          return { restatement: 'unclear', ambiguities: ['which fact?'] };
        },
      },
    };

    const result = await runMission(mission(), noVerdicts, { now: () => '2026-07-31T09:00:00.000Z' });

    expect(result.trail.map((e) => e.type)).not.toContain('gate_b.verdict_issued');
    expect(result.trail.map((e) => e.type)).not.toContain('reviewer.calibrated');
  });

  it('DISTRACTOR: no calibration seam means no measurement, and no failure', async () => {
    // Every caller predates this. A mission without the seam must run exactly as
    // before rather than throwing or recording an empty measurement that reads
    // like a reviewer nobody could fault.
    const { runMission } = await import('./mission-loop.js');
    const { seams, mission } = await import('./__fixtures__/calibration-fixture.js');

    const result = await runMission(mission(), seams({ noSeam: true }), { now: () => '2026-07-31T09:00:00.000Z' });

    expect(result.outcome).toBe('delivered');
    expect(result.trail.map((e) => e.type)).not.toContain('reviewer.calibrated');
  });
});
