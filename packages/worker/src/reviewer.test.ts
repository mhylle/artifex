/**
 * P7 — the Reviewer (R7). Gate A before execution, Gate B after.
 *
 * Both gates are semantic, so both take a judge seam; the *arithmetic* around
 * the judgement — which criteria went uncovered, whether every criterion was
 * actually assessed — is deterministic code here, because that is where a
 * plausible-looking gate quietly stops gating.
 */
import { VerdictSchema, validate } from '@artifex/shared-types';
import type { EvidenceBundle, TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { gateA, gateB } from './reviewer.js';
import type { CompletionJudge, CoverageJudge } from './reviewer.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';
const REVIEWER_ID = '7b2d9e10-4c58-4a3f-b6e2-1f8c0d5a9b47';
const CHILD_A = 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39';
const CHILD_B = 'd1b9123f-8a54-4c7e-9f2b-3e8a7c6d5f40';

function contract(over: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: MISSION_ID, missionId: MISSION_ID, parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'Produce a cited report on EV adoption.',
    acceptanceCriteria: [
      { criterionId: 'm-1', statement: 'Market share is reported with a date.' },
      { criterionId: 'm-2', statement: 'Charging infrastructure is covered.' },
    ],
    boundaries: { outOfScope: ['No forecasts past 2030.'], siblingOwners: [] },
    inputs: { entitlements: ['mission-brief'], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['All criteria met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier', 'human_review'], humanAt: 'human_review' },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'medium', autonomyDial: 'checkpointed', createdAt: AT,
    ...over,
  };
}

function child(taskId: string, objective: string): TaskContract {
  return contract({ taskId, parentTaskId: MISSION_ID, depth: 1, objective, category: 'research.sub-question' });
}

const META = { verdictId: 'aaaaaaaa-1111-4222-8333-444444444444', reviewerId: REVIEWER_ID, issuedAt: AT };

function bundle(over: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    bundleId: 'bbbbbbbb-1111-4222-8333-444444444444',
    taskId: CHILD_A, agentId: REVIEWER_ID,
    deliverable: { answer: 'Market share was 22% in 2024.' },
    actions: [], consulted: [], assumptions: [], reflection: null,
    effortSpent: 2, producedAt: AT,
    ...over,
  };
}

describe('R7 AC-1 — Gate A fails an incomplete decomposition and NAMES what is uncovered', () => {
  const children = [child(CHILD_A, 'Report market share.'), child(CHILD_B, 'Cover charging infrastructure.')];

  it('fails and names the uncovered criterion', async () => {
    const judge: CoverageJudge = {
      async assess() {
        // m-2 is covered by nobody.
        return { coverage: [{ criterionId: 'm-1', coveredByTaskIds: [CHILD_A] }, { criterionId: 'm-2', coveredByTaskIds: [] }] };
      },
    };

    const verdict = await gateA(contract(), children, judge, META);

    expect(verdict.gate).toBe('A');
    expect(verdict.outcome).toBe('fail');
    expect(verdict.findings.map((f) => f.criterionId)).toContain('m-2');
    expect(verdict.findings.map((f) => f.criterionId)).not.toContain('m-1');
  });

  it('classes an uncovered criterion as a specification fault, so the ladder re-decomposes', async () => {
    // The error class picks the escalation rung. Retrying a task that was
    // specified wrong just burns budget rehearsing the same mistake.
    const judge: CoverageJudge = {
      async assess() { return { coverage: [{ criterionId: 'm-1', coveredByTaskIds: [CHILD_A] }, { criterionId: 'm-2', coveredByTaskIds: [] }] }; },
    };

    const verdict = await gateA(contract(), children, judge, META);

    expect(verdict.findings[0]?.errorClass).toBe('specification_fault');
  });

  it('DISTRACTOR: a fully-covering decomposition PASSES', async () => {
    // Without this, "always fail" would satisfy every test above.
    const judge: CoverageJudge = {
      async assess() { return { coverage: [{ criterionId: 'm-1', coveredByTaskIds: [CHILD_A] }, { criterionId: 'm-2', coveredByTaskIds: [CHILD_B] }] }; },
    };

    const verdict = await gateA(contract(), children, judge, META);

    expect(verdict.outcome).toBe('pass');
    expect(verdict.findings).toEqual([]);
  });

  it('DISTRACTOR: a criterion the judge never assessed counts as UNCOVERED, not as covered', async () => {
    // A silent omission must never read as coverage — that is how a gate stops
    // gating while still returning "pass".
    const judge: CoverageJudge = {
      async assess() { return { coverage: [{ criterionId: 'm-1', coveredByTaskIds: [CHILD_A] }] }; },
    };

    const verdict = await gateA(contract(), children, judge, META);

    expect(verdict.outcome).toBe('fail');
    expect(verdict.findings.map((f) => f.criterionId)).toContain('m-2');
  });

  it('DISTRACTOR: an empty decomposition cannot pass', async () => {
    const judge: CoverageJudge = { async assess() { return { coverage: [] }; } };

    await expect(gateA(contract(), [], judge, META)).rejects.toThrow(/no children|empty/i);
  });

  it('produces a schema-valid verdict', async () => {
    const judge: CoverageJudge = {
      async assess() { return { coverage: [{ criterionId: 'm-1', coveredByTaskIds: [CHILD_A] }, { criterionId: 'm-2', coveredByTaskIds: [CHILD_B] }] }; },
    };

    const result = validate(VerdictSchema, await gateA(contract(), children, judge, META));
    expect(result.ok, JSON.stringify(result.ok ? {} : result.errors)).toBe(true);
  });
});

describe('R7 AC-2 — Gate B returns a structured verdict against the contract', () => {
  const leaf = contract({
    taskId: CHILD_A, depth: 1,
    acceptanceCriteria: [
      { criterionId: 'ac-1', statement: 'The answer states a rate with a date.' },
      { criterionId: 'ac-2', statement: 'Every claim carries a citation.' },
    ],
  });

  it('passes when every criterion is met', async () => {
    const judge: CompletionJudge = {
      async assess() {
        return { criteria: [{ criterionId: 'ac-1', met: true, detail: 'ok' }, { criterionId: 'ac-2', met: true, detail: 'ok' }], redFlags: [] };
      },
    };

    const verdict = await gateB(leaf, bundle(), judge, META);

    expect(verdict.gate).toBe('B');
    expect(verdict.outcome).toBe('pass');
    expect(verdict.findings).toEqual([]);
  });

  it('fails and names the failing criterion with a reason', async () => {
    const judge: CompletionJudge = {
      async assess() {
        return {
          criteria: [
            { criterionId: 'ac-1', met: true, detail: 'ok' },
            { criterionId: 'ac-2', met: false, detail: 'The 22% claim carries no citation.' },
          ],
          redFlags: [],
        };
      },
    };

    const verdict = await gateB(leaf, bundle(), judge, META);

    expect(verdict.outcome).toBe('fail');
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]?.criterionId).toBe('ac-2');
    expect(verdict.findings[0]?.detail).toMatch(/citation/i);
  });

  it('DISTRACTOR: a criterion the judge did not assess is NOT a pass', async () => {
    // The most dangerous failure mode: the judge quietly skips a criterion and
    // the gate reports success on work nobody checked.
    const judge: CompletionJudge = {
      async assess() { return { criteria: [{ criterionId: 'ac-1', met: true, detail: 'ok' }], redFlags: [] }; },
    };

    const verdict = await gateB(leaf, bundle(), judge, META);

    expect(verdict.outcome).toBe('fail');
    expect(verdict.findings.map((f) => f.criterionId)).toContain('ac-2');
  });

  it('DISTRACTOR: a verdict about criteria the contract never had is refused', async () => {
    // A judge inventing its own criteria is grading a different task.
    const judge: CompletionJudge = {
      async assess() {
        return {
          criteria: [
            { criterionId: 'ac-1', met: true, detail: 'ok' },
            { criterionId: 'ac-2', met: true, detail: 'ok' },
            { criterionId: 'invented', met: true, detail: 'ok' },
          ],
          redFlags: [],
        };
      },
    };

    await expect(gateB(leaf, bundle(), judge, META)).rejects.toThrow(/invented|not in the contract/i);
  });

  it('carries red flags through to the verdict', async () => {
    const judge: CompletionJudge = {
      async assess() {
        return {
          criteria: [{ criterionId: 'ac-1', met: true, detail: 'ok' }, { criterionId: 'ac-2', met: true, detail: 'ok' }],
          redFlags: ['The deliverable cites a source that was never consulted.'],
        };
      },
    };

    const verdict = await gateB(leaf, bundle(), judge, META);

    expect(verdict.redFlags).toHaveLength(1);
  });

  it('records the verification depth the contract demanded, not one of its own', async () => {
    const judge: CompletionJudge = {
      async assess() { return { criteria: [{ criterionId: 'ac-1', met: true, detail: 'ok' }, { criterionId: 'ac-2', met: true, detail: 'ok' }], redFlags: [] }; },
    };

    const deep = { ...leaf, verificationPlan: { depth: 'redundant' as const, requiredAgreement: 2 } };
    const verdict = await gateB(deep, bundle(), judge, META);

    expect(verdict.verificationDepth).toBe('redundant');
  });

  it('produces a schema-valid verdict', async () => {
    const judge: CompletionJudge = {
      async assess() { return { criteria: [{ criterionId: 'ac-1', met: true, detail: 'ok' }, { criterionId: 'ac-2', met: true, detail: 'ok' }], redFlags: [] }; },
    };

    const result = validate(VerdictSchema, await gateB(leaf, bundle(), judge, META));
    expect(result.ok, JSON.stringify(result.ok ? {} : result.errors)).toBe(true);
  });
});
