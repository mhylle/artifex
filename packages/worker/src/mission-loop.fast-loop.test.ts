/**
 * R26 in the loop — the half that makes the fast loop exist.
 *
 * `fast-loop.ts` decides, `constitution.ts` bounds, and migration 0008 stores.
 * All three were built, mutation-proven, and called by nothing — logged as
 * defect `188c6892` in the same iteration that created them, because a
 * mechanism with no producer is the shape this project has found nine times and
 * a deferral that is not an unsatisfied requirement is invisible to the gate.
 *
 * This file is the producer's test. It asserts the COMPOSITION: that a mission
 * failing Gate B repeatedly on one criterion really does patch a worker-layer
 * asset, and that the patch really does come back off again with nobody asking.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it, vi } from 'vitest';

import { checkFastLoopReach } from './constitution.js';
import { runMission } from './mission-loop.js';
import type { MissionSeams } from './mission-loop.js';

const AT = '2026-07-31T09:00:00.000Z';
const MISSION_ID = '3b8d5f2a-9c16-4e42-8a7b-2d4f6c9e1b35';

function mission(over: Partial<TaskContract> = {}): TaskContract {
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
    budget: { floor: 1, ceiling: 40, unit: 'effort-units' },
    escalationPolicy: {
      ladder: ['retry_same', 'retry_higher_tier', 'different_agent', 're_decomposition'],
      humanAt: null,
    },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
    ...over,
  };
}

/** Gate B's completion judge, failing or passing every criterion. */
function seams(criteriaMet: boolean): MissionSeams {
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
          criteria: contract.acceptanceCriteria.map((c) => ({
            criterionId: c.criterionId, met: criteriaMet, detail: criteriaMet ? 'ok' : 'not addressed',
          })),
          redFlags: [],
        };
      },
    },
    reconciler: { async reconcile({ children }) { return { deliverable: { n: children.length }, conflicts: [] }; } },
  };
}

/** A fast-loop seam that records everything it is asked to do. */
function recordingFastLoop() {
  const applied: { target: { layer: string; kind: string; assetId: string }; previousValue: string; patchedValue: string; windowObservations: number }[] = [];
  const resolved: { revert: boolean; reason: string }[] = [];

  return {
    applied,
    resolved,
    seam: {
      asset: vi.fn(async (designId: string) => ({ designId, roleInstructions: 'State it.' })),
      apply: vi.fn(async (input: {
        target: { layer: string; kind: string; assetId: string };
        previousValue: string; patchedValue: string; windowObservations: number;
      }) => {
        applied.push(input);
        return `hot-fix-${applied.length}`;
      }),
      resolve: vi.fn(async (input: { revert: boolean; reason: string }) => {
        resolved.push(input);
      }),
    },
  };
}

describe('R26 AC-0 — a repeatedly-failing criterion really does get patched', () => {
  it('applies exactly ONE worker-layer patch', async () => {
    const fast = recordingFastLoop();

    await runMission(mission(), { ...seams(false), fastLoop: fast.seam } as never, { now: () => AT });

    expect(fast.applied, 'the fast loop never fired despite repeated Gate B failures').toHaveLength(1);
    expect(fast.applied[0]!.target.layer).toBe('worker');
  });

  it('the applied target passes the constitutional reach guard', async () => {
    // The composition, not the guard. `checkFastLoopReach` is proven in its own
    // file; what this asserts is that the thing the loop actually hands to the
    // store is a thing that guard would permit — the two agreeing is the point.
    const fast = recordingFastLoop();

    await runMission(mission(), { ...seams(false), fastLoop: fast.seam } as never, { now: () => AT });

    expect(checkFastLoopReach(fast.applied[0]!.target as never).permitted).toBe(true);
  });

  it('carries the value it replaced, so the revert has something to restore', async () => {
    const fast = recordingFastLoop();

    await runMission(mission(), { ...seams(false), fastLoop: fast.seam } as never, { now: () => AT });

    expect(fast.applied[0]!.previousValue).toBe('State it.');
    expect(fast.applied[0]!.patchedValue).not.toBe('State it.');
    expect(fast.applied[0]!.windowObservations).toBeGreaterThan(0);
  });

  it('records the hot-fix on the LEDGER, not only in the store', async () => {
    // Invariant 1: nothing that matters happens off-ledger. A patch visible only
    // in a side table would be a change to how the swarm works that the mission
    // trail does not mention.
    const fast = recordingFastLoop();

    const result = await runMission(
      mission(), { ...seams(false), fastLoop: fast.seam } as never, { now: () => AT },
    );

    const ev = result.trail.find((e) => e.type === 'fast_loop.hot_fix_applied');
    expect(ev, 'the patch happened off-ledger').toBeDefined();
    expect(ev?.payload).toHaveProperty('predictedEffect');
    expect(ev?.payload).toHaveProperty('bounds');
  });

  it('records the PATCH ITSELF, not merely which asset was patched (defect `aa6948ee`)', async () => {
    // Invariant 1 says the ledger is the complete record of what happened. The
    // event named the asset, the criterion, the bounds and the prediction — and
    // not the change. A replay could say the worker's role instructions were
    // patched and could not say what they were patched TO, which is the single
    // most consequential fact about a fast-loop experiment.
    //
    // Found while designing ADR-0017: the science loop has to read `hot_fix` for
    // the patched value because the trail does not carry it.
    const fast = recordingFastLoop();

    const result = await runMission(
      mission(), { ...seams(false), fastLoop: fast.seam } as never, { now: () => AT },
    );

    const ev = result.trail.find((e) => e.type === 'fast_loop.hot_fix_applied');
    expect(ev, 'the patch happened off-ledger').toBeDefined();
    expect(ev?.payload).toHaveProperty('patch');
    const patch = (ev?.payload as { patch?: { previousValue?: unknown; patchedValue?: unknown } }).patch;
    expect(patch?.previousValue, 'the trail cannot say what the instructions WERE').toBeTruthy();
    expect(patch?.patchedValue, 'the trail cannot say what they were patched TO').toBeTruthy();
    expect(patch?.patchedValue).not.toBe(patch?.previousValue);
  });

  it('the recorded patch MATCHES what the store was given — one truth, not two', async () => {
    // The event and the store must agree, or a reader has to choose which to
    // believe. This is the two-sites-keying-on-different-versions shape, and the
    // mutant that records a placeholder instead of the real value dies here.
    const fast = recordingFastLoop();

    const result = await runMission(
      mission(), { ...seams(false), fastLoop: fast.seam } as never, { now: () => AT },
    );

    const applied = fast.applied[0];
    expect(applied, 'nothing was applied, so this asserts nothing').toBeDefined();
    const patch = (result.trail.find((e) => e.type === 'fast_loop.hot_fix_applied')
      ?.payload as { patch?: { previousValue?: unknown; patchedValue?: unknown } }).patch;

    expect(patch?.patchedValue).toBe(applied!.patchedValue);
    expect(patch?.previousValue).toBe(applied!.previousValue);
  });

  it('DISTRACTOR: a mission whose criteria PASS is never patched', async () => {
    // The fast loop is triggered by a failure pattern, not by running. If it
    // fired on healthy work it would be a random-change generator.
    const fast = recordingFastLoop();

    await runMission(mission(), { ...seams(true), fastLoop: fast.seam } as never, { now: () => AT });

    expect(fast.applied).toHaveLength(0);
  });

  it('DISTRACTOR: a mission with NO fast-loop seam runs exactly as before', async () => {
    // Every existing caller predates the fast loop. The seam is optional for the
    // same reason `commons` and `calibration` are — it changes nothing about
    // whether the work is correct — so its absence must be invisible.
    const withSeam = await runMission(
      mission(), { ...seams(false), fastLoop: recordingFastLoop().seam } as never, { now: () => AT },
    );
    const without = await runMission(mission(), seams(false), { now: () => AT });

    expect(without.outcome).toBe(withSeam.outcome);
    expect(without.trail.some((e) => e.type === 'fast_loop.hot_fix_applied')).toBe(false);
  });
});

describe('R26 AC-1 — the revert happens with no human action', () => {
  it('resolves the hot-fix by the time the mission ends', async () => {
    // "Auto-reverted" means the mission does not end with a live experiment
    // still patched into the registry. Nobody is coming to tidy up.
    const fast = recordingFastLoop();

    await runMission(mission(), { ...seams(false), fastLoop: fast.seam } as never, { now: () => AT });

    expect(fast.resolved, 'the mission ended with a hot-fix still applied').toHaveLength(1);
  });

  it('REVERTS when the failure rate did not move', async () => {
    // This fixture fails every criterion on every attempt, so the rate cannot
    // improve — the revert is the only correct outcome, and it is the default.
    const fast = recordingFastLoop();

    await runMission(mission(), { ...seams(false), fastLoop: fast.seam } as never, { now: () => AT });

    expect(fast.resolved[0]!.revert).toBe(true);
    // WHICH path, pinned. AC-1's literal given is "whose measured failure rate
    // does not move", and this fixture must exercise THAT — a filled window
    // whose rate is unchanged — rather than the weaker no-observations default.
    // Live mission 90f2387f took the no-observations path (the patched attempt
    // bounced before reaching Gate B), so the measured-and-flat case needs its
    // evidence here.
    expect(fast.resolved[0]!.reason, 'the window never filled — this proves the wrong clause').toMatch(
      /did not improve/i,
    );
  });

  it('records the revert on the ledger too', async () => {
    const fast = recordingFastLoop();

    const result = await runMission(
      mission(), { ...seams(false), fastLoop: fast.seam } as never, { now: () => AT },
    );

    const ev = result.trail.find((e) => e.type === 'fast_loop.hot_fix_resolved');
    expect(ev, 'the revert happened off-ledger').toBeDefined();
    expect(ev?.payload['outcome']).toBe('reverted');
  });

  it('DISTRACTOR: a failing fast loop never costs the mission its result', async () => {
    // The fast loop is an optimiser, not a gate. If a store write throwing could
    // surrender a mission, an optional bookkeeping seam would have been given
    // authority over verified work — the same reason the commons and the track
    // record both swallow their failures.
    const exploding = {
      asset: async () => ({ designId: 'd', roleInstructions: 'State it.' }),
      apply: async () => { throw new Error('store unavailable'); },
      resolve: async () => { throw new Error('store unavailable'); },
    };

    const withExploding = await runMission(
      mission(), { ...seams(false), fastLoop: exploding } as never, { now: () => AT },
    );
    const clean = await runMission(mission(), seams(false), { now: () => AT });

    expect(withExploding.outcome).toBe(clean.outcome);
  });
});

/**
 * R35 AC-2 in the loop — the verifier is really staffed.
 *
 * `staffVerifier` and `independenceViolation` are proven in their own files.
 * This is the producer's test: that a running mission actually staffs a verifier
 * and that the verdict names its design, because `reviewerId` was the MISSION ID
 * for every verdict in a run — the same value each time, which made "who
 * reviewed this" unanswerable and left the constitutional rule nothing to rule
 * on.
 */
describe('R35 AC-2 — a running mission staffs its verifier', () => {
  it('records verifier.staffed with a design distinct from the producer', async () => {
    const result = await runMission(mission(), seams(true), { now: () => AT });

    const staffed = result.trail.find((e) => e.type === 'verifier.staffed');
    expect(staffed, 'Gate B judged with no staffed verifier').toBeDefined();
    expect(staffed?.payload['designId']).not.toBe(staffed?.payload['producerDesignId']);
  });

  it('the verdict names the VERIFIER design, not the mission', async () => {
    // The whole point. A reviewerId equal to the mission id is the same value on
    // every verdict in the run and identifies nobody.
    const result = await runMission(mission(), seams(true), { now: () => AT });

    const staffed = result.trail.find((e) => e.type === 'verifier.staffed');
    const verdict = result.trail.find((e) => e.type === 'gate_b.verdict_issued');

    expect(verdict?.payload['reviewerId']).toBe(staffed?.payload['designId']);
    expect(verdict?.payload['reviewerId'], 'the reviewer is still the mission').not.toBe(MISSION_ID);
  });

  it('DISTRACTOR: a registry that cannot staff a verifier does NOT block verification', async () => {
    // Independence is a property of the REVIEW. A registry outage must degrade
    // it to the old unattributed reviewer rather than leave work unverified —
    // an unverified mission is a worse outcome than an unattributed verdict, and
    // the trail says which happened.
    // The fixture has to break the VERIFIER's staffing without breaking the
    // producer's. A first version simply threw from `author.design`, which kills
    // the producer first — the mission then never reaches Gate B at all, so the
    // test passed on the wrong path and proved nothing. Fixed at the fixture:
    // this author succeeds once (the producer) and fails after (the verifier),
    // which is also a realistic intermittent-backend failure.
    let designs = 0;
    const broken = {
      ...seams(true),
      author: {
        async design() {
          designs += 1;
          if (designs > 1) throw new Error('author unavailable');
          return { roleInstructions: 'State it.', capabilities: ['text'] };
        },
      },
    };

    const result = await runMission(mission(), broken as never, { now: () => AT });

    expect(result.trail.some((e) => e.type === 'verifier.unstaffed'), 'the failure went unrecorded').toBe(true);
    expect(result.trail.some((e) => e.type === 'gate_b.verdict_issued'), 'work went unverified').toBe(true);
  });
});
