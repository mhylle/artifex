/**
 * R33 AC-1 — a Gate A rejection is a specification, not a dead end.
 *
 * Today the loop calls `fail('Gate A rejected the decomposition', ...)`, which
 * surrenders the subtree. The criterion asks for the opposite: the Orchestrator
 * **re-splits from that verdict rather than retrying blind**.
 *
 * The distinction matters because the two failure modes are different work.
 * Retrying blind re-proposes from the same objective and very often produces the
 * same plan — burning a model call to rehearse the rejection. Re-splitting FROM
 * the verdict hands the planner what was wrong, so the second attempt is aimed.
 *
 * Bounded, though: a planner that cannot fix its plan must not loop forever, so
 * the re-split is a single retry and the second rejection surrenders honestly.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { runMission } from './mission-loop.js';
import type { MissionSeams } from './mission-loop.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '5e8b1d40-92a7-4c3e-8b15-6d2f0a9e4c71';

function mission(): TaskContract {
  return {
    taskId: MISSION_ID, missionId: MISSION_ID, parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'Compare two electric cars on range and price.',
    acceptanceCriteria: [
      { criterionId: 'm-1', statement: 'Range is compared.' },
      { criterionId: 'm-2', statement: 'Price is compared.' },
    ],
    boundaries: { outOfScope: ['Insurance.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: {
      doneWhen: ['Both compared.'], stopTryingWhen: ['No data.'], maxAttempts: 3, stallLimit: 2,
    },
    budget: { floor: 1, ceiling: 20, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

interface Proposal {
  readonly objective: string;
  readonly category: string;
  readonly acceptanceCriteria: { criterionId: string; statement: string }[];
  readonly outOfScope: string[];
  readonly blastRadius: 'low';
  readonly effortShare: number;
}

const sub = (criterionId: string, statement: string): Proposal => ({
  objective: `Handle ${criterionId}.`,
  category: 'comparing',
  acceptanceCriteria: [{ criterionId, statement }],
  outOfScope: ['The other part.'],
  blastRadius: 'low',
  effortShare: 0.45,
});

/** Records every planner call so the retry's INPUT can be inspected. */
function seams(script: {
  readonly plans: Proposal[][];
  readonly untestableOn?: number;
}) {
  const proposeCalls: Array<Record<string, unknown>> = [];
  let planIndex = 0;
  let auditCall = 0;

  const missionSeams: MissionSeams = {
    planner: {
      async propose(input: Record<string, unknown>) {
        proposeCalls.push(input);
        const plan = script.plans[Math.min(planIndex, script.plans.length - 1)]!;
        planIndex += 1;
        return { subtasks: plan };
      },
    },
    coverageJudge: {
      async assess({ parent, children }) {
        return {
          coverage: parent.acceptanceCriteria.map((c) => {
            const owner = children.find((k) => k.acceptanceCriteria.some((x) => x.criterionId === c.criterionId));
            return { criterionId: c.criterionId, coveredByTaskIds: owner === undefined ? [] : [owner.taskId] };
          }),
        };
      },
    },
    planJudge: {
      async audit({ children }) {
        auditCall += 1;
        const failThis = script.untestableOn === auditCall;
        return {
          tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })),
          // A criterion the DECOMPOSITION introduced. An inherited one is
          // deliberately not failed for testability — the planner cannot reword
          // what it carried through verbatim — so using one here would test
          // nothing.
          untestable: failThis && children[0] !== undefined
            ? [{
                taskId: children[0].taskId,
                criterionId: 'sub-invented',
                detail: '"compared" names no observable outcome',
              }]
            : [],
          overlaps: [],
        };
      },
    },
    registry: { async bestForCategory() { return null; } },
    author: { async design() { return { roleInstructions: 'Do it.', capabilities: ['text'] }; } },
    clarityJudge: { async assess() { return { restatement: 'Do it.', ambiguities: [] }; } },
    work: {
      async execute() {
        return { deliverable: { answer: 'done' }, actions: [], consulted: [], assumptions: [], effortSpent: 5 };
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

  return { missionSeams, proposeCalls };
}

const BOTH = [sub('m-1', 'Range is compared.'), sub('m-2', 'Price is compared.')];
const ONLY_ONE = [sub('m-1', 'Range is compared.')];

describe('R33 AC-1 — the Orchestrator re-splits FROM the verdict', () => {
  it('re-plans after a Gate A rejection instead of surrendering', async () => {
    const { missionSeams, proposeCalls } = seams({ plans: [ONLY_ONE, BOTH] });

    const result = await runMission(mission(), missionSeams, { now: () => AT });

    expect(proposeCalls).toHaveLength(2);
    expect(result.outcome).toBe('delivered');
  });

  it('hands the planner WHAT FAILED — the retry is aimed, not blind', async () => {
    // The whole distinction. Re-proposing from the same objective very often
    // produces the same plan, which spends a model call rehearsing the
    // rejection. The verdict's findings are what make the second attempt differ.
    //
    // This assertion was first written as "the retry input mentions 'Price is
    // compared'" — and a mutant that dropped `rejectedBecause` entirely still
    // passed, because the CONTRACT carries that phrase in its own criteria. The
    // test was matching the wrong half of the input and would have held for a
    // completely blind retry. Seventh surviving mutant to expose an untested
    // claim; it now names the field that carries the verdict.
    const { missionSeams, proposeCalls } = seams({ plans: [ONLY_ONE, BOTH] });

    await runMission(mission(), missionSeams, { now: () => AT });

    const rejected = proposeCalls[1]?.['rejectedBecause'];
    expect(Array.isArray(rejected), 'the planner was re-asked without the verdict').toBe(true);
    expect((rejected as string[]).join(' ')).toMatch(/Price is compared/);
  });

  it('DISTRACTOR: the FIRST proposal carries no verdict — there is nothing to aim at yet', async () => {
    const { missionSeams, proposeCalls } = seams({ plans: [ONLY_ONE, BOTH] });

    await runMission(mission(), missionSeams, { now: () => AT });

    expect(proposeCalls[0]).not.toHaveProperty('rejectedBecause');
  });

  it('records the re-split, so the trail shows WHY the plan changed', async () => {
    const { missionSeams } = seams({ plans: [ONLY_ONE, BOTH] });

    const result = await runMission(mission(), missionSeams, { now: () => AT });

    expect(result.trail.map((e) => e.type)).toContain('decomposition.resplit');
  });

  it('re-splits on a JUDGED clause too, not only on coverage', async () => {
    // Every clause produces the same kind of verdict, so every clause must feed
    // the same repair. A gate that only re-splits on the check it started with
    // would leave the five newer clauses as dead ends.
    const { missionSeams, proposeCalls } = seams({ plans: [BOTH, BOTH], untestableOn: 1 });

    const result = await runMission(mission(), missionSeams, { now: () => AT });

    expect(proposeCalls).toHaveLength(2);
    expect(result.outcome).toBe('delivered');
  });

  it('DISTRACTOR: a plan that passes first time is NOT re-planned', async () => {
    // A repair that fires on success would double the cost of every mission.
    const { missionSeams, proposeCalls } = seams({ plans: [BOTH] });

    const result = await runMission(mission(), missionSeams, { now: () => AT });

    expect(proposeCalls).toHaveLength(1);
    expect(result.trail.map((e) => e.type)).not.toContain('decomposition.resplit');
    expect(result.outcome).toBe('delivered');
  });

  it('DISTRACTOR: a SECOND rejection surrenders — the repair is bounded', async () => {
    // A planner that cannot fix its plan must not loop forever. One aimed retry
    // is the remedy; an unbounded one is a way to spend a whole budget
    // rehearsing the same rejection with better instructions each time.
    const { missionSeams, proposeCalls } = seams({ plans: [ONLY_ONE, ONLY_ONE, BOTH] });

    const result = await runMission(mission(), missionSeams, { now: () => AT });

    expect(result.outcome).toBe('surrendered');
    expect(proposeCalls).toHaveLength(2);
  });

  it('DISTRACTOR: nothing is staffed or executed before Gate A passes (AC-2)', async () => {
    // Specification errors are caught on paper. If staffing preceded the gate,
    // a rejected plan would already have cost agent designs and executions.
    const { missionSeams } = seams({ plans: [ONLY_ONE, BOTH] });

    const result = await runMission(mission(), missionSeams, { now: () => AT });

    const types = result.trail.map((e) => e.type);
    const firstPass = result.trail.findIndex(
      (e) => e.type === 'gate_a.verdict_issued' && e.payload['outcome'] === 'pass',
    );
    const firstStaffed = types.indexOf('agent.staffed');
    const firstExecuted = types.indexOf('task.executed');

    expect(firstPass).toBeGreaterThanOrEqual(0);
    expect(firstStaffed).toBeGreaterThan(firstPass);
    expect(firstExecuted).toBeGreaterThan(firstPass);
  });
});
