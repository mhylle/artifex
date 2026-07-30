/**
 * Defect `2e5eaece` — the stepwise planner emitted DUPLICATE subtasks.
 *
 * Every child came back carrying the parent's objective verbatim, so a mission
 * that looked decomposed was really the same task run twice: two workers, two
 * Gate B verdicts, two escalations, one piece of work. Visible in Mission
 * Control, where both children read identically.
 *
 * The planner already told the model "ALREADY COVERED (do not repeat)". A 2B
 * model ignores it. That is the lesson: with a small model, a prompt is a
 * request and a schema is a rule — anything that must hold has to be enforced in
 * code, not asked for politely.
 *
 * These tests therefore drive the planner with a model that is deliberately
 * uncooperative, which is the model we actually run at tier 1.
 */
import { describe, expect, it } from 'vitest';

import { createStepwisePlanner } from './planner.js';
import type { StructuredGenerator } from './planner.js';
import type { TaskContract } from '@artifex/shared-types';

const AT = '2026-07-30T09:00:00.000Z';
const PARENT = 'Explain what a heat pump is and how it differs from a gas boiler.';

function contract(): TaskContract {
  return {
    taskId: 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39',
    missionId: '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13',
    parentTaskId: null,
    category: 'mission',
    depth: 0,
    objective: PARENT,
    acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'Explains both, in plain language.' }],
    boundaries: { outOfScope: ['No installation costs.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['ac-1 met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier', 'human_review'], humanAt: 'human_review' },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low',
    autonomyDial: 'checkpointed',
    createdAt: AT,
  };
}

/**
 * A generator scripted by schema `$id`, so these tests do not care how the
 * planner splits its calls — only what it ends up proposing.
 */
function generatorOf(script: {
  count?: number;
  /**
   * What the model offers as its split, one entry per attempt. A planner that
   * re-asks after dropping duplicates consumes the later entries; one that only
   * deduplicates never gets past the first.
   */
  objectives: string[][];
}): { generator: StructuredGenerator; calls: string[] } {
  const calls: string[] = [];
  let attempt = 0;

  const generator: StructuredGenerator = {
    async generate({ probe }) {
      const id = (probe.schema as { $id?: string }).$id ?? '';
      calls.push(id);

      if (id === 'SubtaskCount') return { count: script.count ?? 2 };

      if (id === 'SubtaskOutline') {
        const offered = script.objectives[Math.min(attempt, script.objectives.length - 1)] ?? [];
        attempt += 1;
        return { objectives: offered.length > 0 ? offered : [PARENT] };
      }

      // The detail call must not be able to change the objective — the outline
      // owns it, past the duplicate guard.
      return {
        objective: 'IGNORED — the outline decides the objective',
        category: 'explain',
        criterion: 'It is explained in plain language.',
        outOfScope: 'Not the other part.',
        blastRadius: 'low' as const,
      };
    },
  };

  return { generator, calls };
}

/** How many times the planner asked the model for a split. */
const outlineCalls = (calls: readonly string[]) => calls.filter((c) => c === 'SubtaskOutline').length;

const plannerOn = (generator: StructuredGenerator) =>
  createStepwisePlanner({ generator, provider: 'ollama', model: 'qwen3.5:2b' });

const objectives = (result: { subtasks: readonly { objective: string }[] }) =>
  result.subtasks.map((s) => s.objective);

describe('2e5eaece — the planner never proposes the same subtask twice', () => {
  it('collapses a model that returns the parent objective for every subtask', async () => {
    // Exactly what shipped: both children read identically in Mission Control.
    const { generator } = generatorOf({ count: 2, objectives: [[PARENT, PARENT]] });

    const result = await plannerOn(generator).propose({ contract: contract() });

    expect(new Set(objectives(result)).size).toBe(objectives(result).length);
  });

  it('treats objectives differing only by case, spacing or punctuation as duplicates', async () => {
    const { generator } = generatorOf({
      count: 3,
      objectives: [['Explain the heat pump.', 'explain  the heat pump', 'EXPLAIN THE HEAT PUMP!']],
    });

    const result = await plannerOn(generator).propose({ contract: contract() });

    expect(objectives(result)).toHaveLength(1);
  });

  it('DISTRACTOR: a genuinely distinct split is preserved in full', async () => {
    // Without this, "always return one subtask" would satisfy both tests above
    // — and would silently destroy every real decomposition.
    const distinct = ['Explain what a heat pump is.', 'Explain how it differs from a gas boiler.'];
    const { generator } = generatorOf({ count: 2, objectives: [distinct] });

    const result = await plannerOn(generator).propose({ contract: contract() });

    expect(objectives(result)).toEqual(distinct);
  });

  it('DISTRACTOR: asks the model again for a replacement before dropping a duplicate', async () => {
    // A planner that only deduplicated would quietly shrink every split. It must
    // first try to get the subtask it actually asked for.
    const { generator, calls } = generatorOf({
      count: 2,
      objectives: [
        [PARENT, PARENT],
        ['Explain what a heat pump is.', 'Explain how it differs from a gas boiler.'],
      ],
    });

    const result = await plannerOn(generator).propose({ contract: contract() });

    expect(objectives(result)).toHaveLength(2);
    expect(outlineCalls(calls)).toBeGreaterThan(1);
  });

  it('DISTRACTOR: a subtask that merely restates the parent is not a decomposition', async () => {
    // One child identical to its parent is the tree pretending to have split.
    // Keeping it whole is the honest outcome, not two copies of the same work.
    const { generator } = generatorOf({
      count: 2,
      objectives: [[PARENT, 'Explain how it differs from a gas boiler.']],
    });

    const result = await plannerOn(generator).propose({ contract: contract() });

    expect(objectives(result)).not.toContain(PARENT);
  });

  it('always returns at least one subtask, even when the model only ever repeats itself', async () => {
    // Returning nothing would strand the Orchestrator with an empty split.
    const { generator } = generatorOf({ count: 4, objectives: [[PARENT]] });

    const result = await plannerOn(generator).propose({ contract: contract() });

    expect(result.subtasks.length).toBeGreaterThanOrEqual(1);
  });

  it('effort shares sum to at most 1 after duplicates are removed', async () => {
    // Shares are derived from the count asked for; dropping duplicates without
    // recomputing them would leave the parent budget under-allocated or over.
    const { generator } = generatorOf({ count: 3, objectives: [[PARENT, PARENT, 'Explain the difference.']] });

    const result = await plannerOn(generator).propose({ contract: contract() });
    const total = result.subtasks.reduce((sum, s) => sum + s.effortShare, 0);

    expect(total).toBeLessThanOrEqual(1.0000001);
    expect(total).toBeGreaterThan(0);
  });
});

/**
 * Defect `5e245281` — the planner manufactured one criterion per subtask.
 *
 * Under ADR-0009 a contract with a single acceptance criterion is a leaf, so
 * inventing exactly one criterion per child made every child atomic by
 * construction and the recursion added for `a910ed8d` could never fire. Worse,
 * it produced children like "Compare the operational mechanisms, efficiency
 * ratings, and primary costs of heat pump technology" — three outcomes wearing
 * one criterion — which the worker then could not execute.
 *
 * The fix is to PARTITION the parent's criteria rather than author new ones.
 * That is deterministic (so a tree replays), cannot inflate the criteria count,
 * and strictly shrinks — which is what keeps recursion terminating.
 */
describe('5e245281 — subtasks partition the parent criteria rather than inventing them', () => {
  const parentWith = (statements: string[]): TaskContract => ({
    ...contract(),
    acceptanceCriteria: statements.map((statement, i) => ({ criterionId: `ac-${i + 1}`, statement })),
  });

  /** Scripts the outline and the criterion→subtask assignment. */
  function partitioningGenerator(script: { objectives: string[]; assignments?: number[] }) {
    const generator: StructuredGenerator = {
      async generate({ probe }) {
        const id = (probe.schema as { $id?: string }).$id ?? '';
        if (id === 'SubtaskCount') return { count: script.objectives.length };
        if (id === 'SubtaskOutline') return { objectives: script.objectives };
        if (id === 'CriterionAssignment') {
          return { assignments: script.assignments ?? script.objectives.map((_, i) => i) };
        }
        return {
          objective: 'IGNORED',
          category: 'answer',
          criterion: 'model-authored fallback',
          outOfScope: 'Not the sibling.',
          blastRadius: 'low' as const,
        };
      },
    };
    return generator;
  }

  it('gives each subtask the parent criteria it covers', async () => {
    const generator = partitioningGenerator({
      objectives: ['Explain heat pumps.', 'Explain gas boilers.'],
      assignments: [0, 1],
    });

    const result = await plannerOn(generator).propose({
      contract: parentWith(['Heat pump explained.', 'Gas boiler explained.']),
    });

    expect(result.subtasks[0]?.acceptanceCriteria.map((c) => c.statement)).toEqual(['Heat pump explained.']);
    expect(result.subtasks[1]?.acceptanceCriteria.map((c) => c.statement)).toEqual(['Gas boiler explained.']);
  });

  it('DISTRACTOR: every parent criterion lands somewhere, and none is invented', async () => {
    // Losing a criterion means the mission silently drops a requirement;
    // inventing one means the tree grades work nobody asked for.
    const parent = parentWith(['One.', 'Two.', 'Three.']);
    const generator = partitioningGenerator({
      objectives: ['A', 'B'],
      assignments: [0, 1, 0],
    });

    const result = await plannerOn(generator).propose({ contract: parent });

    const covered = result.subtasks.flatMap((s) => s.acceptanceCriteria.map((c) => c.statement)).sort();
    expect(covered).toEqual(['One.', 'Three.', 'Two.']);
  });

  it('a subtask that covers several criteria keeps them all, so it can be split again', async () => {
    // This is what makes depth possible: a child with two criteria is NOT a leaf.
    const generator = partitioningGenerator({
      objectives: ['Everything about heating.', 'Insulation.'],
      assignments: [0, 0, 1],
    });

    const result = await plannerOn(generator).propose({
      contract: parentWith(['Heat pumps.', 'Gas boilers.', 'Insulation.']),
    });

    expect(result.subtasks[0]?.acceptanceCriteria).toHaveLength(2);
  });

  it('DISTRACTOR: a subtask covering no criterion is dropped, not shipped empty', async () => {
    // A task with nothing to satisfy cannot be graded and would fail its own
    // contract check downstream.
    const generator = partitioningGenerator({
      objectives: ['Covers everything.', 'Covers nothing.'],
      assignments: [0, 0],
    });

    const result = await plannerOn(generator).propose({
      contract: parentWith(['One.', 'Two.']),
    });

    expect(result.subtasks.every((s) => s.acceptanceCriteria.length > 0)).toBe(true);
  });

  it('DISTRACTOR: an assignment that puts everything on ONE subtask still shrinks', async () => {
    // Otherwise the child equals its parent and recursion never terminates —
    // the partition must be a real partition.
    const parent = parentWith(['One.', 'Two.', 'Three.']);
    const generator = partitioningGenerator({
      objectives: ['A', 'B', 'C'],
      assignments: [0, 0, 0],
    });

    const result = await plannerOn(generator).propose({ contract: parent });

    for (const subtask of result.subtasks) {
      expect(subtask.acceptanceCriteria.length).toBeLessThan(parent.acceptanceCriteria.length);
    }
  });

  it('a parent with a single criterion cannot be partitioned, so the model authors one', async () => {
    const generator = partitioningGenerator({ objectives: ['Only part.'] });

    const result = await plannerOn(generator).propose({ contract: parentWith(['The only thing.']) });

    expect(result.subtasks[0]?.acceptanceCriteria).toHaveLength(1);
  });

  it('DISTRACTOR: an out-of-range assignment falls back to its own slot, not onto subtask 0', async () => {
    // Small models return indices that do not exist. Dumping every invalid index
    // onto subtask 0 keeps the criterion "covered" while silently unbalancing the
    // split — so this asserts WHERE it lands, not merely that it survives.
    // Three subtasks keeps the all-in-one-bucket guard out of the way, so the
    // fallback is the only thing under test.
    const generator = partitioningGenerator({
      objectives: ['A', 'B', 'C'],
      assignments: [0, 99, 2],
    });

    const result = await plannerOn(generator).propose({
      contract: parentWith(['One.', 'Two.', 'Three.']),
    });

    expect(result.subtasks).toHaveLength(3);
    expect(result.subtasks.map((s) => s.acceptanceCriteria.map((c) => c.statement))).toEqual([
      ['One.'],
      ['Two.'],
      ['Three.'],
    ]);
  });
});
