/**
 * R32 — the typed dependency graph and parallel execution.
 *
 * "Dependencies between siblings are declared at creation time, so the tree is
 * really a tree plus a typed dependency graph, and **anything not dependent on
 * anything else is free to run in parallel**."
 *
 * The measured cost of not having this, from the R19 timeline lens on a real
 * mission: sibling waits of 3s / 11s / 19s against runs of 7s / 8s / 7s. Each
 * lane waited for the sum of its predecessors, because `runSubtree` executed
 * siblings strictly in declaration order.
 *
 * Scheduling lives in its own file because it is a distinct concern from the
 * stage-by-stage loop asserted in `mission-loop.test.ts`.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { runMission } from './mission-loop.js';
import type { MissionSeams } from './mission-loop.js';
import type { ProposedSubtask } from './orchestrator.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';

function mission(): TaskContract {
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
    escalationPolicy: { ladder: ['retry_higher_tier', 'different_agent', 'human_review'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

const part = (n: number, over: Partial<ProposedSubtask> = {}): ProposedSubtask => ({
  objective: `Answer part ${n}.`,
  category: 'answer',
  acceptanceCriteria: [{ criterionId: `ac-${n}`, statement: `Part ${n} is answered.` }],
  outOfScope: ['Not the other part.'],
  blastRadius: 'low',
  effortShare: 0.4,
  ...over,
});

interface Script {
  readonly subtasks?: readonly ProposedSubtask[];
  readonly onWork?: (contract: TaskContract) => Promise<void> | void;
  readonly onJudge?: (contract: TaskContract) => void;
  readonly onReconcile?: (objectives: readonly string[]) => void;
  /** Objective substrings whose Gate B must fail. */
  readonly failing?: readonly string[];
}

function seams(script: Script = {}): MissionSeams {
  const subtasks = script.subtasks ?? [part(1), part(2)];
  return {
    planner: { async propose() { return { subtasks }; } },
    coverageJudge: {
      async assess({ parent, children }) {
        return {
          coverage: parent.acceptanceCriteria.map((c) => ({
            criterionId: c.criterionId,
            coveredByTaskIds: children.map((k) => k.taskId),
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
    author: { async design() { return { roleInstructions: 'Answer one part.', capabilities: ['text'] }; } },
    clarityJudge: { async assess() { return { restatement: 'Answer one part.', ambiguities: [] }; } },
    work: {
      async execute({ contract }) {
        await script.onWork?.(contract);
        return { deliverable: { answer: `done: ${contract.objective}` }, actions: [], consulted: [], assumptions: [], effortSpent: 1 };
      },
    },
    completionJudge: {
      async assess({ contract }) {
        script.onJudge?.(contract);
        const fails = (script.failing ?? []).some((f) => contract.objective.includes(f));
        return {
          criteria: contract.acceptanceCriteria.map((c) => ({
            criterionId: c.criterionId, met: !fails, detail: fails ? 'not met' : 'ok',
          })),
          redFlags: [],
        };
      },
    },
    reconciler: {
      async reconcile({ children }) {
        script.onReconcile?.(children.map((c) => c.objective));
        return { deliverable: { summary: `reconciled ${children.length} parts` }, conflicts: [] };
      },
    },
  };
}

/** Resolves once `count` callers have arrived — a deadlock if they never overlap. */
function latch(count: number) {
  let arrived = 0;
  let release!: () => void;
  const open = new Promise<void>((resolve) => { release = resolve; });
  return {
    async arrive(): Promise<void> {
      arrived += 1;
      if (arrived >= count) release();
      await open;
    },
  };
}

/** Fails fast rather than hanging forever when execution turns out sequential. */
function withinTime<T>(work: Promise<T>, ms = 5000): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`still running after ${ms}ms - siblings did not overlap`)), ms);
    }),
  ]);
}

describe('R32 AC-0 — independent siblings run concurrently', () => {
  it('both children are inside `work` at the same moment', async () => {
    // Under sequential execution the first caller waits for a second that
    // cannot arrive until the first returns — the bug expressed as a deadlock.
    const gate = latch(2);

    const result = await withinTime(
      runMission(mission(), seams({ onWork: () => gate.arrive() }), { now: () => AT }),
    );

    expect(result.outcome).toBe('delivered');
  });

  it('both ENTER before either EXITS — the overlap is the whole claim', async () => {
    const order: string[] = [];
    const gate = latch(2);
    const script: Script = {
      async onWork(contract) {
        order.push(`enter:${contract.objective}`);
        await gate.arrive();
        order.push(`exit:${contract.objective}`);
      },
    };

    await withinTime(runMission(mission(), seams(script), { now: () => AT }));

    // Sequential execution can only produce enter,exit,enter,exit.
    expect(order.slice(0, 2).every((entry) => entry.startsWith('enter:'))).toBe(true);
  });
});

describe('R32 AC-1 — a declared edge is waited on, and only Gate B satisfies it', () => {
  const dependent: readonly ProposedSubtask[] = [part(1), part(2, { consumesIndexes: [0] })];

  it('the consumer starts only after its producer has PASSED Gate B', async () => {
    const order: string[] = [];
    const script: Script = {
      subtasks: dependent,
      onWork: (c) => void order.push(`work:${c.objective}`),
      onJudge: (c) => void order.push(`gateB:${c.objective}`),
    };

    const result = await withinTime(runMission(mission(), seams(script), { now: () => AT }));
    expect(result.outcome).toBe('delivered');

    // Not merely "after the producer finished executing" — after it was
    // VERIFIED. Starting on an unverified input is starting on work that the
    // reviewer may yet withdraw.
    expect(order.indexOf('work:Answer part 2.')).toBeGreaterThan(order.indexOf('gateB:Answer part 1.'));
  });

  it('DISTRACTOR: the consumer never starts when its producer fails Gate B', async () => {
    const started: string[] = [];
    const script: Script = {
      subtasks: dependent,
      onWork: (c) => void started.push(c.objective),
      failing: ['part 1'],
    };

    const result = await withinTime(runMission(mission(), seams(script), { now: () => AT }));

    expect(result.outcome).toBe('surrendered');
    expect(started, 'building on an input the reviewer rejected').not.toContain('Answer part 2.');
  });

  it('DISTRACTOR: the edge is a real wait, not declaration order — a LATER sibling can be the producer', async () => {
    // part 1 consumes part 2. An implementation that merely runs in array order
    // and calls it dependency-respecting would pass the previous test and fail
    // this one.
    const order: string[] = [];
    const script: Script = {
      subtasks: [part(1, { consumesIndexes: [1] }), part(2)],
      onWork: (c) => void order.push(`work:${c.objective}`),
      onJudge: (c) => void order.push(`gateB:${c.objective}`),
    };

    const result = await withinTime(runMission(mission(), seams(script), { now: () => AT }));
    expect(result.outcome).toBe('delivered');

    expect(order.indexOf('work:Answer part 1.')).toBeGreaterThan(order.indexOf('gateB:Answer part 2.'));
  });
});

describe('R32 — parallelism must not lose work', () => {
  it('DISTRACTOR: a sibling verified before another failed is still recorded as verified', async () => {
    // A failure surrenders the mission, but the trail must show what was
    // verified before it did — otherwise resume (R41) would redo work the
    // ledger already paid for.
    const result = await withinTime(
      runMission(mission(), seams({ failing: ['part 2'] }), { now: () => AT }),
    );

    expect(result.outcome).toBe('surrendered');
    const passed = result.trail.filter(
      (e) => e.type === 'gate_b.verdict_issued' && (e.payload as { outcome?: string }).outcome === 'pass',
    );
    expect(passed).toHaveLength(1);
  });
});

describe('R32 — parallel execution stays deterministic', () => {
  it('DISTRACTOR: fold-up receives siblings in DECLARATION order, not completion order', async () => {
    // Parallelism makes completion order a race. If fold-up saw whichever
    // sibling happened to finish first, the same mission could assemble
    // differently on a re-run — and replay (R41) would stop being faithful.
    let folded: readonly string[] = [];
    const script: Script = {
      // Part 1 is deliberately the slower of the two, so completion order is
      // the REVERSE of declaration order.
      async onWork(contract) {
        if (contract.objective.includes('part 1')) {
          await new Promise((resolve) => { setTimeout(resolve, 40); });
        }
      },
      onReconcile: (objectives) => { folded = objectives; },
    };

    await withinTime(runMission(mission(), seams(script), { now: () => AT }));

    expect(folded).toEqual(['Answer part 1.', 'Answer part 2.']);
  });
});

/**
 * R38 AC-2 — effort scaling, asserted where it is HONOURED.
 *
 * `concurrencyFor` is unit-tested in `design-playbook.test.ts`. This is the
 * other half: that the scheduler actually narrows its wave to it. A correct
 * calculation the scheduler ignores is the "value written that nothing reads"
 * shape this project has shipped six times.
 */
describe('R38 AC-2 — the scheduler runs no more at once than the budget carries', () => {
  it('a HIGH-blast-radius wave is throttled — not everything ready starts', async () => {
    // Two high-risk children: the risk bound allows a quarter of the wave at
    // once, so one. If the scheduler ignored `concurrencyFor` both would enter
    // `work` together and `peak` would be 2.
    //
    // Risk rather than budget, because the budget bound cannot bite here by
    // construction: `authorContracts` caps a child's floor at its own ceiling,
    // which is `effortShare` of the parent's — so with shares that sum to 1 the
    // parent can always afford at least two concurrently. The budget half is
    // unit-tested in `design-playbook.test.ts`; this asserts the scheduler
    // honours whatever bound it is given.
    let live = 0;
    let peak = 0;
    const script: Script = {
      subtasks: [part(1, { blastRadius: 'high' }), part(2, { blastRadius: 'high' })],
      async onWork() {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((resolve) => { setTimeout(resolve, 15); });
        live -= 1;
      },
    };

    const result = await withinTime(runMission(mission(), seams(script), { now: () => AT }));

    expect(result.outcome).toBe('delivered');
    expect(peak, 'a high-risk wave runs one at a time').toBe(1);
  });

  it('DISTRACTOR: a generous budget still runs them together — throttling is not the default', async () => {
    // Without this, "always run one at a time" would pass the test above while
    // undoing R32 entirely.
    let live = 0;
    let peak = 0;
    const script: Script = {
      subtasks: [part(1), part(2)],
      async onWork() {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((resolve) => { setTimeout(resolve, 15); });
        live -= 1;
      },
    };

    await withinTime(runMission(mission(), seams(script), { now: () => AT }));

    expect(peak).toBe(2);
  });
});
