/**
 * P8.6 — the worker self-critique pass (R12 runtime), per ADR-0007.
 *
 * Reflection improves a deliverable; it never rules on one. The tests that
 * matter most are the ones proving it cannot become a second, non-independent
 * Reviewer — that is the failure ADR-0006 explicitly warned this feature would
 * drift into.
 */
import { EvidenceBundleSchema, validate } from '@artifex/shared-types';
import type { EvidenceBundle, TaskContract, WorkerContractView } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { selfCritique } from './self-critique.js';
import type { CritiqueJudge } from './self-critique.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';
const TASK_ID = 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39';
const AGENT_ID = '7b2d9e10-4c58-4a3f-b6e2-1f8c0d5a9b47';
const DRAFT_EVENT_ID = 'f0e1d2c3-b4a5-4968-8776-5a4b3c2d1e0f';

function view(): WorkerContractView {
  const full: TaskContract = {
    taskId: TASK_ID, missionId: MISSION_ID, parentTaskId: MISSION_ID,
    category: 'research.sub-question', depth: 1,
    objective: 'Answer the sub-question with cited sources.',
    acceptanceCriteria: [
      { criterionId: 'ac-1', statement: 'States a rate with a unit and a date.' },
      { criterionId: 'ac-2', statement: 'Every claim carries a citation.' },
    ],
    boundaries: { outOfScope: ['Do not draft the report.'], siblingOwners: [] },
    inputs: { entitlements: ['mission-brief'], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['ac-1 met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier', 'human_review'], humanAt: 'human_review' },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'checkpointed', createdAt: AT,
  };
  const { verificationPlan: _withheld, ...rest } = full;
  return rest;
}

function draft(): EvidenceBundle {
  return {
    bundleId: 'bbbbbbbb-1111-4222-8333-444444444444',
    taskId: TASK_ID, agentId: AGENT_ID,
    deliverable: { answer: 'Adoption reached 34%.' },
    actions: [], consulted: [], assumptions: [], reflection: null,
    effortSpent: 3, producedAt: AT,
  };
}

const META = { reflectionId: '2c1b0a9f-8e7d-4c6b-9a58-4736251409e8', priorDraftEventId: DRAFT_EVENT_ID, performedAt: AT };

/** Finds a real gap and repairs it. */
const critical: CritiqueJudge = {
  async assess() {
    return {
      critiques: [
        { criterionId: 'ac-1', assessment: 'met', note: 'A rate is stated.' },
        { criterionId: 'ac-2', assessment: 'unmet', note: 'The 34% claim carries no citation.' },
      ],
      revisedDeliverable: { answer: 'Adoption reached 34% in Q1 2026 (EEA, 2026).' },
      effortSpent: 1,
    };
  },
};

/** Finds nothing to fix. */
const clean: CritiqueJudge = {
  async assess() {
    return {
      critiques: [
        { criterionId: 'ac-1', assessment: 'met', note: 'ok' },
        { criterionId: 'ac-2', assessment: 'met', note: 'ok' },
      ],
      revisedDeliverable: null,
      effortSpent: 1,
    };
  },
};

describe('R12 AC-0 — both versions are recoverable', () => {
  it('revises the deliverable and points at the pre-reflection draft', async () => {
    const result = await selfCritique({ contract: view(), draft: draft(), judge: critical, ...META });

    expect(result.bundle.reflection).not.toBeNull();
    expect(result.bundle.reflection?.priorDraftEventId).toBe(DRAFT_EVENT_ID);
    expect(result.bundle.reflection?.revised).toBe(true);
    expect((result.bundle.deliverable as { answer: string }).answer).toMatch(/EEA/);
  });

  it('DISTRACTOR: a clean critique leaves the deliverable untouched and says so', async () => {
    const original = draft();
    const result = await selfCritique({ contract: view(), draft: original, judge: clean, ...META });

    expect(result.bundle.reflection?.revised).toBe(false);
    expect(result.bundle.deliverable).toEqual(original.deliverable);
  });

  it('produces a schema-valid evidence bundle', async () => {
    const result = await selfCritique({ contract: view(), draft: draft(), judge: critical, ...META });
    const check = validate(EvidenceBundleSchema, result.bundle);

    expect(check.ok, JSON.stringify(check.ok ? {} : check.errors)).toBe(true);
  });
});

describe('R12 AC-1 — reflection is structurally incapable of being a verdict', () => {
  it('emits no verdict fields', async () => {
    const result = await selfCritique({ contract: view(), draft: draft(), judge: critical, ...META });
    const record = result.bundle.reflection as unknown as Record<string, unknown>;

    for (const forbidden of ['gate', 'outcome', 'verdictId']) {
      expect(record, `reflection must not carry "${forbidden}"`).not.toHaveProperty(forbidden);
    }
  });

  it('DISTRACTOR: a "clean" critique does NOT mark the work verified — Gate B still owes a verdict', async () => {
    // The exact drift ADR-0006 warned about: reflection quietly becoming a
    // second, non-independent Reviewer.
    const result = await selfCritique({ contract: view(), draft: draft(), judge: clean, ...META });

    expect(result).not.toHaveProperty('verdict');
    expect(result.gateBRequired).toBe(true);
  });

  it('DISTRACTOR: even an all-unmet critique still requires Gate B — it cannot fail the task either', async () => {
    const damning: CritiqueJudge = {
      async assess() {
        return {
          critiques: [
            { criterionId: 'ac-1', assessment: 'unmet', note: 'no' },
            { criterionId: 'ac-2', assessment: 'unmet', note: 'no' },
          ],
          revisedDeliverable: null,
          effortSpent: 1,
        };
      },
    };

    const result = await selfCritique({ contract: view(), draft: draft(), judge: damning, ...META });

    expect(result.gateBRequired).toBe(true);
  });
});

describe('R12 AC-2 — critique is against the criteria, never the verification plan', () => {
  it('refuses a contract that still carries a verification plan', async () => {
    const full = { ...view(), verificationPlan: { depth: 'single', requiredAgreement: null } };

    await expect(
      selfCritique({ contract: full as WorkerContractView, draft: draft(), judge: critical, ...META }),
    ).rejects.toThrow(/verification plan|worker view/i);
  });

  it('hands the judge the acceptance criteria', async () => {
    let seen: unknown;
    const spy: CritiqueJudge = {
      async assess(input) { seen = input.contract.acceptanceCriteria; return clean.assess(input); },
    };

    await selfCritique({ contract: view(), draft: draft(), judge: spy, ...META });

    expect(Array.isArray(seen)).toBe(true);
    expect((seen as unknown[]).length).toBe(2);
  });

  it('DISTRACTOR: a critique naming a criterion the contract never had is refused', async () => {
    const inventive: CritiqueJudge = {
      async assess() {
        return {
          critiques: [{ criterionId: 'invented', assessment: 'unmet', note: 'x' }],
          revisedDeliverable: null,
          effortSpent: 1,
        };
      },
    };

    await expect(
      selfCritique({ contract: view(), draft: draft(), judge: inventive, ...META }),
    ).rejects.toThrow(/invented|not in the contract/i);
  });
});

describe('R12 AC-3 — reflection effort is charged against the contract budget', () => {
  it('adds the reflection cost to the bundle total and records it separately', async () => {
    const original = draft();
    const result = await selfCritique({ contract: view(), draft: original, judge: critical, ...META });

    expect(result.bundle.effortSpent).toBe(original.effortSpent + 1);
    expect(result.bundle.reflection?.effortSpent).toBe(1);
  });

  it('DISTRACTOR: reflection is not free — the cost is attributed, never hidden', async () => {
    // Attribution is what makes "does reflection pay for itself?" answerable.
    const result = await selfCritique({ contract: view(), draft: draft(), judge: critical, ...META });

    expect(result.bundle.reflection?.effortSpent).toBeGreaterThan(0);
    expect(result.bundle.effortSpent).toBeGreaterThan(draft().effortSpent);
  });

  it('emits a ledger event for the pass, carrying the critique', async () => {
    const result = await selfCritique({ contract: view(), draft: draft(), judge: critical, ...META });

    expect(result.event.family).toBe('execution');
    expect(result.event.type).toMatch(/reflection/i);
    expect(result.event.payload).toHaveProperty('critiques');
  });
});

describe('defect cd677737 — a revision that regresses is rejected', () => {
  /**
   * Observed live: the critique was CORRECT (ac-2 unmet, no citation) but the
   * repair was destructive — "22% in 2024" became "5% in [Source Name]",
   * corrupting a correct figure and breaking ac-1, which the critique had just
   * marked met. Reflection that regresses inverts R12's whole economic
   * argument: it spends budget to make the work worse and still pays for the
   * Gate B rejection.
   */
  const regressive: CritiqueJudge = {
    async assess() {
      return {
        critiques: [
          { criterionId: 'ac-1', assessment: 'met', note: 'A rate and date are stated.' },
          { criterionId: 'ac-2', assessment: 'unmet', note: 'No citation.' },
        ],
        revisedDeliverable: { answer: 'Adoption reached 5% in [Source Name].' },
        effortSpent: 1,
      };
    },
  };

  /** Re-checks the revision; reports that the previously-met criterion broke. */
  const recheckFinds = (met: boolean) => async () => ({
    critiques: [{ criterionId: 'ac-1', assessment: met ? ('met' as const) : ('unmet' as const), note: 'recheck' }],
    revisedDeliverable: null,
    effortSpent: 0,
  });

  it('keeps the DRAFT when the revision breaks a criterion the critique marked met', async () => {
    const original = draft();
    const result = await selfCritique({
      contract: view(), draft: original, judge: regressive, ...META,
      recheck: { assess: recheckFinds(false) },
    });

    expect(result.bundle.deliverable).toEqual(original.deliverable);
    expect(result.bundle.reflection?.revised).toBe(false);
    expect(result.regressionRejected).toBe(true);
  });

  it('DISTRACTOR: a revision that holds the met criteria IS accepted', async () => {
    // Without this, "always discard the revision" would satisfy the test above
    // — and reflection would become a very expensive no-op.
    const result = await selfCritique({
      contract: view(), draft: draft(), judge: regressive, ...META,
      recheck: { assess: recheckFinds(true) },
    });

    expect((result.bundle.deliverable as { answer: string }).answer).toMatch(/5%/);
    expect(result.bundle.reflection?.revised).toBe(true);
    expect(result.regressionRejected).toBe(false);
  });

  it('DISTRACTOR: with no recheck available the revision is still applied — the guard is opt-in, not a silent block', async () => {
    const result = await selfCritique({ contract: view(), draft: draft(), judge: regressive, ...META });

    expect(result.bundle.reflection?.revised).toBe(true);
  });

  it('records the rejection so the Learning Agent can see reflection failing', async () => {
    const result = await selfCritique({
      contract: view(), draft: draft(), judge: regressive, ...META,
      recheck: { assess: recheckFinds(false) },
    });

    expect(result.event.payload['regressionRejected']).toBe(true);
  });
});
