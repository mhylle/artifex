/**
 * R17 AC-1 — pausing is GRACEFUL.
 *
 * "Given a paused task, when the pause takes effect, then any worker already
 * running finishes its current attempt rather than being killed mid-attempt."
 *
 * This criterion resisted verification for several iterations (friction
 * `63aff355`): a pause clicked in the browser never lands mid-attempt, because
 * a tier-1 task finishes faster than the UI round-trip. Every attempt to catch
 * it produced a pause that arrived before the attempt started, which proves
 * nothing about gracefulness.
 *
 * The latch technique from `mission-loop.parallel.test.ts` solves it: a `work`
 * seam that blocks until released holds an attempt open for as long as the test
 * needs, so the operator's pause can be made to arrive *during* it — which is
 * the only situation the criterion is actually about.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { runMission } from './mission-loop.js';
import type { ControlSignals, MissionSeams } from './mission-loop.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';

function mission(): TaskContract {
  return {
    taskId: MISSION_ID, missionId: MISSION_ID, parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'Produce a one-part answer.',
    acceptanceCriteria: [{ criterionId: 'm-1', statement: 'The part is answered.' }],
    boundaries: { outOfScope: ['Nothing else.'], siblingOwners: [] },
    inputs: { entitlements: ['mission-brief'], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['m-1 met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 20, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier', 'different_agent', 'human_review'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

interface Script {
  readonly control?: ControlSignals;
  readonly onWork?: (contract: TaskContract) => Promise<void> | void;
  /** Gate B fails this many times before passing — forces a second attempt. */
  readonly gateBFailures?: number;
}

function seams(script: Script = {}): MissionSeams {
  let judged = 0;
  return {
    planner: {
      async propose() {
        return {
          subtasks: [{
            objective: 'Answer the only part.',
            category: 'answer',
            acceptanceCriteria: [{ criterionId: 'm-1', statement: 'The part is answered.' }],
            outOfScope: ['Not the whole mission.'],
            blastRadius: 'low' as const,
            effortShare: 0.8,
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
    planJudge: {
      async audit({ children }: { children: readonly { taskId: string }[] }) {
        return { tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })), untestable: [], overlaps: [] };
      },
    },
    registry: { async bestForCategory() { return null; } },
    author: { async design() { return { roleInstructions: 'Answer.', capabilities: ['text'] }; } },
    clarityJudge: { async assess() { return { restatement: 'Answer.', ambiguities: [] }; } },
    work: {
      async execute({ contract }) {
        await script.onWork?.(contract);
        return { deliverable: { answer: 'done' }, actions: [], consulted: [], assumptions: [], effortSpent: 1 };
      },
    },
    completionJudge: {
      async assess({ contract }) {
        judged += 1;
        const fails = judged <= (script.gateBFailures ?? 0);
        return {
          criteria: contract.acceptanceCriteria.map((c) => ({
            criterionId: c.criterionId, met: !fails, detail: fails ? 'not yet' : 'ok',
          })),
          redFlags: [],
        };
      },
    },
    reconciler: {
      async reconcile({ children }) {
        return { deliverable: { summary: `reconciled ${children.length}` }, conflicts: [] };
      },
    },
    ...(script.control === undefined ? {} : { control: script.control }),
  };
}

/** A control seam an operator can flip while the mission is mid-flight. */
function operator() {
  let signal: 'run' | 'paused' | 'cancelled' = 'run';
  const asked: string[] = [];
  return {
    asked,
    pause(): void { signal = 'paused'; },
    signals: {
      async check(taskId: string) { asked.push(taskId); return signal; },
    } satisfies ControlSignals,
  };
}

describe('R17 AC-1 — a pause arriving mid-attempt does not kill the attempt', () => {
  it('the in-flight attempt runs to completion, and the pause takes effect at the NEXT boundary', async () => {
    const op = operator();
    let workCalls = 0;

    const result = await runMission(
      mission(),
      seams({
        control: op.signals,
        gateBFailures: 1, // so there IS a next attempt for the pause to land on
        onWork() {
          workCalls += 1;
          // The operator pauses while this attempt is still running. Before the
          // latch technique this moment was unreachable from a browser: the
          // task finished before the click completed its round-trip.
          op.pause();
        },
      }),
      { now: () => AT },
    );

    const types = result.trail.map((e) => e.type);

    // GRACEFUL: the attempt that was already running finished and was judged.
    expect(types, 'the in-flight attempt must complete').toContain('task.executed');
    expect(types, 'and be evaluated — a killed attempt has no verdict').toContain('gate_b.verdict_issued');

    // ...and only then does the pause stop the task.
    expect(types).toContain('task.paused');
    expect(result.outcome).toBe('surrendered');

    // Exactly one attempt ran: the pause prevented the retry, it did not abort
    // and restart the work already in flight.
    expect(workCalls).toBe(1);
  });

  it('DISTRACTOR: a pause arriving BEFORE the first attempt stops it without executing anything', async () => {
    // Without this, "never execute" would satisfy the test above. It also pins
    // the boundary check itself: the runtime must ask before starting work, or
    // an operator who paused a queued task would watch it run anyway.
    const op = operator();
    op.pause();
    let workCalls = 0;

    const result = await runMission(
      mission(),
      seams({ control: op.signals, onWork() { workCalls += 1; } }),
      { now: () => AT },
    );

    const types = result.trail.map((e) => e.type);
    expect(types).toContain('task.paused');
    expect(types, 'nothing may execute after a pause is already in force').not.toContain('task.executed');
    expect(workCalls).toBe(0);
  });

  it('DISTRACTOR: with no pause the same mission runs to delivery — the guard is not just "always stop"', async () => {
    const op = operator();

    const result = await runMission(
      mission(),
      seams({ control: op.signals, gateBFailures: 1 }),
      { now: () => AT },
    );

    expect(result.outcome).toBe('delivered');
    expect(result.trail.map((e) => e.type)).not.toContain('task.paused');
    // The control seam was genuinely consulted — a runtime that never asked
    // would pass every assertion above by doing nothing.
    expect(op.asked.length).toBeGreaterThan(0);
  });

  it('the paused mission leaves a trail a resume can continue from (R41)', async () => {
    const op = operator();

    const result = await runMission(
      mission(),
      seams({
        control: op.signals,
        gateBFailures: 1,
        onWork() { op.pause(); },
      }),
      { now: () => AT },
    );

    // The work that WAS done is in the trail, so resuming does not pay for it
    // twice — the whole point of the ledger being the checkpoint.
    const executed = result.trail.filter((e) => e.type === 'task.executed');
    expect(executed).toHaveLength(1);
    expect((executed[0]?.payload as { deliverable?: unknown }).deliverable).toEqual({ answer: 'done' });
  });
});
