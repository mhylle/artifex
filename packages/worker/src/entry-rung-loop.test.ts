/**
 * R36 in the loop — the half that changes behaviour.
 *
 * `escalation.ts` decides where a failure belongs. This asserts the mission loop
 * actually GOES there, because a correct decision function nothing calls is the
 * failure shape this project has hit four times: a mechanism that is perfect and
 * a producer that is a constant, absent, or a field nobody reads.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { runMission } from './mission-loop.js';
import type { MissionSeams } from './mission-loop.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '2a7c4e19-8b05-4d31-9f6a-1c3e5b8d0a24';

function mission(): TaskContract {
  return {
    taskId: MISSION_ID, missionId: MISSION_ID, parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'State one fact.',
    acceptanceCriteria: [{ criterionId: 'm-1', statement: 'The fact is stated.' }],
    boundaries: { outOfScope: ['Everything else.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: {
      doneWhen: ['Stated.'], stopTryingWhen: ['No source.'], maxAttempts: 5, stallLimit: 2,
    },
    budget: { floor: 1, ceiling: 20, unit: 'effort-units' },
    escalationPolicy: {
      ladder: ['retry_same', 'retry_higher_tier', 'different_agent', 'agent_redesign', 're_decomposition'],
      humanAt: null,
    },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

/** Gate B always fails, with the given error class on every finding. */
function seams(errorClass: string): MissionSeams {
  return {
    planner: {
      async propose() {
        return {
          subtasks: [{
            objective: 'State it.', category: 'stating',
            acceptanceCriteria: [{ criterionId: 'm-1', statement: 'The fact is stated.' }],
            outOfScope: ['Else.'], blastRadius: 'low' as const, effortShare: 0.9,
          }],
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
            criterionId: c.criterionId, met: false, detail: `failed as ${errorClass}`,
          })),
          redFlags: [],
        };
      },
    },
    reconciler: { async reconcile({ children }) { return { deliverable: { n: children.length }, conflicts: [] }; } },
  };
}

const rungs = (trail: readonly { type: string; payload: Record<string, unknown> }[]) =>
  trail.filter((e) => e.type === 'escalation.rung_climbed').map((e) => String(e.payload['rung']));

describe('R36 — the loop enters the ladder where the error class says', () => {
  it('an ordinary execution failure enters at rung 1', async () => {
    // Gate B classes an unmet criterion as `execution_error`, whose entry rung
    // IS the cheapest remedy — the same place the old unconditional `+= 1`
    // landed. Deliberately kept: it pins that the common case did not regress
    // while the jumping classes were added.
    //
    // A first draft expected `retry_higher_tier` here, which was simply the
    // wrong reading of AC-1: "rung 1" is the first rung, `retry_same`. The test
    // drove a wrong expectation and was corrected at the expectation.
    const result = await runMission(mission(), seams('execution_error'), { now: () => AT });

    expect(rungs(result.trail)[0]).toBe('retry_same');
  });

  it('records WHICH class chose the entry rung, so the jump is auditable', async () => {
    // An escalation that skipped rungs without saying why reads like a bug.
    const result = await runMission(mission(), seams('execution_error'), { now: () => AT });

    const first = result.trail.find((e) => e.type === 'escalation.rung_climbed');
    expect(first?.payload).toHaveProperty('entryClass');
  });

  it('DISTRACTOR: the ladder never walks BACKWARDS to a cheaper rung', async () => {
    // The entry rung is chosen once. If it were recomputed every failure, a task
    // that failed at re_decomposition and then failed as an execution slip would
    // drop back to rung 1 and loop between them forever.
    const result = await runMission(mission(), seams('execution_error'), { now: () => AT });
    const ladder = mission().escalationPolicy.ladder;

    const indexes = rungs(result.trail).map((r) => ladder.indexOf(r as never));
    for (let i = 1; i < indexes.length; i += 1) {
      expect(indexes[i]!, 'rungs must be non-decreasing').toBeGreaterThan(indexes[i - 1]!);
    }
  });

  it('trips the stall counter when the same attempt repeats, and says so', async () => {
    // `stallLimit` has been on every contract since P2 and was read by nothing,
    // so a task could be attempted identically until `maxAttempts` ran out.
    // The ladder here starts at `retry_same`, which by definition repeats the
    // attempt — the exact case the counter exists for.
    const result = await runMission(mission(), seams('execution_error'), { now: () => AT });

    const stall = result.trail.find((e) => e.type === 'task.stalled');
    expect(stall, 'the repeated attempt was never recognised as a stall').toBeDefined();
    expect(String(stall?.payload['detail'])).toMatch(/same tier|repeat/i);
  });

  it('a stall SKIPS the cheap rungs — it outranks the verdict own class', async () => {
    // The whole point, and it needs an exact assertion to bite. `execution_error`
    // maps to `retry_same`, so the plain one-rung step after the first failure
    // would land on `retry_higher_tier`. The stall instead sends it to
    // `different_agent`, skipping the tier bump entirely — because the thing
    // that has failed twice identically will not be fixed by the same agent.
    //
    // A first version asserted only "not retry_same", which the plain step also
    // satisfies, so a mutant removing the override survived. Naming the rung is
    // what makes this a test rather than a reassurance.
    const result = await runMission(mission(), seams('execution_error'), { now: () => AT });

    const climbed = rungs(result.trail);

    expect(climbed[0]).toBe('retry_same');
    expect(climbed[1]).toBe('different_agent');
    expect(climbed, 'the tier bump must be skipped, not merely reordered').not.toContain('retry_higher_tier');
  });

  it('DISTRACTOR: a mission that keeps failing still terminates', async () => {
    // The ladder must exhaust. An entry-rung jump that reset progress would let
    // a doomed task spend its whole budget cycling.
    const result = await runMission(mission(), seams('execution_error'), { now: () => AT });

    expect(result.outcome).toBe('surrendered');
  });
});
