/**
 * R38 AC-1 — the reuse market. "Reuse first, creation second."
 *
 * R6 built the no-bid path but never the market it is supposed to be the
 * *exception* to. Reading the code rather than the roadmap found the reuse path
 * broken at three independent points, any one of which alone would have been
 * enough to make reuse impossible:
 *
 *   1. `designIdFor` derived the id from `contract.taskId`, so every task minted
 *      a different design id even within one category — while its own comment
 *      claimed it derived from the category.
 *   2. A newly authored design was never persisted, so nothing could ever bid.
 *   3. No outcome was ever recorded, so `bestForCategory`'s evidence bar
 *      (`observations >= 3`) could never be met.
 *
 * These tests pin all three, because fixing any two of them still leaves a
 * system that always authors a fresh agent.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { designIdFor, staff } from './agent-creator.js';
import type { RegisteredDesign, RegistryLookup } from './agent-creator.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';

function contract(over: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39',
    missionId: MISSION_ID, parentTaskId: MISSION_ID,
    category: 'research.sub-question', depth: 1,
    objective: 'Answer one sub-question.',
    acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'It is answered.' }],
    boundaries: { outOfScope: ['Not the others.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['ac-1 met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
    ...over,
  };
}

/** A registry that records what staffing asks of it. */
function registryOf(bid: RegisteredDesign | null = null) {
  const registered: Array<{ designId: string; category: string }> = [];
  const asked: string[] = [];
  const lookup: RegistryLookup = {
    async bestForCategory(category) { asked.push(category); return bid; },
    async register(input) { registered.push({ designId: input.designId, category: input.category }); },
  };
  return { lookup, registered, asked };
}

const author = { async design() { return { roleInstructions: 'Answer it.', capabilities: ['text'] }; } };

const proven = (over: Partial<RegisteredDesign> = {}): RegisteredDesign => ({
  designId: 'dddddddd-eeee-4fff-8aaa-000000000001',
  category: 'research.sub-question',
  version: 4,
  roleInstructions: 'Proven instructions.',
  capabilities: ['text', 'citation'],
  cladeScore: 0.8,
  observations: 5,
  active: true,
  ...over,
});

describe('R38 AC-1 — a design id belongs to a CATEGORY, not to one task', () => {
  it('two different tasks in the same category resolve to the SAME design id', () => {
    // This is the property that makes reuse possible at all. Task-derived ids
    // gave every task its own row, so the registry could accumulate a hundred
    // one-observation designs and never reach the evidence bar for any of them.
    const a = designIdFor(contract({ taskId: 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39' }));
    const b = designIdFor(contract({ taskId: 'f1b7042d-1234-4c8e-9a3b-5e6d7c8b9a01' }));

    expect(a).toBe(b);
  });

  it('DISTRACTOR: different categories still resolve to DIFFERENT design ids', () => {
    // Collapsing every category onto one id would "fix" reuse by making one
    // agent do everything — reuse of the wrong specialist is worse than none.
    const research = designIdFor(contract({ category: 'research.sub-question' }));
    const writing = designIdFor(contract({ category: 'writing.summary' }));

    expect(research).not.toBe(writing);
  });

  it('DISTRACTOR: the id is a valid uuid, so it can key a registry row', () => {
    expect(designIdFor(contract())).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('R38 AC-1 — creation feeds the market it is the exception to', () => {
  it('a newly authored design is REGISTERED, so it can bid next time', async () => {
    const { lookup, registered } = registryOf(null);

    const manifest = await staff({ contract: contract(), registry: lookup, author });

    expect(registered).toHaveLength(1);
    expect(registered[0]?.designId).toBe(manifest.designId);
    // The resolved CAPABILITY, not the planner's phrasing (R38 AC-0). The
    // registry's distinct categories ARE the taxonomy, so storing raw text
    // would make `knownCapabilities` a list of one-off strings that can never
    // cluster. The property this test guards is that creation feeds the market;
    // which exact string it feeds it is the mechanism, and the mechanism moved.
    expect(registered[0]?.category).toBe('research sub question');
  });

  it('a REUSED design is not re-registered — nothing was authored', async () => {
    const { lookup, registered } = registryOf(proven());

    const manifest = await staff({ contract: contract(), registry: lookup, author });

    expect(manifest.designId).toBe(proven().designId);
    expect(registered, 'reuse must not rewrite the incumbent').toEqual([]);
  });

  it('reuse carries the incumbent’s VERSION, not a fresh 1', async () => {
    // The version is what a clade score is keyed to. Resetting it would detach
    // the track record from the thing that earned it.
    const { lookup } = registryOf(proven({ version: 7 }));

    expect((await staff({ contract: contract(), registry: lookup, author })).version).toBe(7);
  });

  it('DISTRACTOR: the market is consulted BEFORE anything is authored', async () => {
    // "Reuse first, creation second" as an ordering, not a preference: an
    // implementation that authored first and then checked would pay for a
    // design it discards.
    let authored = false;
    const asked: string[] = [];
    const lookup: RegistryLookup = {
      async bestForCategory(category) {
        expect(authored, 'the registry must be asked before a design is authored').toBe(false);
        asked.push(category);
        return null;
      },
      async register() { /* noop */ },
    };

    await staff({
      contract: contract(),
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
      registry: lookup,
      author: { async design() { authored = true; return { roleInstructions: 'x', capabilities: ['text'] }; } },
    });

    // The property is the ORDERING — the market is consulted before anything is
    // authored, asserted by the expectation inside `bestForCategory` above.
    // The exact string asked for is the mechanism, and it is now the resolved
    // capability rather than the planner's raw category.
    expect(asked).toHaveLength(1);
    expect(authored).toBe(true);
  });

  it('bids on the RESOLVED CAPABILITY, because that is what registration stores', async () => {
    // Found by a surviving mutant. Registration writes the capability, so a bid
    // placed on the planner's raw phrasing can never match anything the registry
    // holds — reuse would silently revert to always-author while every other
    // test stayed green.
    const asked: string[] = [];
    const lookup: RegistryLookup = {
      async bestForCategory(category) { asked.push(category); return null; },
      async register() { /* noop */ },
      async knownCapabilities() { return ['research sub question']; },
    };

    await staff({ contract: contract(), registry: lookup, author });

    expect(asked).toEqual(['research sub question']);
  });

  it('DISTRACTOR: a registry that cannot register does not break staffing', async () => {
    // The registry is a cost lever, not a dependency. A fabric outage must
    // degrade the swarm to "always author", never stop it working.
    const lookup: RegistryLookup = {
      async bestForCategory() { return null; },
      async register() { throw new Error('fabric unavailable'); },
    };

    const manifest = await staff({ contract: contract(), registry: lookup, author });

    expect(manifest.designId).toBe(designIdFor(contract()));
  });
});

/**
 * The other half: a track record only exists if outcomes are recorded.
 *
 * `bestForCategory` requires `observations >= 3`. With nothing recording them,
 * wiring the read path alone would have returned `null` forever — which is why
 * both halves had to land together rather than one being shipped as progress.
 */
describe('R38 AC-1 — Gate B feeds the track record', () => {
  it('records a PASS as a win and a FAIL as a loss, against the staffed design', async () => {
    const { runMission } = await import('./mission-loop.js');
    const outcomes: Array<{ designId: string; score: number; effort?: number }> = [];

    const lookup: RegistryLookup = {
      async bestForCategory() { return null; },
      async register() { /* noop */ },
      async recordOutcome(designId, score, effort) { outcomes.push({ designId, score, effort }); },
    };

    const mission: TaskContract = contract({
      taskId: MISSION_ID, parentTaskId: null, category: 'mission', depth: 0,
      objective: 'One part.',
      acceptanceCriteria: [{ criterionId: 'm-1', statement: 'It is answered.' }],
      budget: { floor: 1, ceiling: 20, unit: 'effort-units' },
      escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    });

    let judged = 0;
    const result = await runMission(mission, {
      planner: {
        async propose() {
          return {
            subtasks: [{
              objective: 'Answer the part.', category: 'research.sub-question',
              acceptanceCriteria: [{ criterionId: 'm-1', statement: 'It is answered.' }],
              outOfScope: ['Not the rest.'], blastRadius: 'low' as const, effortShare: 0.8,
            }],
          };
        },
      },
      coverageJudge: {
        async assess({ parent, children }) {
          return { coverage: parent.acceptanceCriteria.map((c) => ({ criterionId: c.criterionId, coveredByTaskIds: children.map((k) => k.taskId) })) };
        },
      },
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
      registry: lookup,
      author: { async design() { return { roleInstructions: 'Answer.', capabilities: ['text'] }; } },
      clarityJudge: { async assess() { return { restatement: 'Answer.', ambiguities: [] }; } },
      work: { async execute() { return { deliverable: { answer: 'ok' }, actions: [], consulted: [], assumptions: [], effortSpent: 1 }; } },
      completionJudge: {
        async assess({ contract: c }) {
          judged += 1;
          const fails = judged === 1; // fail once, then pass on the retry
          return {
            criteria: c.acceptanceCriteria.map((x) => ({ criterionId: x.criterionId, met: !fails, detail: 'x' })),
            redFlags: [],
          };
        },
      },
      reconciler: { async reconcile({ children }) { return { deliverable: { n: children.length }, conflicts: [] }; } },
    }, { now: () => AT });

    expect(result.outcome).toBe('delivered');
    // One loss then one win, both against the same category-derived design.
    expect(outcomes.map((o) => o.score)).toEqual([0, 1]);
    expect(new Set(outcomes.map((o) => o.designId)).size).toBe(1);
    // The COST axis (R28 AC-1) comes from the effort each attempt spent. Without
    // it `mean_effort` is never written and the Pareto front stays empty.
    expect(outcomes.map((o) => o.effort)).toEqual([1, 1]);
  });
});
