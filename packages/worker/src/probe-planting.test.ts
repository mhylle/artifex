/**
 * R35 AC-1 — planting the known-bad output that measures rubber-stamping.
 *
 * `probeMisses` has scored probes in both directions since P35's first pass, and
 * `seams.calibration.probes?.()` has been read by the mission loop the whole
 * time. Nothing implemented `probes`, so the reviewer's leniency was never
 * measured — the twelfth mechanism found with no producer.
 *
 * This matters more than most of them. ADR-0010's unanimity sampling has a
 * stated limit (`627cd71c`): it cannot catch a judge that contradicts itself the
 * same way every time, because every sample agrees. Only a KNOWN ANSWER can, and
 * a probe is exactly that — which makes this the one measurement that closes
 * that hole rather than widening it.
 *
 * TWO CONSTRUCTION CHOICES, both deliberate:
 *
 *   An EMPTY deliverable is a WEAK probe. Gate B's mechanical tier refuses an
 *   empty deliverable without asking a model at all, so such a probe would
 *   measure the mechanical tier and report a healthy catch rate while the
 *   semantic tier — where rubber-stamping actually happens — went untested.
 *
 *   A deliverable BORROWED FROM ANOTHER CASE is a genuinely wrong answer to this
 *   contract, fabricates nothing, and can only be caught by reading it against
 *   the criteria. That is the semantic tier, and it is the tier the criterion
 *   cares about.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { plantProbes } from './calibration.js';
import type { KnownCase } from './calibration.js';

const AT = '2026-07-31T09:00:00.000Z';

function contract(id: string, objective: string): TaskContract {
  return {
    taskId: id, missionId: 'aaaaaaaa-0000-4000-8000-000000000000', parentTaskId: null,
    category: 'answering', depth: 1,
    objective,
    acceptanceCriteria: [{ criterionId: 'c-1', statement: `It answers: ${objective}` }],
    boundaries: { outOfScope: [], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['Answered.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

const boiling: KnownCase = {
  caseId: 'case-boiling',
  contract: contract('t-boiling', 'the boiling point of water in Celsius'),
  verifiedOutcome: { answer: '100' },
};
const capital: KnownCase = {
  caseId: 'case-capital',
  contract: contract('t-capital', 'the capital of France'),
  verifiedOutcome: { answer: 'Paris' },
};

describe('R35 AC-1 — a known-BAD probe is built by borrowing another case answer', () => {
  it('plants a probe expected to FAIL, carrying the borrowed deliverable', async () => {
    const probes = plantProbes([boiling, capital]);

    const bad = probes.find((p) => p.expected === 'fail');
    expect(bad, 'no known-bad probe was planted — leniency stays unmeasured').toBeDefined();
    expect(bad?.borrowedFrom).not.toBeNull();
  });

  it('the borrowed deliverable really is ANOTHER case answer, not this one', async () => {
    // The whole construction. A "wrong" answer that happens to be the right one
    // would score the reviewer a miss for being correct.
    const probes = plantProbes([boiling, capital]);

    for (const bad of probes.filter((p) => p.expected === 'fail')) {
      const own = [boiling, capital].find((c) => c.caseId === bad.sourceCaseId)!;
      expect(bad.deliverable).not.toEqual(own.verifiedOutcome);
      const lender = [boiling, capital].find((c) => c.caseId === bad.borrowedFrom)!;
      expect(bad.deliverable).toEqual(lender.verifiedOutcome);
    }
  });

  it('DISTRACTOR: the deliverable is NOT empty — an empty one tests the wrong tier', async () => {
    // Gate B's mechanical tier refuses an empty deliverable with no model
    // involved. A probe built that way would report a healthy catch rate while
    // the semantic tier, where rubber-stamping lives, went entirely untested.
    const probes = plantProbes([boiling, capital]);

    for (const bad of probes.filter((p) => p.expected === 'fail')) {
      expect(bad.deliverable, 'an empty probe measures the mechanical tier').not.toBeNull();
      expect(JSON.stringify(bad.deliverable ?? '')).not.toBe('""');
    }
  });
});

describe('R35 AC-1 — known-GOOD probes too, because leniency is not the only failure', () => {
  it('plants a probe expected to PASS from each case own verified outcome', async () => {
    // `probeMisses` scores both directions, and the tier-2 judges have actually
    // shown reflexive rejection (ADR-0010: a 58% false-bounce rate). A
    // calibration measuring only leniency would have missed all of it.
    const probes = plantProbes([boiling, capital]);

    const good = probes.filter((p) => p.expected === 'pass');
    expect(good).toHaveLength(2);
    expect(good.map((p) => p.deliverable)).toEqual([boiling.verifiedOutcome, capital.verifiedOutcome]);
  });

  it('a good probe carries the case OWN contract, so the pairing is truthful', async () => {
    const probes = plantProbes([boiling, capital]);

    const good = probes.find((p) => p.expected === 'pass' && p.sourceCaseId === 'case-boiling')!;
    expect(good.contract.objective).toBe(boiling.contract.objective);
  });
});

describe('R35 AC-1 — the planter refuses to invent a probe it cannot justify', () => {
  it('DISTRACTOR: ONE case yields no known-bad probe — there is nothing to borrow', async () => {
    // With a single case the only "wrong" answer available would have to be
    // fabricated, and a fabricated wrong answer is a judgement about what wrong
    // looks like — exactly the thing a probe exists to avoid making.
    const probes = plantProbes([boiling]);

    expect(probes.filter((p) => p.expected === 'fail')).toHaveLength(0);
    expect(probes.filter((p) => p.expected === 'pass'), 'the good probe is still plantable').toHaveLength(1);
  });

  it('DISTRACTOR: two cases with the SAME answer yield no known-bad probe', async () => {
    // Borrowing an identical deliverable produces a probe labelled "fail" whose
    // deliverable is actually correct. The reviewer would be scored a miss for
    // being right, and the calibration would report leniency that is not there.
    const twin: KnownCase = { ...capital, caseId: 'case-twin', verifiedOutcome: { answer: '100' } };

    const probes = plantProbes([boiling, twin]);

    expect(
      probes.filter((p) => p.expected === 'fail'),
      'a correct answer was planted as a known-bad one',
    ).toHaveLength(0);
  });

  it('DISTRACTOR: no cases at all yields no probes, not an error', async () => {
    // An empty bench is the ordinary state of a young system, not a fault. The
    // calibration simply reports nothing planted.
    expect(plantProbes([])).toEqual([]);
  });

  it('probe ids are deterministic and distinct per case and direction', async () => {
    // Deterministic so a replay lands on the same probes; distinct so the two
    // directions cannot collide and silently overwrite one another in the
    // taskId-keyed map `probeMisses` builds.
    const a = plantProbes([boiling, capital]);
    const b = plantProbes([boiling, capital]);

    expect(a.map((p) => p.taskId)).toEqual(b.map((p) => p.taskId));
    expect(new Set(a.map((p) => p.taskId)).size).toBe(a.length);
  });
});
