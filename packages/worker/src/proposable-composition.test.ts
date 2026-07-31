/**
 * The composition. `proposableCapabilities` is a pure function, and its own
 * tests cannot see whether anything calls it — the shape that has produced five
 * dead mechanisms in this repo.
 *
 * Two consumers read the registry's capability list, and BOTH have to filter or
 * the fix is half-applied: `staff()` resolves a proposed category against it,
 * and the mission loop hands it to the planner as naming guidance. Each is
 * asserted against a registry that returns exactly the shape the live one does —
 * the mission role first, because that is where the observation ordering puts
 * it, followed by a verification capability.
 */
import { describe, expect, it } from 'vitest';

import type { TaskContract } from '@artifex/shared-types';
import { staff } from './agent-creator.js';

const AT = '2026-07-31T09:00:00.000Z';

function contract(category: string): TaskContract {
  return {
    taskId: 'aaaaaaaa-0000-4000-8000-000000000001',
    missionId: 'aaaaaaaa-0000-4000-8000-000000000000',
    parentTaskId: null,
    category, depth: 1,
    objective: 'Define a term.',
    acceptanceCriteria: [{ criterionId: 'c-1', statement: 'It is defined.' }],
    boundaries: { outOfScope: ['Else.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['Done.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

const author = { async design() { return { roleInstructions: 'Do it.', capabilities: ['text'] }; } };

/** The live registry's shape: the mission role first, a verifier in the middle. */
const LIVE_SHAPE = ['mission', 'verification.scientific definitions', 'hand tools overview'];

describe('R38 — staff() resolves against the FILTERED list', () => {
  it('does not staff a producer under a verification capability', async () => {
    // `resolveCapability` returns the first candidate sharing any token, so
    // "scientific definitions" would land on `verification.scientific
    // definitions` — the design that exists to CHECK this work, hired to do it.
    const manifest = await staff({
      contract: contract('scientific definitions'),
      registry: {
        async bestForCategory() { return null; },
        async register() { return { version: 1 }; },
        async knownCapabilities() { return LIVE_SHAPE; },
      } as never,
      author,
    });

    expect(manifest.category).toBe('scientific definitions');
  });

  it('does not staff a producer under the mission role', async () => {
    // The mission role is FIRST in the live ordering, so any proposal sharing a
    // token with it is captured before every real capability is even tried.
    const manifest = await staff({
      contract: contract('mission debrief writing'),
      registry: {
        async bestForCategory() { return null; },
        async register() { return { version: 1 }; },
        async knownCapabilities() { return LIVE_SHAPE; },
      } as never,
      author,
    });

    expect(manifest.category).toBe('mission debrief writing');
  });

  it('DISTRACTOR: a genuine capability in the same list is still reused', async () => {
    // Filtering must not become "resolve against nothing". If it did, this whole
    // change would quietly disable the clustering R38 exists for and every test
    // above would still pass.
    const manifest = await staff({
      contract: contract('Hand Tool Education'),
      registry: {
        async bestForCategory() { return null; },
        async register() { return { version: 1 }; },
        async knownCapabilities() { return LIVE_SHAPE; },
      } as never,
      author,
    });

    expect(manifest.category).toBe('hand tools overview');
  });
});

describe('R38 — the planner is shown the FILTERED list', () => {
  it('never suggests a role the system stamps on contracts itself', async () => {
    // NOTE ON THE FIXTURE: the first version of this test used the calibration
    // fixture unchanged, whose decomposition gate answers `keepWhole: true`. The
    // mission was never split, so the planner was never called and `shown`
    // stayed undefined. The `toBeDefined` guard below caught it — without that
    // guard the `toEqual` would have been asserted against nothing and the test
    // would have looked green while proving nothing. The gate is overridden
    // here; the test was wrong, not the loop.
    const { runMission } = await import('./mission-loop.js');
    const { seams, mission } = await import('./__fixtures__/calibration-fixture.js');

    let shown: readonly string[] | undefined;
    const base = seams({});
    await runMission(mission(), {
      ...base,
      decompositionGate: { async assess() { return { keepWhole: false, rationale: 'split it' }; } },
      registry: {
        ...base.registry,
        async knownCapabilities() { return LIVE_SHAPE; },
      },
      planner: {
        async propose(options: { knownCapabilities?: readonly string[] }) {
          shown = options.knownCapabilities;
          return { subtasks: [] };
        },
      },
    } as never, { now: () => AT });

    expect(shown, 'the planner was handed no list at all — the assertion below would be vacuous').toBeDefined();
    expect(shown).toEqual(['hand tools overview']);
  });
});
