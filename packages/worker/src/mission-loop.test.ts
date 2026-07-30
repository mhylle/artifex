/**
 * P9 — the end-to-end mission loop (R9).
 *
 * Everything built in P4–P8.6 assembled: decompose → Gate A → staff → execute →
 * Gate B → fold-up, with the escalation ladder on failure. Every seam is scripted
 * here so the *control flow* can be asserted exactly; the live model run is the
 * dogfood.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { runMission } from './mission-loop.js';
import type { MissionSeams } from './mission-loop.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';

function mission(over: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: MISSION_ID, missionId: MISSION_ID, parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'Produce a two-part answer.',
    acceptanceCriteria: [{ criterionId: 'm-1', statement: 'Both parts are answered.' }],
    boundaries: { outOfScope: ['Nothing else.'], siblingOwners: [] },
    inputs: { entitlements: ['mission-brief'], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['m-1 met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 20, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier', 'different_agent', 'human_review'], humanAt: 'human_review' },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
    ...over,
  };
}

/** All seams succeed. `gateBFailuresPerTask` scripts failures by task index. */
function seams(options: { gateBFailuresPerTask?: Record<number, number> } = {}): MissionSeams {
  const failures = { ...(options.gateBFailuresPerTask ?? {}) };
  const attempts: Record<string, number> = {};

  return {
    planner: {
      async propose() {
        return {
          subtasks: [0, 1].map((i) => ({
            objective: `Answer part ${i + 1}.`,
            category: 'answer',
            acceptanceCriteria: [{ criterionId: `ac-${i + 1}`, statement: `Part ${i + 1} is answered.` }],
            outOfScope: ['Not the other part.'],
            blastRadius: 'low' as const,
            effortShare: 0.4,
          })),
        };
      },
    },
    coverageJudge: {
      async assess({ parent, children }) {
        return { coverage: parent.acceptanceCriteria.map((c) => ({ criterionId: c.criterionId, coveredByTaskIds: children.map((k) => k.taskId) })) };
      },
    },
    registry: { async bestForCategory() { return null; } },
    author: { async design() { return { roleInstructions: 'Answer one part.', capabilities: ['text'] }; } },
    clarityJudge: { async assess() { return { restatement: 'Answer one part.', ambiguities: [] }; } },
    work: {
      async execute({ contract }) {
        return { deliverable: { answer: `done: ${contract.objective}` }, actions: [], consulted: [], assumptions: [], effortSpent: 1 };
      },
    },
    completionJudge: {
      async assess({ contract }) {
        attempts[contract.taskId] = (attempts[contract.taskId] ?? 0) + 1;
        const index = Number(contract.objective.match(/part (\d)/)?.[1] ?? '1') - 1;
        const budgeted = failures[index] ?? 0;
        const shouldFail = attempts[contract.taskId]! <= budgeted;
        return {
          criteria: contract.acceptanceCriteria.map((c) => ({
            criterionId: c.criterionId,
            met: !shouldFail,
            detail: shouldFail ? 'not yet' : 'ok',
          })),
          redFlags: [],
        };
      },
    },
    reconciler: {
      async reconcile({ children }) {
        return { deliverable: { summary: `reconciled ${children.length} parts` }, conflicts: [] };
      },
    },
  };
}

describe('R9 AC-1 — the full loop completes and leaves an ordered ledger trail', () => {
  it('delivers a verified result', async () => {
    const result = await runMission(mission(), seams(), { now: AT });

    expect(result.outcome).toBe('delivered');
    expect(result.deliverable).toEqual({ summary: 'reconciled 2 parts' });
  });

  it('records every stage of the loop, in order', async () => {
    const result = await runMission(mission(), seams(), { now: AT });
    const types = result.trail.map((e) => e.type);

    // The stages the design names: decompose, Gate A, staff, execute, Gate B, fold.
    const expectedOrder = ['mission.started', 'task.contracted', 'gate_a.verdict_issued', 'agent.staffed', 'task.executed', 'gate_b.verdict_issued', 'mission.folded'];
    const firstIndexOf = (t: string) => types.indexOf(t);

    for (const t of expectedOrder) {
      expect(types, `the trail must contain ${t}`).toContain(t);
    }
    for (let i = 1; i < expectedOrder.length; i += 1) {
      expect(
        firstIndexOf(expectedOrder[i]!),
        `${expectedOrder[i]} must not appear before ${expectedOrder[i - 1]}`,
      ).toBeGreaterThan(firstIndexOf(expectedOrder[i - 1]!));
    }
  });

  it('DISTRACTOR: Gate A runs BEFORE any execution — verifying both ends means before, too', async () => {
    const result = await runMission(mission(), seams(), { now: AT });
    const types = result.trail.map((e) => e.type);

    expect(types.indexOf('gate_a.verdict_issued')).toBeLessThan(types.indexOf('task.executed'));
  });

  it('DISTRACTOR: a failing Gate A stops the mission before anything executes', async () => {
    const uncovered: MissionSeams = {
      ...seams(),
      coverageJudge: { async assess() { return { coverage: [{ criterionId: 'm-1', coveredByTaskIds: [] }] }; } },
    };

    const result = await runMission(mission(), uncovered, { now: AT });

    expect(result.outcome).toBe('surrendered');
    expect(result.trail.map((e) => e.type)).not.toContain('task.executed');
  });

  it('every event carries the mission id, so the trail is replayable as one unit', async () => {
    const result = await runMission(mission(), seams(), { now: AT });

    expect(result.trail.every((e) => e.missionId === MISSION_ID)).toBe(true);
  });
});

describe('R9 AC-2 — one Gate B failure climbs exactly one rung', () => {
  it('escalates one rung and retries at a HIGHER tier', async () => {
    const result = await runMission(mission(), seams({ gateBFailuresPerTask: { 0: 1 } }), { now: AT });

    expect(result.outcome).toBe('delivered');
    expect(result.escalations).toHaveLength(1);
    expect(result.escalations[0]?.rung).toBe('retry_higher_tier');
    expect(result.escalations[0]?.toTier).toBeGreaterThan(result.escalations[0]!.fromTier);
  });

  it('records BOTH the failure and the escalation as ledger events', async () => {
    const result = await runMission(mission(), seams({ gateBFailuresPerTask: { 0: 1 } }), { now: AT });
    const types = result.trail.map((e) => e.type);

    expect(types.filter((t) => t === 'gate_b.verdict_issued').length).toBeGreaterThanOrEqual(3);
    expect(types).toContain('escalation.rung_climbed');
    const escalationEvent = result.trail.find((e) => e.type === 'escalation.rung_climbed');
    expect(escalationEvent?.family).toBe('escalation');
  });

  it('DISTRACTOR: exactly ONE rung per failure — a single failure does not jump the ladder', async () => {
    const result = await runMission(mission(), seams({ gateBFailuresPerTask: { 0: 1 } }), { now: AT });

    expect(result.escalations).toHaveLength(1);
    // The ladder's second rung must NOT have been used for a single failure.
    expect(result.escalations.map((e) => e.rung)).not.toContain('different_agent');
  });

  it('DISTRACTOR: two failures climb two rungs, in ladder order', async () => {
    // Proves escalation is per-failure, not a one-off flag.
    const result = await runMission(mission(), seams({ gateBFailuresPerTask: { 0: 2 } }), { now: AT });

    expect(result.escalations.map((e) => e.rung)).toEqual(['retry_higher_tier', 'different_agent']);
  });

  it('DISTRACTOR: a task that never fails climbs no rungs at all', async () => {
    const result = await runMission(mission(), seams(), { now: AT });

    expect(result.escalations).toHaveLength(0);
  });

  it('surrenders when the ladder is exhausted rather than looping forever', async () => {
    // stopTryingWhen / maxAttempts exist precisely so failure is bounded.
    const result = await runMission(mission(), seams({ gateBFailuresPerTask: { 0: 99 } }), { now: AT });

    expect(result.outcome).toBe('surrendered');
    expect(result.trail.map((e) => e.type)).toContain('mission.surrendered');
  });

  it('DISTRACTOR: surrender is a first-class outcome carrying what was learned, not a crash', async () => {
    const result = await runMission(mission(), seams({ gateBFailuresPerTask: { 0: 99 } }), { now: AT });
    const surrender = result.trail.find((e) => e.type === 'mission.surrendered');

    expect(surrender?.payload).toHaveProperty('blockers');
    expect(result.escalations.length).toBeGreaterThan(0);
  });
});

describe('R9 — the loop honours the tier policy per seam', () => {
  it('staffs leaves at the cheapest tier their risk permits', async () => {
    const result = await runMission(mission(), seams(), { now: AT });
    const staffed = result.trail.filter((e) => e.type === 'agent.staffed');

    expect(staffed.length).toBe(2);
    for (const event of staffed) {
      expect(event.payload['logicalTier']).toBe(1);
    }
  });

  it('DISTRACTOR: the retry tier is higher than the original, not merely different', async () => {
    const result = await runMission(mission(), seams({ gateBFailuresPerTask: { 0: 1 } }), { now: AT });
    const escalation = result.escalations[0]!;

    expect(escalation.toTier).toBe(escalation.fromTier + 1);
  });
});

describe('R9 — a seam that THROWS is a failure, not a crash', () => {
  it('a runaway model during execution climbs the ladder instead of killing the mission', async () => {
    // Observed live: a small model under constrained decoding ran away to the
    // context limit and threw. A mission that dies on that loses its whole
    // ledger trail and tells the operator nothing.
    let calls = 0;
    const flaky: MissionSeams = {
      ...seams(),
      work: {
        async execute(args) {
          calls += 1;
          if (calls === 1) throw new Error('AI_NoObjectGeneratedError: finish_reason length');
          return seams().work.execute(args);
        },
      },
    };

    const result = await runMission(mission(), flaky, { now: AT });

    expect(result.outcome).toBe('delivered');
    expect(result.trail.map((e) => e.type)).toContain('task.failed');
    expect(result.escalations).toHaveLength(1);
  });

  it('DISTRACTOR: a permanently failing seam surrenders with the reason, rather than throwing', async () => {
    const broken: MissionSeams = {
      ...seams(),
      work: { async execute() { throw new Error('backend unreachable'); } },
    };

    const result = await runMission(mission(), broken, { now: AT });

    expect(result.outcome).toBe('surrendered');
    const surrender = result.trail.find((e) => e.type === 'mission.surrendered');
    expect(surrender?.payload).toHaveProperty('blockers');
  });

  it('DISTRACTOR: a failing PLANNER surrenders with the error as a blocker', async () => {
    const broken: MissionSeams = {
      ...seams(),
      planner: { async propose() { throw new Error('planner ran away'); } },
    };

    const result = await runMission(mission(), broken, { now: AT });

    expect(result.outcome).toBe('surrendered');
    const surrender = result.trail.find((e) => e.type === 'mission.surrendered');
    expect(JSON.stringify(surrender?.payload)).toMatch(/ran away/);
  });
});
