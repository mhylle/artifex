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

    // transientRetries: 0 so this exercises the ESCALATION path specifically.
    // (With the default of 1 the same failure is absorbed by a retry instead —
    // that behaviour is covered by the 626f6596 tests below.)
    const result = await runMission(mission(), flaky, { now: AT, transientRetries: 0 });

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

describe('defect 626f6596 — a TRANSIENT failure is retried before a rung is spent', () => {
  /**
   * The escalation ladder exists for SUBSTANTIVE failure — work that came back
   * wrong. Spending `retry_higher_tier` on a backend hiccup burns a real remedy
   * on a non-problem, and since every leaf needs a model call to survive, that
   * failure probability compounds with fan-out.
   */
  it('retries the same tier once and delivers, spending NO rung', async () => {
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

    const result = await runMission(mission(), flaky, { now: AT, transientRetries: 1 });

    expect(result.outcome).toBe('delivered');
    expect(result.escalations).toHaveLength(0);
    expect(result.trail.map((e) => e.type)).toContain('task.retried');
  });

  it('DISTRACTOR: a PERSISTENT failure still climbs the ladder — retry is not a way to avoid escalating', async () => {
    const broken: MissionSeams = {
      ...seams(),
      work: { async execute() { throw new Error('backend unreachable'); } },
    };

    const result = await runMission(mission(), broken, { now: AT, transientRetries: 1 });

    expect(result.outcome).toBe('surrendered');
    expect(result.escalations.length).toBeGreaterThan(0);
  });

  it('DISTRACTOR: with retries disabled the old behaviour stands — one rung per failure', async () => {
    let calls = 0;
    const flaky: MissionSeams = {
      ...seams(),
      work: {
        async execute(args) {
          calls += 1;
          if (calls === 1) throw new Error('transient');
          return seams().work.execute(args);
        },
      },
    };

    const result = await runMission(mission(), flaky, { now: AT, transientRetries: 0 });

    expect(result.escalations).toHaveLength(1);
  });
});

/**
 * Defect `b3b4e554` (second half) — the trail must stream, not arrive in a burst.
 *
 * `packages/worker/src/index.ts` appended `result.trail` only after `runMission`
 * resolved, so even with the Postgres LISTEN connected the dashboard would sit
 * empty for the whole mission and then jump to the finished state. The dossier
 * promises "typed events, streamed as they happen" and a canvas "executing left
 * to right"; neither survives batch-at-the-end.
 */
describe('b3b4e554 — events are emitted as they happen, not batched at the end', () => {
  it('emits every trail event through onEvent, in trail order', async () => {
    const emitted: string[] = [];

    const result = await runMission(mission(), seams(), {
      now: AT,
      onEvent: (event) => void emitted.push(event.eventId),
    });

    expect(emitted).toEqual(result.trail.map((e) => e.eventId));
  });

  it('DISTRACTOR: the first event is emitted BEFORE the mission resolves', async () => {
    // The whole point. Collecting into an array and flushing at the end would
    // satisfy the ordering test above while leaving the dashboard just as blind.
    let emittedBeforeResolve = 0;
    let resolved = false;

    const pending = runMission(mission(), seams(), {
      now: AT,
      onEvent: () => { if (!resolved) emittedBeforeResolve += 1; },
    });
    await pending;
    resolved = true;

    expect(emittedBeforeResolve).toBeGreaterThan(1);
  });

  it('DISTRACTOR: a throwing subscriber does not take the mission down', async () => {
    // The ledger append can fail transiently; losing the mission because the
    // stream hiccuped would trade a cosmetic problem for a real one.
    const result = await runMission(mission(), seams(), {
      now: AT,
      onEvent: () => { throw new Error('sink exploded'); },
    });

    expect(result.outcome).toBe('delivered');
  });
});

/**
 * Defect `1e3905a4` — a bounce must change the SPECIFICATION, not the tier.
 *
 * The clarity judge bounced the planner's own objectives and every multi-subtask
 * mission surrendered doing zero work. The loop did climb the ladder on a
 * bounce, but it climbed to `retry_higher_tier` — and measurement across the
 * local ladder showed a higher tier is *worse* at this gate, not better:
 *
 *   qwen3.5:2b 33% false-bounce · 4b 25% · 9b 17% · gemma4:12b 58%
 *
 * So the remedy actively increased the chance of bouncing again. The dossier is
 * explicit: "planning and specification faults jump straight to re-decomposition,
 * because retrying a task that was specified wrong just burns budget rehearsing
 * the same mistake" (R36). A bounce says the CONTRACT is unclear — the only
 * thing that can fix it is rewriting the contract.
 */
describe('1e3905a4 — a bounced contract is rewritten, not retried at a bigger model', () => {
  /** Bounces anything still containing the word "vague", accepts the rewrite. */
  const pickyJudge = {
    async assess({ contract }: { contract: { objective: string } }) {
      return contract.objective.includes('vague')
        ? { restatement: 'unclear', ambiguities: ['"vague" is not defined'] }
        : { restatement: contract.objective, ambiguities: [] };
    },
  };

  const vagueSeams = () => ({
    ...seams(),
    planner: {
      async propose() {
        return {
          subtasks: [{
            objective: 'Do the vague thing.',
            category: 'answer',
            acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'The thing is done.' }],
            outOfScope: ['Not the other thing.'],
            blastRadius: 'low' as const,
            effortShare: 0.5,
          }],
        };
      },
    },
    clarityJudge: pickyJudge,
  });

  it('asks the clarifier to rewrite the objective and then succeeds', async () => {
    const result = await runMission(
      mission(),
      {
        ...vagueSeams(),
        clarifier: {
          async clarify({ contract }: { contract: { objective: string } }) {
            return { objective: contract.objective.replace('vague', 'specific'), acceptanceCriteria: null };
          },
        },
      } as unknown as Parameters<typeof runMission>[1],
      { now: AT },
    );

    expect(result.outcome).toBe('delivered');
  });

  it('records the rewrite as a re-decomposition rung, not a tier bump', async () => {
    // The ladder intake actually issues — it carries a re_decomposition rung,
    // which is the whole point: a spec fault has somewhere specific to go.
    const withFullLadder = {
      ...mission(),
      escalationPolicy: {
        ladder: ['retry_higher_tier', 'different_agent', 'agent_redesign', 're_decomposition', 'human_review'],
        humanAt: 'human_review',
      },
    } as ReturnType<typeof mission>;

    const result = await runMission(
      withFullLadder,
      {
        ...vagueSeams(),
        clarifier: {
          async clarify({ contract }: { contract: { objective: string } }) {
            return { objective: contract.objective.replace('vague', 'specific'), acceptanceCriteria: null };
          },
        },
      } as unknown as Parameters<typeof runMission>[1],
      { now: AT },
    );

    const rungs = result.escalations.map((e) => e.rung);
    expect(rungs).toContain('re_decomposition');
    expect(rungs).not.toContain('retry_higher_tier');
  });

  it('DISTRACTOR: a clear contract is never sent to the clarifier', async () => {
    // Without this, "always rewrite" would satisfy the tests above while
    // rewriting objectives that were fine — churning every task through an
    // extra model call and changing work nobody asked to change.
    let clarified = 0;

    await runMission(
      mission(),
      {
        ...seams(),
        clarifier: { async clarify() { clarified += 1; return { objective: 'x', acceptanceCriteria: null }; } },
      } as unknown as Parameters<typeof runMission>[1],
      { now: AT },
    );

    expect(clarified).toBe(0);
  });

  it('DISTRACTOR: with no clarifier seam the mission still surrenders rather than looping forever', async () => {
    // The clarifier is optional; its absence must not hang the loop.
    const result = await runMission(mission(), vagueSeams() as unknown as Parameters<typeof runMission>[1], { now: AT });

    expect(result.outcome).toBe('surrendered');
  });
});

/**
 * Defect `a910ed8d` — decomposition never recursed.
 *
 * `decompose()` was called once, on task zero, and never on a child, so every
 * mission tree Artifex ever produced was exactly one level deep. The dossier
 * specifies recursive splitting "until each leaf carries exactly one
 * responsibility with one verifiable outcome — and no further", and the whole
 * reliability argument (pillar 1) rests on it.
 *
 * The stop condition is taken from that sentence rather than invented: a
 * contract carrying a SINGLE acceptance criterion already has one verifiable
 * outcome, so it is a leaf. Termination is guaranteed because a split must
 * partition criteria, and one criterion cannot be partitioned further.
 */
describe('a910ed8d — decomposition recurses until leaves are atomic', () => {
  /** Splits a multi-criterion task into one child per criterion. */
  const splittingPlanner = {
    async propose({ contract }: { contract: TaskContract }) {
      return {
        subtasks: contract.acceptanceCriteria.map((criterion, index) => ({
          objective: `${contract.objective} / part ${index + 1}`,
          category: 'answer',
          acceptanceCriteria: [{ criterionId: criterion.criterionId, statement: criterion.statement }],
          outOfScope: ['Not the sibling parts.'],
          blastRadius: 'low' as const,
          effortShare: 1 / contract.acceptanceCriteria.length,
        })),
      };
    },
  };

  /** A mission whose two criteria can each be split once more. */
  const deepMission = (): TaskContract => ({
    ...mission(),
    acceptanceCriteria: [
      { criterionId: 'ac-1', statement: 'Part one is answered.' },
      { criterionId: 'ac-2', statement: 'Part two is answered.' },
    ],
  });

  const contractedIds = (trail: readonly { type: string; taskId: string | null; payload: Record<string, unknown> }[]) =>
    trail.filter((e) => e.type === 'task.contracted');

  it('produces a tree deeper than one level', async () => {
    const grandparentSplitter = {
      async propose({ contract }: { contract: TaskContract }) {
        // Every task splits into two, each keeping BOTH criteria until depth 2,
        // so there is genuinely something below the first level.
        const keepBoth = contract.depth < 1;
        return {
          subtasks: [0, 1].map((i) => ({
            objective: `${contract.objective} / branch ${i + 1}`,
            category: 'answer',
            acceptanceCriteria: keepBoth
              ? contract.acceptanceCriteria.map((c) => ({ ...c }))
              : [{ criterionId: `ac-${i + 1}`, statement: `Branch ${i + 1} is answered.` }],
            outOfScope: ['Not the sibling branch.'],
            blastRadius: 'low' as const,
            effortShare: 0.5,
          })),
        };
      },
    };

    const result = await runMission(
      deepMission(),
      { ...seams(), planner: grandparentSplitter } as unknown as Parameters<typeof runMission>[1],
      { now: AT },
    );

    const contracted = contractedIds(result.trail);
    const depths = new Set(contracted.map((e) => String(e.payload['parentTaskId'])));
    // More than one distinct parent means at least one task was itself split.
    expect(depths.size).toBeGreaterThan(1);
  });

  it('DISTRACTOR: a task with a single acceptance criterion is NOT split further', async () => {
    // "One responsibility, one verifiable outcome" is the definition of a leaf.
    // Splitting it again would fabricate structure the contract does not have.
    const result = await runMission(
      { ...mission(), acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'The only thing.' }] },
      { ...seams(), planner: splittingPlanner } as unknown as Parameters<typeof runMission>[1],
      { now: AT },
    );

    const contracted = contractedIds(result.trail);
    // One split of the mission, and nothing below it.
    const parents = new Set(contracted.map((e) => String(e.payload['parentTaskId'])));
    expect(parents.size).toBe(1);
  });

  it('DISTRACTOR: recursion terminates even when the planner always wants to split', async () => {
    // A planner that keeps returning multi-criterion children must not recurse
    // forever; the bound comes from the mission's own criteria count.
    const insatiable = {
      async propose({ contract }: { contract: TaskContract }) {
        return {
          subtasks: [0, 1].map((i) => ({
            objective: `${contract.objective} / more ${i + 1}`,
            category: 'answer',
            // Always two criteria — never atomic by the criteria rule alone.
            acceptanceCriteria: [
              { criterionId: 'ac-1', statement: 'One.' },
              { criterionId: 'ac-2', statement: 'Two.' },
            ],
            outOfScope: ['Not the sibling.'],
            blastRadius: 'low' as const,
            effortShare: 0.5,
          })),
        };
      },
    };

    const result = await runMission(
      deepMission(),
      { ...seams(), planner: insatiable } as unknown as Parameters<typeof runMission>[1],
      { now: AT },
    );

    expect(['delivered', 'surrendered']).toContain(result.outcome);
    expect(result.trail.length).toBeLessThan(500);
  });

  it('records each task under its real parent, so the canvas can draw the tree', async () => {
    const result = await runMission(
      deepMission(),
      { ...seams(), planner: splittingPlanner } as unknown as Parameters<typeof runMission>[1],
      { now: AT },
    );

    for (const event of contractedIds(result.trail)) {
      expect(typeof event.payload['parentTaskId']).toBe('string');
    }
  });
});

/**
 * Defect `f46ba357` — the trail must carry what the inspector reads.
 *
 * The ledger recorded which criteria FAILED (a verdict's findings) but never
 * the criteria themselves, nor effort spent, nor the agent's version. So
 * "3 of 4 criteria met" was underivable — you cannot divide by a denominator
 * you never wrote down — and per-clause compliance, cost-per-verified-outcome
 * and replay benchmarks were all quietly built on sand.
 */
describe('f46ba357 — the ledger records the criteria, the effort and the agent version', () => {
  const eventsOfType = (trail: readonly { type: string; payload: Record<string, unknown> }[], type: string) =>
    trail.filter((e) => e.type === type);

  it('task.contracted carries the acceptance criteria the task will be graded on', async () => {
    const result = await runMission(mission(), seams(), { now: AT });

    const contracted = eventsOfType(result.trail, 'task.contracted');
    expect(contracted.length).toBeGreaterThan(0);
    for (const event of contracted) {
      const criteria = event.payload['acceptanceCriteria'];
      expect(Array.isArray(criteria)).toBe(true);
      expect((criteria as unknown[]).length).toBeGreaterThan(0);
      expect(criteria as Array<{ criterionId: string; statement: string }>).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ criterionId: expect.any(String), statement: expect.any(String) }),
        ]),
      );
    }
  });

  it('task.executed carries the effort actually spent, not just a bundle id', async () => {
    const result = await runMission(mission(), seams(), { now: AT });

    const executed = eventsOfType(result.trail, 'task.executed');
    expect(executed.length).toBeGreaterThan(0);
    for (const event of executed) {
      expect(typeof event.payload['effortSpent']).toBe('number');
    }
  });

  it('agent.staffed carries the design VERSION, so a clade score can attribute performance', async () => {
    const result = await runMission(mission(), seams(), { now: AT });

    const staffed = eventsOfType(result.trail, 'agent.staffed');
    expect(staffed.length).toBeGreaterThan(0);
    for (const event of staffed) {
      expect(typeof event.payload['version']).toBe('number');
    }
  });

  it('DISTRACTOR: the recorded criteria are the CONTRACT\'s, not a summary invented at record time', async () => {
    // If the ledger paraphrased, replay would grade against different words than
    // the reviewer used — and per-clause compliance would compare two things.
    const distinctive = 'The answer names a COP figure with a date.';
    const custom = {
      ...seams(),
      planner: {
        async propose() {
          return {
            subtasks: [{
              objective: 'Answer the thing.',
              category: 'answer',
              acceptanceCriteria: [{ criterionId: 'ac-1', statement: distinctive }],
              outOfScope: ['Not the other thing.'],
              blastRadius: 'low' as const,
              effortShare: 0.5,
            }],
          };
        },
      },
    };

    const result = await runMission(mission(), custom as unknown as Parameters<typeof runMission>[1], { now: AT });

    const contracted = eventsOfType(result.trail, 'task.contracted');
    const statements = contracted.flatMap((e) =>
      (e.payload['acceptanceCriteria'] as Array<{ statement: string }>).map((c) => c.statement),
    );
    expect(statements).toContain(distinctive);
  });
});

/**
 * R17 — the cockpit acts, and the runtime honours it.
 *
 * "Mission control is a cockpit, not a window." The operator's half (routes, UI)
 * is worthless if the runtime ignores it, so these tests are about the runtime
 * side: a pause must actually stop the next attempt, a cancel must actually end
 * the task, and both must be GRACEFUL — checked at an attempt boundary so work
 * already in flight finishes rather than being severed.
 */
describe('R17 — the runtime honours operator control signals', () => {
  /** Returns a scripted sequence of control states, one per check. */
  const controlThatSays = (...states: Array<'run' | 'paused' | 'cancelled'>) => {
    const seen: string[] = [];
    let index = 0;
    return {
      seen,
      control: {
        async check(taskId: string) {
          seen.push(taskId);
          const state = states[Math.min(index, states.length - 1)] ?? 'run';
          index += 1;
          return state;
        },
      },
    };
  };

  it('AC-0: a cancelled task stops and the cancellation is recorded', async () => {
    const { control } = controlThatSays('cancelled');

    const result = await runMission(
      mission(),
      { ...seams(), control } as unknown as Parameters<typeof runMission>[1],
      { now: AT },
    );

    expect(result.trail.some((e) => e.type === 'task.cancelled')).toBe(true);
  });

  it('AC-1 DISTRACTOR: the control signal is checked BEFORE an attempt, never mid-attempt', async () => {
    // Graceful means the boundary is the attempt, not the instruction. A check
    // that happened inside execution could sever work already in flight.
    let executing = false;
    let checkedWhileExecuting = false;

    const control = {
      async check() {
        if (executing) checkedWhileExecuting = true;
        return 'run' as const;
      },
    };
    const watched = {
      ...seams(),
      control,
      work: {
        async execute({ contract }: { contract: { objective: string } }) {
          executing = true;
          await new Promise((r) => setTimeout(r, 1));
          executing = false;
          return { deliverable: { answer: `done: ${contract.objective}` }, actions: [], consulted: [], assumptions: [], effortSpent: 1 };
        },
      },
    };

    await runMission(mission(), watched as unknown as Parameters<typeof runMission>[1], { now: AT });

    expect(checkedWhileExecuting).toBe(false);
  });

  it('AC-0 DISTRACTOR: with no control seam the loop behaves exactly as before', async () => {
    // The seam is optional; its absence must not change mission outcomes, or
    // every existing deployment would silently alter behaviour.
    const result = await runMission(mission(), seams(), { now: AT });

    expect(result.outcome).toBe('delivered');
    expect(result.trail.some((e) => e.type === 'task.cancelled')).toBe(false);
  });

  it('DISTRACTOR: cancelling ONE task does not surrender the whole mission', async () => {
    // The point of cancellation is that the operator removes a task, not that
    // the mission dies. Without this the `cancelled` flag could be a no-op — the
    // break alone would end the loop and surrender, recording the event while
    // meaning nothing. (Found by mutation: setting cancelled=false changed no
    // test until this one existed.)
    let checks = 0;
    const control = {
      async check() {
        checks += 1;
        // Cancel the first child only; the second runs normally.
        return checks === 1 ? ('cancelled' as const) : ('run' as const);
      },
    };

    const result = await runMission(
      mission(),
      { ...seams(), control } as unknown as Parameters<typeof runMission>[1],
      { now: AT },
    );

    expect(result.outcome).toBe('delivered');
    expect(result.trail.some((e) => e.type === 'task.cancelled')).toBe(true);
  });

  it('DISTRACTOR: a cancelled task does NOT get executed or verified', async () => {
    // Recording a cancellation while still doing the work would be theatre.
    const { control } = controlThatSays('cancelled');
    let executed = 0;
    const counting = {
      ...seams(),
      control,
      work: {
        async execute() {
          executed += 1;
          return { deliverable: { answer: 'x' }, actions: [], consulted: [], assumptions: [], effortSpent: 1 };
        },
      },
    };

    await runMission(mission(), counting as unknown as Parameters<typeof runMission>[1], { now: AT });

    expect(executed).toBe(0);
  });
});

/**
 * Defect `9fbee9d6` — the budget ceiling was recorded and never enforced.
 *
 * Invariant #7 and pillar 6 say effort is a currency; `lifecycle.html` says
 * budgets "bind in both directions — a floor that prevents drive-by shallow
 * work, a ceiling that prevents runaway effort". `grep budget.ceiling` returned
 * only writes: the field was carried, divided on decomposition, written to the
 * ledger, and never once consulted.
 *
 * The effective ceiling is the contract's plus whatever the operator has
 * granted, read from the trail — so R17's budget top-up has something real to
 * raise, and the limit stays a derived figure like everything else.
 */
describe('9fbee9d6 — the budget ceiling actually stops a task', () => {
  /** Every attempt costs `cost`, so spend crosses any ceiling predictably. */
  const expensiveSeams = (cost: number, granted = 0) => ({
    ...seams({ gateBFailuresPerTask: { 0: 99, 1: 99 } }),
    work: {
      async execute() {
        return { deliverable: { answer: 'x' }, actions: [], consulted: [], assumptions: [], effortSpent: cost };
      },
    },
    control: {
      async check() { return 'run' as const; },
      async grantedBudget() { return granted; },
    },
  });

  const tightBudget = (): TaskContract => ({
    ...mission(),
    budget: { floor: 0, ceiling: 2, unit: 'effort-units' },
  });

  it('refuses a further attempt once spend reaches the ceiling', async () => {
    // Each attempt costs 1 against a child ceiling of 2*0.4 = 0.8, so the first
    // attempt already exhausts it and a second must not start.
    const result = await runMission(
      tightBudget(),
      expensiveSeams(1) as unknown as Parameters<typeof runMission>[1],
      { now: AT },
    );

    expect(result.trail.some((e) => e.type === 'task.budget_exhausted')).toBe(true);
  });

  it('DISTRACTOR: a task within its ceiling is never stopped for budget', async () => {
    // Without this, "always refuse" would satisfy the test above and halt every
    // mission in the system.
    const result = await runMission(mission(), seams(), { now: AT });

    expect(result.outcome).toBe('delivered');
    expect(result.trail.some((e) => e.type === 'task.budget_exhausted')).toBe(false);
  });

  it('AC-2 DISTRACTOR: an operator grant RAISES the ceiling, so the task continues', async () => {
    // This is what makes R17's top-up mean something. Same spend, same contract
    // — only the grant differs, and the outcome must differ with it.
    const withoutGrant = await runMission(
      tightBudget(),
      expensiveSeams(1, 0) as unknown as Parameters<typeof runMission>[1],
      { now: AT },
    );
    const withGrant = await runMission(
      tightBudget(),
      expensiveSeams(1, 50) as unknown as Parameters<typeof runMission>[1],
      { now: AT },
    );

    expect(withoutGrant.trail.some((e) => e.type === 'task.budget_exhausted')).toBe(true);
    expect(withGrant.trail.some((e) => e.type === 'task.budget_exhausted')).toBe(false);
  });

  it('records what was spent against what was allowed, so the stop is auditable', async () => {
    const result = await runMission(
      tightBudget(),
      expensiveSeams(1) as unknown as Parameters<typeof runMission>[1],
      { now: AT },
    );

    const event = result.trail.find((e) => e.type === 'task.budget_exhausted');
    expect(typeof event?.payload['spent']).toBe('number');
    expect(typeof event?.payload['ceiling']).toBe('number');
  });

  it('DISTRACTOR: with no control seam the contract ceiling still binds', async () => {
    // Enforcement must not depend on an optional seam being present, or budgets
    // would silently stop binding wherever the cockpit is not wired.
    const noControl = {
      ...seams({ gateBFailuresPerTask: { 0: 99, 1: 99 } }),
      work: {
        async execute() {
          return { deliverable: { answer: 'x' }, actions: [], consulted: [], assumptions: [], effortSpent: 1 };
        },
      },
    };

    const result = await runMission(
      tightBudget(),
      noControl as unknown as Parameters<typeof runMission>[1],
      { now: AT },
    );

    expect(result.trail.some((e) => e.type === 'task.budget_exhausted')).toBe(true);
  });
});
