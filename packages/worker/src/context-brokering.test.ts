/**
 * Invariant #6 in the loop — "no peer chatter" (defects `488709be`, `753bc6dd`).
 *
 * `ContextBroker` and `BrokeredFabric` have been complete and tested since P3:
 * entitlement checked against THIS contract, grants scoped to one source, and
 * every exchange logged in both directions. Nothing ever constructed one —
 * grepping for `ContextBroker` across the packages outside its own module
 * returned nothing — so invariant #6 existed only in its own tests.
 *
 * Two things had to be true for wiring it to mean anything, and only one was:
 *
 *   The broker was ready. The CONTRACTS were not: `authorContracts` gave every
 *   child `entitlements: []`, so a wired broker would have denied every request
 *   and the invariant would have been "enforced" by having nothing to enforce.
 *
 * So this pairs the broker with a real entitlement — each task may request the
 * Knowledge Commons for its own capability, which is also the consumer half the
 * commons has been missing since R24 shipped its producer (`753bc6dd`).
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { runMission } from './mission-loop.js';
import type { MissionSeams } from './mission-loop.js';

const AT = '2026-07-31T09:00:00.000Z';
const MISSION_ID = '7d2b6f14-3c85-4a90-b1e7-5f8c2d0a4e63';

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
      doneWhen: ['Stated.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2,
    },
    budget: { floor: 1, ceiling: 40, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

function seams(over: Partial<MissionSeams> = {}): MissionSeams {
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
    planJudge: {
      async audit({ children }) {
        return {
          tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })),
          untestable: [], overlaps: [],
        };
      },
    },
    intentJudge: { async assess() { return { servesIntent: true, detail: 'ok', redFlags: [] }; } },
    registry: { async bestForCategory() { return null; } },
    author: { async design() { return { roleInstructions: 'State it.', capabilities: ['text'] }; } },
    clarityJudge: { async assess() { return { restatement: 'Do it.', ambiguities: [] }; } },
    work: {
      async execute() {
        return { deliverable: { answer: 'x' }, actions: [], consulted: [], assumptions: [], effortSpent: 2 };
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
    ...over,
  };
}

/** A commons that answers for one source and knows nothing else. */
const commonsWith = (known: Record<string, unknown>) => ({
  async read(source: string) {
    return known[source] ?? null;
  },
});

describe('488709be — the loop really brokers context', () => {
  it('logs a GRANT when a task requests a source its contract entitles it to', async () => {
    const result = await runMission(
      mission(),
      seams({ context: commonsWith({ 'commons:stating': [{ claim: 'water boils at 100C' }] }) } as never),
      { now: () => AT },
    );

    const granted = result.trail.find((e) => e.type === 'context.granted');
    expect(granted, 'no context was ever brokered — invariant #6 has nothing to enforce').toBeDefined();
    expect(String(granted?.payload['source'])).toMatch(/commons:/);
  });

  it('the payload reaches the WORKER, not just the ledger', async () => {
    // A grant nobody reads is a log line. The point of brokering is that the
    // specialist actually gets the context.
    const seen: unknown[] = [];
    await runMission(
      mission(),
      seams({
        context: commonsWith({ 'commons:stating': [{ claim: 'water boils at 100C' }] }),
        work: {
          async execute(input: { priorKnowledge?: unknown }) {
            seen.push(input.priorKnowledge);
            return { deliverable: { answer: 'x' }, actions: [], consulted: [], assumptions: [], effortSpent: 2 };
          },
        },
      } as never),
      { now: () => AT },
    );

    expect(seen[0], 'the broker granted context and the worker never saw it').toEqual([{ claim: 'water boils at 100C' }]);
  });

  it('records what was CONSULTED on the evidence bundle', async () => {
    // R40's bundle already has a `consulted` field for exactly this. A brokered
    // read that left it empty would make the trail say the task consulted
    // nothing while the ledger says it was granted something.
    const result = await runMission(
      mission(),
      seams({ context: commonsWith({ 'commons:stating': [{ claim: 'a fact' }] }) } as never),
      { now: () => AT },
    );

    const executed = result.trail.find((e) => e.type === 'task.executed');
    const consulted = executed?.payload['consulted'] as Array<{ source: string; viaBrokerGrantId: string | null }>;

    expect(consulted?.[0]?.source).toMatch(/commons:/);
    // The GRANT id, not just the source. That is what distinguishes brokered
    // access from a direct read, and it is the thing that evidences invariant #6.
    expect(consulted?.[0]?.viaBrokerGrantId, 'the consultation does not record which grant allowed it').toBeTruthy();
  });

  it('DISTRACTOR: a source the contract does NOT entitle is refused, and the refusal is logged', async () => {
    // The invariant's teeth. A silent denial leaves no more of a trail than a
    // silent permission, and a broker that only ever grants is a pass-through.
    const result = await runMission(
      mission(),
      seams({
        context: commonsWith({ 'commons:stating': [{ claim: 'a fact' }] }),
        // The loop asks for this too; the contract entitles neither task to it.
        extraSources: ['secrets:payroll'],
      } as never),
      { now: () => AT },
    );

    const denied = result.trail.find((e) => e.type === 'context.request_denied');
    expect(denied, 'an unentitled source was not refused, or was refused silently').toBeDefined();
    expect(String(denied?.payload['source'])).toBe('secrets:payroll');
  });

  it('DISTRACTOR: a mission with NO context store runs exactly as before', async () => {
    // Every caller predates brokering. Its absence must be invisible, and a
    // mission that could not run without a commons would have made the store a
    // dependency of correctness rather than an improvement.
    const withStore = await runMission(
      mission(), seams({ context: commonsWith({}) } as never), { now: () => AT },
    );
    const without = await runMission(mission(), seams(), { now: () => AT });

    expect(without.outcome).toBe(withStore.outcome);
    expect(without.trail.some((e) => e.type === 'context.granted')).toBe(false);
  });

  it('DISTRACTOR: a commons that throws does not cost the mission its result', async () => {
    // Context is an improvement, not a gate. Losing verified work because a
    // knowledge read failed trades the product for the reference material.
    const exploding = { async read() { throw new Error('commons unavailable'); } };

    const result = await runMission(mission(), seams({ context: exploding } as never), { now: () => AT });

    expect(result.outcome).toBe('delivered');
  });
});
