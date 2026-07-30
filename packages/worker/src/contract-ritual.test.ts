/**
 * R40 — the worker contract ritual: restate, bounce, deliver an evidence bundle.
 *
 * "A worker must restate its contract before starting and bounce it if it
 * cannot — a contract it cannot restate is a contract it must bounce back, not
 * improvise around. It delivers not just an output but an evidence bundle:
 * what it did, what it consulted, what it assumed — because its deliverable
 * must be verifiable by a stranger. Budgets bind in both directions."
 *
 * AC-0 was already built in R8: `runSpecialist` restates, and bounces when the
 * clarity judge finds ambiguity. What was missing is everything after the
 * worker returns — the bundle it produces is richer than what the ledger ever
 * recorded, so the "verifiable by a stranger" promise stopped at the seam.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { runMission } from './mission-loop.js';
import type { MissionSeams } from './mission-loop.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';

function mission(): TaskContract {
  return {
    taskId: MISSION_ID, missionId: MISSION_ID, parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'Answer one thing.',
    acceptanceCriteria: [{ criterionId: 'm-1', statement: 'It is answered.' }],
    boundaries: { outOfScope: ['Nothing else.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['m-1 met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 2, ceiling: 20, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier', 'different_agent'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

interface Script {
  readonly effortSpent?: number | ((attempt: number) => number);
  readonly ambiguities?: string[];
}

function seams(script: Script = {}): MissionSeams {
  let attempt = 0;
  return {
    planner: {
      async propose() {
        return {
          subtasks: [{
            objective: 'Answer the one thing.',
            category: 'answering',
            acceptanceCriteria: [{ criterionId: 'm-1', statement: 'It is answered.' }],
            outOfScope: ['Not the rest.'],
            blastRadius: 'low' as const,
            effortShare: 0.9,
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
    registry: { async bestForCategory() { return null; } },
    author: { async design() { return { roleInstructions: 'Answer.', capabilities: ['text'] }; } },
    clarityJudge: {
      async assess() {
        return { restatement: 'Answer the one thing.', ambiguities: script.ambiguities ?? [] };
      },
    },
    work: {
      async execute() {
        attempt += 1;
        const effort = typeof script.effortSpent === 'function'
          ? script.effortSpent(attempt)
          : script.effortSpent ?? 5;
        return {
          deliverable: { answer: 'the answer' },
          actions: [],
          consulted: [
            { sourceId: 'doc-1', kind: 'document' as const, viaBrokerGrantId: 'grant-1', summary: 'the manual' },
          ],
          assumptions: ['Assumed the reader knows what a bell is.'],
          effortSpent: effort,
        };
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

const executed = (trail: readonly { type: string; payload: Record<string, unknown> }[]) =>
  trail.filter((e) => e.type === 'task.executed');

describe('R40 AC-1 — the bundle reaches the ledger, or the stranger cannot verify', () => {
  it('records what the worker CONSULTED, not just what it produced', async () => {
    const result = await runMission(mission(), seams(), { now: () => AT });

    const consulted = executed(result.trail)[0]?.payload['consulted'];
    expect(Array.isArray(consulted)).toBe(true);
    expect((consulted as Array<{ sourceId: string }>)[0]?.sourceId).toBe('doc-1');
  });

  it('records what the worker ASSUMED — the gap that made R22 AC-1 unsatisfiable', async () => {
    // `EvidenceBundle` has declared an `assumptions` field since P2.5, and
    // `task.executed` recorded only `{ answer }`, so a requester asking "what
    // did you take for granted" could never be answered from the trail.
    const result = await runMission(mission(), seams(), { now: () => AT });

    expect(executed(result.trail)[0]?.payload['assumptions'])
      .toEqual(['Assumed the reader knows what a bell is.']);
  });

  it('DISTRACTOR: an EMPTY assumptions list is recorded as empty, not omitted', async () => {
    // Absent and empty are different claims. Omitting the field would make
    // "nothing was assumed" indistinguishable from "nobody recorded it" — the
    // exact distinction the requester view had to make with `null`.
    const quiet: MissionSeams = {
      ...seams(),
      work: {
        async execute() {
          return { deliverable: { answer: 'x' }, actions: [], consulted: [], assumptions: [], effortSpent: 5 };
        },
      },
    };

    const result = await runMission(mission(), quiet, { now: () => AT });

    expect(executed(result.trail)[0]?.payload).toHaveProperty('assumptions');
    expect(executed(result.trail)[0]?.payload['assumptions']).toEqual([]);
  });

  it('DISTRACTOR: the deliverable is still recorded — the bundle ADDS, it does not replace', async () => {
    const result = await runMission(mission(), seams(), { now: () => AT });

    expect(executed(result.trail)[0]?.payload['deliverable']).toEqual({ answer: 'the answer' });
  });
});

describe('R40 AC-2 — budgets bind in both directions', () => {
  it('refuses a deliverable produced below the effort floor as drive-by shallow work', async () => {
    // Child floor here is 0.9 x the mission floor of 2 = 1.8. A deliverable
    // costing 0.1 is not cheap success; it is work nobody did.
    const result = await runMission(mission(), seams({ effortSpent: 0.1 }), { now: () => AT });

    const types = result.trail.map((e) => e.type);
    expect(types).toContain('task.below_effort_floor');
    expect(result.outcome).toBe('surrendered');
  });

  it('records the shortfall, so the operator sees WHAT was too cheap', async () => {
    const result = await runMission(mission(), seams({ effortSpent: 0.1 }), { now: () => AT });

    const shallow = result.trail.find((e) => e.type === 'task.below_effort_floor');
    expect(shallow?.payload['effortSpent']).toBe(0.1);
    expect(Number(shallow?.payload['floor'])).toBeGreaterThan(0.1);
  });

  it('DISTRACTOR: shallow work never reaches Gate B — it is not "verified cheaply"', async () => {
    // The failure this guards: passing thin work to the reviewer, which may well
    // approve it, and recording a pass. The floor is a claim about effort, and
    // the reviewer does not measure effort.
    const result = await runMission(mission(), seams({ effortSpent: 0.1 }), { now: () => AT });

    expect(result.trail.filter((e) => e.type === 'gate_b.verdict_issued')).toHaveLength(0);
  });

  it('DISTRACTOR: a retry that meets the floor IS accepted — the floor is not a death sentence', async () => {
    // First attempt too cheap, second attempt real. The ladder exists precisely
    // so a shallow attempt costs a rung rather than the task.
    const result = await runMission(
      mission(),
      seams({ effortSpent: (attempt) => (attempt === 1 ? 0.1 : 5) }),
      { now: () => AT },
    );

    expect(result.outcome).toBe('delivered');
    expect(result.trail.filter((e) => e.type === 'task.below_effort_floor')).toHaveLength(1);
    expect(result.trail.filter((e) => e.type === 'gate_b.verdict_issued')).toHaveLength(1);
  });

  it('DISTRACTOR: work AT the floor is accepted — the bound is inclusive', async () => {
    // An exclusive comparison would reject work that spent exactly what the
    // contract asked for, which is the one figure the contract explicitly blesses.
    const atFloor = 0.9 * 2; // effortShare x mission floor
    const result = await runMission(mission(), seams({ effortSpent: atFloor }), { now: () => AT });

    expect(result.outcome).toBe('delivered');
    expect(result.trail.filter((e) => e.type === 'task.below_effort_floor')).toHaveLength(0);
  });
});

describe('R40 AC-0 — restate or bounce (built in R8, verified here)', () => {
  it('bounces rather than improvising when the contract cannot be restated cleanly', async () => {
    const result = await runMission(
      mission(),
      seams({ ambiguities: ['Which bell? There are three in the objective.'] }),
      { now: () => AT },
    );

    const types = result.trail.map((e) => e.type);
    expect(types).toContain('task.bounced');
    // Bounced BEFORE executing: improvising an interpretation is the thing the
    // ritual forbids, so no work may happen first.
    expect(types.indexOf('task.bounced')).toBeLessThan(
      types.includes('task.executed') ? types.indexOf('task.executed') : Number.MAX_SAFE_INTEGER,
    );
  });
});
