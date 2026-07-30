/**
 * Defect 08db92fd — a deliverable that is serialised JSON, not an answer.
 *
 * Measured across the whole ledger: 2 of 65 `task.executed` events carry an
 * `answer` that is JSON rather than prose. Both pass schema validation, because
 * the value genuinely IS a non-empty string. Gate B then judges garbage and the
 * requester view renders it — a silent-wrong-answer path, which is worse than a
 * crash because nothing anywhere reports a problem.
 *
 * The two shapes below are verbatim from the ledger, not invented:
 *   1. a whole nested JSON document where a string was asked for
 *   2. a fragment where the model closed the string and kept authoring keys
 *
 * Handled in the same shape as R40's effort floor, because it is the same class
 * of failure — the worker returned something the contract cannot accept. A
 * corrupt attempt costs an escalation rung, not the task.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { runMission } from './mission-loop.js';
import type { MissionSeams } from './mission-loop.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '7c2e9b31-4a5d-4e88-9f10-2b6c8d4e1a05';

/** Verbatim from ledger event on mission 0f95dc3c — the fragment shape. */
const FRAGMENT_LEAK =
  '5", "explanation": "A standard hard-boiled egg reaches a state where the white is fully coagulated.';

/** Verbatim shape from the second leaked event — a whole document. */
const DOCUMENT_LEAK =
  '{\n    "summary": {\n        "purpose": "Explain the mechanism of graphite and clay."\n    }\n}';

function mission(): TaskContract {
  return {
    taskId: MISSION_ID, missionId: MISSION_ID, parentTaskId: null,
    category: 'mission', depth: 0,
    objective: 'Give the cooking time in minutes for a soft-boiled egg.',
    acceptanceCriteria: [{ criterionId: 'm-1', statement: 'A cooking time in minutes is given.' }],
    boundaries: { outOfScope: ['Other dishes.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: {
      doneWhen: ['m-1 met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2,
    },
    budget: { floor: 1, ceiling: 20, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier', 'different_agent'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

/** `answer` per attempt, so a retry can come back clean. */
function seams(answers: string[], objective?: string): MissionSeams {
  let attempt = 0;
  return {
    planner: {
      async propose() {
        return {
          subtasks: [{
            objective: objective ?? 'Give the cooking time in minutes.',
            category: 'answering',
            acceptanceCriteria: [{ criterionId: 'm-1', statement: 'A cooking time in minutes is given.' }],
            outOfScope: ['Other dishes.'],
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
    planJudge: {
      async audit({ children }: { children: readonly { taskId: string }[] }) {
        return { tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'ok' })), untestable: [], overlaps: [] };
      },
    },
    registry: { async bestForCategory() { return null; } },
    author: { async design() { return { roleInstructions: 'Answer.', capabilities: ['text'] }; } },
    clarityJudge: {
      async assess() { return { restatement: 'Give the cooking time.', ambiguities: [] }; },
    },
    work: {
      async execute() {
        const answer = answers[Math.min(attempt, answers.length - 1)]!;
        attempt += 1;
        return {
          deliverable: { answer },
          actions: [], consulted: [], assumptions: [], effortSpent: 5,
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

const types = (trail: readonly { type: string }[]) => trail.map((e) => e.type);

describe('defect 08db92fd — a JSON fragment in the answer is refused, not delivered', () => {
  it('refuses the fragment shape recorded on mission 0f95dc3c', async () => {
    const result = await runMission(mission(), seams([FRAGMENT_LEAK]), { now: () => AT });

    expect(types(result.trail)).toContain('task.malformed_deliverable');
  });

  it('never lets a corrupt deliverable reach Gate B — the reviewer would judge garbage', async () => {
    // The whole point. The reviewer reads the deliverable as prose and may well
    // find the criterion met, recording a pass on work that is unreadable.
    const result = await runMission(mission(), seams([FRAGMENT_LEAK]), { now: () => AT });

    expect(result.trail.filter((e) => e.type === 'gate_b.verdict_issued')).toHaveLength(0);
  });

  it('records WHAT was wrong, so the operator is not left guessing', async () => {
    const result = await runMission(mission(), seams([FRAGMENT_LEAK]), { now: () => AT });

    const event = result.trail.find((e) => e.type === 'task.malformed_deliverable');
    expect(String(event?.payload['detail'])).toMatch(/json/i);
  });

  it('refuses the whole-document shape too', async () => {
    const result = await runMission(mission(), seams([DOCUMENT_LEAK]), { now: () => AT });

    expect(types(result.trail)).toContain('task.malformed_deliverable');
  });

  it('DISTRACTOR: a clean retry IS accepted — corruption costs a rung, not the task', async () => {
    // Measured at ~3% of executions, so the overwhelmingly likely outcome of a
    // retry is a good answer. Failing the task outright would throw away 97%.
    const result = await runMission(mission(), seams([FRAGMENT_LEAK, '7 minutes.']), { now: () => AT });

    expect(result.outcome).toBe('delivered');
    expect(result.trail.filter((e) => e.type === 'task.malformed_deliverable')).toHaveLength(1);
    expect(result.trail.filter((e) => e.type === 'gate_b.verdict_issued')).toHaveLength(1);
  });

  it('DISTRACTOR: ordinary prose containing a quote and a colon is NOT corruption', async () => {
    // The detector must key on JSON STRUCTURE, not on punctuation. English uses
    // quotes and colons constantly, and a false positive here burns a rung on
    // work that was perfectly good.
    const prose = 'She said "boil it for 7 minutes": the yolk stays soft, the white sets.';
    const result = await runMission(mission(), seams([prose]), { now: () => AT });

    expect(types(result.trail)).not.toContain('task.malformed_deliverable');
    expect(result.outcome).toBe('delivered');
  });

  it('DISTRACTOR: a QUOTED LIST in prose is not corruption — the key and colon are required', async () => {
    // Found by a surviving mutant. Dropping the quoted-key-and-colon half of the
    // pattern, leaving just `", "`, passed every other test — yet that shorter
    // pattern fires on any prose listing quoted items, which is ordinary
    // English and would burn a rung on perfectly good work.
    //
    // What separates corruption from a list is that the model resumed writing
    // JSON: a quoted KEY followed by a colon. Nothing else in the fragment
    // distinguishes them.
    const answer = 'Serve it with "toast", "soldiers", or "jam" — 7 minutes either way.';
    const result = await runMission(mission(), seams([answer]), { now: () => AT });

    expect(types(result.trail)).not.toContain('task.malformed_deliverable');
    expect(result.outcome).toBe('delivered');
  });

  it('DISTRACTOR: a number-like answer is not corruption', async () => {
    // 60 of the 65 ledger answers are short. `"7"` must sail straight through.
    const result = await runMission(mission(), seams(['7']), { now: () => AT });

    expect(types(result.trail)).not.toContain('task.malformed_deliverable');
    expect(result.outcome).toBe('delivered');
  });

  it('DISTRACTOR: prose that merely MENTIONS json is not corruption', async () => {
    const answer = 'Use a json config file to store the timing, then read it at startup.';
    const result = await runMission(mission(), seams([answer]), { now: () => AT });

    expect(types(result.trail)).not.toContain('task.malformed_deliverable');
  });

  /**
   * A limitation, stated rather than hidden.
   *
   * A task whose objective legitimately asks for a JSON document produces an
   * answer the whole-document detector cannot distinguish from the corruption
   * in `DOCUMENT_LEAK` — both are a serialised object in a string field. No
   * inspection of the VALUE can separate them; only intent does, and intent
   * lives in the objective, which this seam deliberately does not parse.
   *
   * This is accepted rather than solved, because the cost is bounded and
   * asymmetric: a wrongly-flagged JSON answer costs one escalation rung and is
   * retried (very likely returning the same thing, then delivering through the
   * ladder), while a missed corruption is a silent wrong answer that reaches
   * the requester as fact. The test asserts the limitation exists so that
   * nobody later reads the detector as exhaustive.
   */
  it('KNOWN LIMITATION: a legitimately-JSON answer is flagged too — recorded, not solved', async () => {
    const legitimate = '{"cookingTimeMinutes": 7}';
    const result = await runMission(
      mission(),
      seams([legitimate, legitimate]),
      { now: () => AT },
    );

    expect(types(result.trail)).toContain('task.malformed_deliverable');
  });
});
