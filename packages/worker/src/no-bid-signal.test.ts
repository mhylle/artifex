/**
 * R38 AC-3 — a systematic pattern of no-bids is an early surrender signal.
 *
 * "The swarm can tell it lacks the capability *before* burning the budget
 * discovering it the hard way."
 *
 * The point is the word *early*. A mission that no-bids across its whole task
 * graph is telling the operator something the ledger will otherwise only reveal
 * after every task has been staffed, executed, bounced and escalated — by which
 * time the budget is gone and the surrender dossier says nothing that was not
 * knowable at staffing time.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { runMission } from './mission-loop.js';
import type { MissionSeams } from './mission-loop.js';
import type { RegisteredDesign } from './agent-creator.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';

function mission(): TaskContract {
  return {
    taskId: MISSION_ID, missionId: MISSION_ID, parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'Cover three separate things.',
    acceptanceCriteria: [
      { criterionId: 'm-1', statement: 'First is covered.' },
      { criterionId: 'm-2', statement: 'Second is covered.' },
      { criterionId: 'm-3', statement: 'Third is covered.' },
    ],
    boundaries: { outOfScope: ['Nothing else.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['all met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 30, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

const bid = (category: string): RegisteredDesign => ({
  designId: 'dddddddd-eeee-4fff-8aaa-000000000001',
  category, version: 4, roleInstructions: 'Proven.', capabilities: ['text'],
  cladeScore: 0.9, observations: 5, active: true,
});

/** `bidsFor` decides which categories the registry can serve. */
function seams(bidsFor: (category: string) => RegisteredDesign | null): MissionSeams {
  return {
    planner: {
      async propose({ contract }) {
        return {
          subtasks: contract.acceptanceCriteria.map((criterion, i) => ({
            objective: `Handle ${criterion.criterionId}.`,
            category: `Capability ${i + 1} / Sub`,
            acceptanceCriteria: [criterion],
            outOfScope: ['Not the siblings.'],
            blastRadius: 'low' as const,
            effortShare: 0.3,
          })),
        };
      },
    },
    coverageJudge: {
      async assess({ parent, children }) {
        return {
          coverage: parent.acceptanceCriteria.map((c) => ({
            criterionId: c.criterionId, coveredByTaskIds: children.map((k) => k.taskId),
          })),
        };
      },
    },
    // R33's plan audit. Permissive here on purpose: these tests are about other
    // properties, and an explicit permissive judge in a fixture is honest in a
    // way a silently-skipped clause in production never is. The clause itself is
    // exercised in `gate-a-full.test.ts`.
    // R34's intent tier. Permissive here on purpose: these tests are about other
    // properties, and an explicit permissive judge in a fixture is honest in a
    // way a silently-absent tier in production never is. The tier itself is
    // exercised in `gate-b-full.test.ts`.
    intentJudge: {
      async assess() { return { servesIntent: true, detail: 'ok', redFlags: [] }; },
    },
    planJudge: {
      async audit({ children }: { children: readonly { taskId: string }[] }) {
        return { tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })), untestable: [], overlaps: [] };
      },
    },
    registry: { async bestForCategory(category) { return bidsFor(category); } },
    author: { async design() { return { roleInstructions: 'Improvise.', capabilities: ['text'] }; } },
    clarityJudge: { async assess() { return { restatement: 'Do it.', ambiguities: [] }; } },
    work: {
      async execute() {
        return { deliverable: { answer: 'ok' }, actions: [], consulted: [], assumptions: [], effortSpent: 1 };
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
    reconciler: {
      async reconcile({ children }) { return { deliverable: { n: children.length }, conflicts: [] }; },
    },
  };
}

const signals = (trail: readonly { type: string; payload: Record<string, unknown> }[]) =>
  trail.filter((e) => e.type === 'staffing.capability_gap');

describe('R38 AC-3 — systematic no-bids raise an early surrender signal', () => {
  it('raises the signal when NOTHING in the registry can serve the task graph', async () => {
    const result = await runMission(mission(), seams(() => null), { now: () => AT });

    const raised = signals(result.trail);
    expect(raised).toHaveLength(1);
    expect(raised[0]?.payload['noBids']).toBe(3);
    expect(raised[0]?.payload['taskCount']).toBe(3);
  });

  it('the signal is raised BEFORE any task executes — that is what makes it early', async () => {
    // The whole value is warning ahead of the spend. A signal appended after the
    // work would tell the operator something the trail already showed.
    const result = await runMission(mission(), seams(() => null), { now: () => AT });
    const types = result.trail.map((e) => e.type);

    expect(types.indexOf('staffing.capability_gap')).toBeGreaterThan(-1);
    expect(types.indexOf('staffing.capability_gap')).toBeLessThan(types.indexOf('task.executed'));
  });

  it('names the capabilities nobody could serve, so the gap is actionable', async () => {
    const result = await runMission(mission(), seams(() => null), { now: () => AT });

    const gaps = signals(result.trail)[0]?.payload['capabilities'];
    expect(Array.isArray(gaps)).toBe(true);
    expect(gaps).toEqual(['capability 1', 'capability 2', 'capability 3']);
  });

  it('DISTRACTOR: a signal is a WARNING, not a surrender — the mission still runs', async () => {
    // "Before burning the budget" means informed, not aborted. A first mission
    // in a new domain no-bids on everything by definition; refusing to run would
    // make the swarm unable to ever learn a new capability.
    const result = await runMission(mission(), seams(() => null), { now: () => AT });

    expect(result.outcome).toBe('delivered');
    expect(result.trail.filter((e) => e.type === 'task.executed')).toHaveLength(3);
  });

  it('DISTRACTOR: no signal when the registry serves the graph', async () => {
    const result = await runMission(mission(), seams((category) => bid(category)), { now: () => AT });

    expect(signals(result.trail)).toHaveLength(0);
  });

  it('DISTRACTOR: no signal on an ISOLATED no-bid — the criterion says SYSTEMATIC', async () => {
    // One unserved capability among several served ones is ordinary: it is how
    // a new specialist enters the registry. Warning on it would make the signal
    // fire on almost every mission and mean nothing.
    const result = await runMission(
      mission(),
      seams((category) => (category.startsWith('Capability 1') ? null : bid(category))),
      { now: () => AT },
    );

    expect(signals(result.trail)).toHaveLength(0);
  });
});
