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
