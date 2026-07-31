/**
 * A minimal mission whose reviewer can be measured (R35).
 *
 * Extracted so the calibration tests can drive the real loop without a hundred
 * lines of seam boilerplate inline, and so the two terminal paths — delivered
 * and surrendered — differ by exactly one flag.
 */
import type { TaskContract } from '@artifex/shared-types';

import type { MissionSeams } from '../mission-loop.js';

const AT = '2026-07-31T09:00:00.000Z';
const MISSION_ID = '6f3b0a17-2c94-4e58-b8d1-05a7e93c4612';

export function mission(): TaskContract {
  return {
    taskId: MISSION_ID, missionId: MISSION_ID, parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'State one fact.',
    acceptanceCriteria: [{ criterionId: 'm-1', statement: 'The fact is stated.' }],
    boundaries: { outOfScope: ['Else.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['Stated.'], stopTryingWhen: ['No source.'], maxAttempts: 2, stallLimit: 2 },
    budget: { floor: 1, ceiling: 20, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_same'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

export interface CalibrationScript {
  /** What the independent re-reviewer says about every sampled verdict. */
  readonly reReviewAs?: 'pass' | 'fail';
  /** Plant one probe whose correct answer is this. */
  readonly probeExpecting?: 'pass' | 'fail';
  readonly gateBPasses?: boolean;
  /** Omit the seam entirely — every caller predates it. */
  readonly noSeam?: boolean;
}

export function seams(script: CalibrationScript = {}): MissionSeams {
  const passes = script.gateBPasses ?? true;

  return {
    planner: { async propose() { return { subtasks: [] }; } },
    coverageJudge: { async assess() { return { coverage: [] }; } },
    decompositionGate: { async assess() { return { keepWhole: true, rationale: 'one thing' }; } },
    intentJudge: { async assess() { return { servesIntent: true, detail: 'ok', redFlags: [] }; } },
    planJudge: {
      async audit({ children }) {
        return {
          tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })),
          untestable: [], overlaps: [],
        };
      },
    },
    registry: { async bestForCategory() { return null; } },
    author: { async design() { return { roleInstructions: 'Do it.', capabilities: ['text'] }; } },
    clarityJudge: { async assess() { return { restatement: 'Do it.', ambiguities: [] }; } },
    work: {
      async execute() {
        return { deliverable: { answer: 'x' }, actions: [], consulted: [], assumptions: [], effortSpent: 5 };
      },
    },
    completionJudge: {
      async assess({ contract }) {
        return {
          criteria: contract.acceptanceCriteria.map((c) => ({
            criterionId: c.criterionId, met: passes, detail: passes ? 'ok' : 'no',
          })),
          redFlags: [],
        };
      },
    },
    reconciler: { async reconcile({ children }) { return { deliverable: { n: children.length }, conflicts: [] }; } },
    ...(script.noSeam === true ? {} : {
      calibration: {
        // A DIFFERENT reviewer id, or `calibrationOf` would refuse the re-review
        // as non-independent and the measurement would be empty.
        async sample(issued) {
          return issued.map((v) => ({
            taskId: v.taskId,
            outcome: script.reReviewAs ?? v.outcome,
            reviewerId: 'independent-reviewer',
          }));
        },
        async probes() {
          if (script.probeExpecting === undefined) return [];
          // A REAL planted probe: its own contract and its own deliverable, run
          // through the same Gate B as the mission's work.
          //
          // The first version returned `{taskId: MISSION_ID, expected}` — the id
          // of the task the loop actually ran. That is not a planted probe at
          // all, it is relabelling real work as one, and it could only ever
          // score whatever the mission happened to do. It passed because nothing
          // implemented `probes`, so no probe was ever reviewed and the shape
          // was never exercised. Fixed at the fixture, which was the thing that
          // was wrong.
          return [{
            taskId: 'probe:fixture:planted',
            expected: script.probeExpecting,
            contract: mission(),
            deliverable: { answer: 'an answer to some other question entirely' },
            sourceCaseId: 'fixture',
            borrowedFrom: script.probeExpecting === 'fail' ? 'other-case' : null,
          }];
        },
      },
    }),
  };
}
