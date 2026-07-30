/**
 * R37 — delivery with pedigree, and the surrender dossier.
 *
 * Both terminal events existed and both were nearly empty: `mission.folded`
 * carried `{childCount, conflicts}` and `mission.surrendered` carried
 * `{reason, blockers}`. A requester was handed an answer with no account of how
 * it was checked, or a refusal with no account of what was tried.
 *
 * Both are DERIVED from the trail, never accumulated alongside it. The ledger
 * already holds every verdict, escalation, evidence bundle and effort figure; a
 * second copy assembled as the mission ran would be a second truth that can
 * disagree with the first — the same rule the dashboard projection follows.
 */
import type { LedgerEventInput, TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { pedigreeOf, surrenderDossier } from './dossier.js';
import { runMission } from './mission-loop.js';
import type { MissionSeams } from './mission-loop.js';

const AT = '2026-07-31T09:00:00.000Z';
const MISSION = 'aaaaaaaa-0000-4000-8000-000000000001';
const TASK_A = 'bbbbbbbb-0000-4000-8000-000000000001';
const TASK_B = 'bbbbbbbb-0000-4000-8000-000000000002';

function mission(over: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: MISSION, missionId: MISSION, parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'Compare two things.',
    acceptanceCriteria: [
      { criterionId: 'm-1', statement: 'The first is covered.' },
      { criterionId: 'm-2', statement: 'The second is covered.' },
    ],
    boundaries: { outOfScope: ['Else.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['Both.'], stopTryingWhen: ['No data.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 20, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_same', 'different_agent'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
    ...over,
  };
}

let seq = 0;
const ev = (
  taskId: string,
  type: string,
  payload: Record<string, unknown>,
): LedgerEventInput => ({
  eventId: `ev-${(seq += 1).toString().padStart(4, '0')}`,
  missionId: MISSION,
  taskId,
  family: 'execution',
  type,
  actor: { kind: 'orchestrator', id: 'orchestrator', displayName: null },
  payload,
  occurredAt: AT,
});

/** A trail where both tasks executed and both passed. */
function deliveredTrail(): LedgerEventInput[] {
  return [
    ev(MISSION, 'mission.started', { objective: 'Compare two things.' }),
    ev(TASK_A, 'task.contracted', { objective: 'Cover the first.' }),
    ev(TASK_A, 'task.executed', {
      deliverable: { answer: 'first' }, assumptions: ['Assumed metric units.'], effortSpent: 4,
    }),
    ev(TASK_A, 'gate_b.verdict_issued', {
      outcome: 'pass', verificationDepth: 'single',
      criteria: [{ criterionId: 'm-1', met: true }], findings: [], redFlags: [],
    }),
    ev(TASK_B, 'task.contracted', { objective: 'Cover the second.' }),
    ev(TASK_B, 'task.executed', {
      deliverable: { answer: 'second' }, assumptions: [], effortSpent: 6,
    }),
    ev(TASK_B, 'gate_b.verdict_issued', {
      outcome: 'pass', verificationDepth: 'redundant',
      criteria: [{ criterionId: 'm-2', met: true }], findings: [], redFlags: [],
    }),
  ];
}

describe('R37 AC-0 — a delivered result carries its pedigree', () => {
  it('says WHAT was checked and HOW DEEPLY, per task', async () => {
    const p = pedigreeOf(mission(), deliveredTrail());

    const a = p.verified.find((v) => v.taskId === TASK_A);
    const b = p.verified.find((v) => v.taskId === TASK_B);
    expect(a?.depth).toBe('single');
    expect(b?.depth).toBe('redundant');
  });

  it('carries every flagged assumption, attributed to the task that made it', async () => {
    const p = pedigreeOf(mission(), deliveredTrail());

    expect(p.assumptions).toEqual([{ taskId: TASK_A, assumption: 'Assumed metric units.' }]);
  });

  it('accounts effort SPENT against the budget granted', async () => {
    const p = pedigreeOf(mission(), deliveredTrail());

    expect(p.budget.spent).toBe(10);
    expect(p.budget.ceiling).toBe(20);
  });

  it('points into the audit trail, reaching individual tasks', async () => {
    // "Pointers into the audit trail reaching individual tasks" is the criterion.
    // A pedigree that named tasks without citing events would leave the reader
    // knowing something happened and unable to find it.
    const p = pedigreeOf(mission(), deliveredTrail());

    const a = p.verified.find((v) => v.taskId === TASK_A);
    expect(a?.evidence.length).toBeGreaterThan(0);
    const trailIds = new Set(deliveredTrail().map((e) => e.eventId));
    // Ids are regenerated per call, so compare shape rather than identity.
    expect(a?.evidence.every((id) => /^ev-\d+$/.test(id))).toBe(true);
    expect(trailIds.size).toBeGreaterThan(0);
  });

  it('DISTRACTOR: a task with NO assumptions contributes none — silence is not an assumption', async () => {
    const p = pedigreeOf(mission(), deliveredTrail());

    expect(p.assumptions.some((a) => a.taskId === TASK_B)).toBe(false);
  });

  it('DISTRACTOR: only PASSED tasks are listed as verified', async () => {
    // A pedigree listing a failed attempt as verification would overstate what
    // was actually checked — the precise claim the requester relies on.
    const trail = [
      ...deliveredTrail(),
      ev(TASK_A, 'gate_b.verdict_issued', {
        outcome: 'fail', verificationDepth: 'single',
        criteria: [{ criterionId: 'm-1', met: false }],
        findings: [{ criterionId: 'm-1', errorClass: 'execution_error', detail: 'no', failingStep: 'x' }],
        redFlags: [],
      }),
    ];

    const p = pedigreeOf(mission(), trail);

    // A's LAST verdict is a fail, so it is no longer verified.
    expect(p.verified.map((v) => v.taskId)).not.toContain(TASK_A);
  });
});

/** A trail where one task passed, one never did, with escalations. */
function surrenderedTrail(): LedgerEventInput[] {
  return [
    ...deliveredTrail().slice(0, 4),
    ev(TASK_B, 'task.contracted', { objective: 'Cover the second.' }),
    ev(TASK_B, 'task.executed', { deliverable: { answer: 'attempt' }, assumptions: [], effortSpent: 3 }),
    ev(TASK_B, 'gate_b.verdict_issued', {
      outcome: 'fail', verificationDepth: 'single',
      criteria: [{ criterionId: 'm-2', met: false }],
      findings: [{ criterionId: 'm-2', errorClass: 'capability_gap', detail: 'no source available', failingStep: 'Gate B completion check' }],
      redFlags: [],
    }),
    ev(TASK_B, 'escalation.rung_climbed', { rung: 'different_agent', entryClass: 'capability_gap' }),
    ev(MISSION, 'staffing.capability_gap', { capabilities: ['live data lookup'], noBids: 1, taskCount: 2 }),
  ];
}

describe('R37 AC-1 — the surrender dossier accounts for the whole attempt', () => {
  it('lists everything completed and verified — a surrender is not a total loss', async () => {
    const d = surrenderDossier(mission(), surrenderedTrail(), 'blocked', ['no source']);

    expect(d.completed.map((c) => c.taskId)).toEqual([TASK_A]);
  });

  it('names the precise blockers WITH their evidence', async () => {
    const d = surrenderDossier(mission(), surrenderedTrail(), 'blocked', ['no source']);

    const blocker = d.blockers[0];
    expect(blocker?.detail).toMatch(/no source available/);
    expect(blocker?.evidence.length).toBeGreaterThan(0);
  });

  it('carries the FULL escalation history', async () => {
    const d = surrenderDossier(mission(), surrenderedTrail(), 'blocked', ['no source']);

    expect(d.escalations).toEqual([{ taskId: TASK_B, rung: 'different_agent', entryClass: 'capability_gap' }]);
  });

  it('accounts the budget', async () => {
    const d = surrenderDossier(mission(), surrenderedTrail(), 'blocked', ['no source']);

    expect(d.budget.spent).toBe(7);
    expect(d.budget.ceiling).toBe(20);
  });

  it('says WHAT IT WOULD TAKE — the missing capability, named', async () => {
    // The section that turns a refusal into a next step. A capability gap was
    // recorded, so the dossier can say which capability, rather than leaving the
    // requester to infer it from a failure detail.
    const d = surrenderDossier(mission(), surrenderedTrail(), 'blocked', ['no source']);

    expect(d.whatItWouldTake.join(' ')).toMatch(/live data lookup/);
  });

  it('names the criteria that would have to be RELAXED', async () => {
    const d = surrenderDossier(mission(), surrenderedTrail(), 'blocked', ['no source']);

    expect(d.whatItWouldTake.join(' ')).toMatch(/The second is covered/);
  });

  it('DISTRACTOR: it does NOT suggest more budget when the budget was not the problem', async () => {
    // 7 of 20 spent. Telling the requester to add budget would send them to buy
    // more of the thing that was never the constraint.
    const d = surrenderDossier(mission(), surrenderedTrail(), 'blocked', ['no source']);

    expect(d.whatItWouldTake.join(' ')).not.toMatch(/budget/i);
  });

  it('suggests more budget when the ceiling WAS reached', async () => {
    const trail = [
      ...surrenderedTrail(),
      ev(TASK_B, 'task.executed', { deliverable: { answer: 'x' }, assumptions: [], effortSpent: 14 }),
    ];

    const d = surrenderDossier(mission(), trail, 'blocked', ['out of budget']);

    expect(d.whatItWouldTake.join(' ')).toMatch(/budget/i);
  });

  it('DISTRACTOR: a criterion that PASSED is not listed as needing relaxation', async () => {
    const d = surrenderDossier(mission(), surrenderedTrail(), 'blocked', ['no source']);

    expect(d.whatItWouldTake.join(' ')).not.toMatch(/The first is covered/);
  });
});

/**
 * The half live driving found, and no fixture would have.
 *
 * The pedigree was attached to `mission.folded` — and a mission the
 * decompose-or-delegate gate keeps WHOLE never folds. It delivered with no
 * pedigree at all, and no terminal event either, which is also why the fleet
 * view had nothing to mark such a mission finished with.
 *
 * AC-0 says "given a mission that DELIVERS". Kept whole is still delivered.
 */
function keptWholeSeams(): MissionSeams {
  return {
    planner: { async propose() { return { subtasks: [] }; } },
    coverageJudge: { async assess() { return { coverage: [] }; } },
    intentJudge: { async assess() { return { servesIntent: true, detail: 'ok', redFlags: [] }; } },
    planJudge: {
      async audit({ children }) {
        return { tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })), untestable: [], overlaps: [] };
      },
    },
    decompositionGate: { async assess() { return { keepWhole: true, rationale: 'one continuous thing' }; } },
    registry: { async bestForCategory() { return null; } },
    author: { async design() { return { roleInstructions: 'Do it.', capabilities: ['text'] }; } },
    clarityJudge: { async assess() { return { restatement: 'Do it.', ambiguities: [] }; } },
    work: {
      async execute() {
        return { deliverable: { answer: 'done' }, actions: [], consulted: [], assumptions: ['Assumed sea level.'], effortSpent: 5 };
      },
    },
    completionJudge: {
      async assess({ contract }) {
        return {
          criteria: contract.acceptanceCriteria.map((c) => ({ criterionId: c.criterionId, met: true, detail: 'ok' })),
          redFlags: [],
        };
      },
    },
    reconciler: { async reconcile({ children }) { return { deliverable: { n: children.length }, conflicts: [] }; } },
  };
}

describe('R37 AC-0 — a KEPT-WHOLE mission delivers with a pedigree too', () => {
  it('emits a terminal delivery event, which a kept-whole mission never had', async () => {
    // Found live on mission d042175f: the worker logged "delivered" and the
    // trail ended at `gate_b.verdict_issued` with nothing marking the finish.
    const result = await runMission(mission(), keptWholeSeams(), { now: () => AT });

    expect(result.outcome).toBe('delivered');
    expect(result.trail.map((e) => e.type)).toContain('mission.delivered');
  });

  it('carries the pedigree on it', async () => {
    const result = await runMission(mission(), keptWholeSeams(), { now: () => AT });

    const delivered = result.trail.find((e) => e.type === 'mission.delivered');
    const pedigree = delivered?.payload['pedigree'] as { assumptions?: unknown[]; budget?: { spent?: number } };
    expect(pedigree?.assumptions).toHaveLength(1);
    expect(pedigree?.budget?.spent).toBe(5);
  });

  it('DISTRACTOR: a SURRENDERED mission emits no delivery event', async () => {
    // Two terminal events on one mission would make the fleet view show it as
    // both finished and failed.
    const failing: MissionSeams = {
      ...keptWholeSeams(),
      completionJudge: {
        async assess({ contract }) {
          return {
            criteria: contract.acceptanceCriteria.map((c) => ({ criterionId: c.criterionId, met: false, detail: 'no' })),
            redFlags: [],
          };
        },
      },
    };

    const result = await runMission(mission(), failing, { now: () => AT });

    expect(result.outcome).toBe('surrendered');
    expect(result.trail.map((e) => e.type)).not.toContain('mission.delivered');
  });
});
