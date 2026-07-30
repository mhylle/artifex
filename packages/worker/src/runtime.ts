/**
 * The runtime wiring — model-backed mission seams.
 *
 * P9 built the mission loop and P13 proved it end to end, but each dogfood
 * assembled its seams inline. This is that assembly promoted into the package,
 * so the shipped worker binary runs the same loop the dogfoods did rather than
 * a placeholder.
 *
 * Tier is computed PER SEAM, not per task (the convention P5 recorded):
 *   - **decomposition** runs at the FRONTIER end of the ladder. ADR-0002 puts
 *     root decomposition at the top because a bad split is inherited by every
 *     descendant — and it uses the *stepwise* planner, because a nested schema
 *     is what makes a small model run away (defect `8b7e9e95`).
 *   - **execution** runs at the cheapest tier the task's risk permits.
 *   - **judging** (Gate A, Gate B, fold-up) is evaluative work, which the tier
 *     policy floats a rung above the floor.
 */
import { Type } from '@sinclair/typebox';

import { createModelReconciler, createStepwisePlanner } from './planner.js';
import type { StructuredGenerator } from './planner.js';
import type { MissionSeams } from './mission-loop.js';

const AnswerSchema = Type.Object(
  { answer: Type.String({ minLength: 1 }) },
  { $id: 'WorkerAnswer', additionalProperties: false },
);

const ClaritySchema = Type.Object(
  {
    restatement: Type.String({ minLength: 1 }),
    ambiguities: Type.Array(Type.String({ minLength: 1 })),
  },
  { $id: 'ClarityAssessment', additionalProperties: false },
);

const CoverageSchema = Type.Object(
  {
    coverage: Type.Array(
      Type.Object(
        { criterionId: Type.String({ minLength: 1 }), coveredByTaskIds: Type.Array(Type.String()) },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { $id: 'CoverageAssessment', additionalProperties: false },
);

const CompletionSchema = Type.Object(
  {
    criteria: Type.Array(
      Type.Object(
        {
          criterionId: Type.String({ minLength: 1 }),
          met: Type.Boolean(),
          detail: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    redFlags: Type.Array(Type.String()),
  },
  { $id: 'CompletionAssessment', additionalProperties: false },
);

export interface RuntimeModels {
  /** Cheapest admitted model — the bulk of atomic worker tasks. */
  readonly worker: { readonly provider: string; readonly model: string };
  /** Evaluative work: planning, Gate A, Gate B, fold-up. */
  readonly evaluator: { readonly provider: string; readonly model: string };
}

/**
 * Keep only the criterion ids the contract actually has.
 *
 * Small models invent ids. The Reviewer already refuses a judgement naming
 * criteria the contract never had — filtering here means an invented id is
 * dropped rather than aborting the whole task, while a genuinely *missing*
 * assessment still fails Gate B, because the Reviewer iterates the contract.
 */
function keepKnown<T extends { criterionId: string }>(items: readonly T[], known: Set<string>): T[] {
  return items.filter((item) => known.has(item.criterionId));
}

export function createMissionSeams(
  generator: StructuredGenerator,
  models: RuntimeModels,
): MissionSeams {
  const gen = (
    m: { provider: string; model: string },
    schema: unknown,
    prompt: string,
  ): Promise<unknown> => generator.generate({ provider: m.provider, model: m.model, probe: { schema, prompt } });

  return {
    planner: createStepwisePlanner({
      generator,
      provider: models.evaluator.provider,
      model: models.evaluator.model,
    }),

    coverageJudge: {
      async assess({ parent, children }) {
        const out = (await gen(models.evaluator, CoverageSchema, [
          'Which child tasks cover which parent acceptance criteria? Use only the ids given.',
          'PARENT CRITERIA:',
          ...parent.acceptanceCriteria.map((c) => `  ${c.criterionId}: ${c.statement}`),
          'CHILD TASKS:',
          ...children.map((k) => `  ${k.taskId}: ${k.objective}`),
        ].join('\n'))) as { coverage: Array<{ criterionId: string; coveredByTaskIds: string[] }> };

        const known = new Set(parent.acceptanceCriteria.map((c) => c.criterionId));
        return { coverage: keepKnown(out.coverage, known) };
      },
    },

    registry: { async bestForCategory() { return null; } },

    author: {
      async design({ contract }) {
        return {
          roleInstructions: `You answer exactly this task, and nothing beyond it: ${contract.objective}`,
          capabilities: ['text'],
        };
      },
    },

    clarityJudge: {
      async assess({ contract }) {
        const out = (await gen(models.worker, ClaritySchema, [
          'Restate this task in your own words. Then list anything genuinely AMBIGUOUS',
          'that would force you to guess. If it is clear and executable, return an EMPTY list.',
          '',
          `TASK: ${contract.objective}`,
          `ACCEPTANCE CRITERIA: ${contract.acceptanceCriteria.map((c) => c.statement).join('; ')}`,
        ].join('\n'))) as { restatement: string; ambiguities: string[] };

        return { restatement: out.restatement, ambiguities: out.ambiguities };
      },
    },

    work: {
      async execute({ contract }) {
        // The worker MUST be shown its acceptance criteria — they are the spec.
        // Prompting with the objective alone was the P9 bug: the planner wrote
        // criteria the worker never aimed at, and Gate B correctly failed it.
        const out = (await gen(models.worker, AnswerSchema, [
          'Answer the task so that EVERY acceptance criterion below is satisfied.',
          '',
          `TASK: ${contract.objective}`,
          'ACCEPTANCE CRITERIA (you are graded on exactly these):',
          ...contract.acceptanceCriteria.map((c) => `  - ${c.statement}`),
        ].join('\n'))) as { answer: string };

        return {
          deliverable: { answer: out.answer },
          actions: [],
          consulted: [],
          assumptions: [],
          effortSpent: 1,
        };
      },
    },

    completionJudge: {
      async assess({ contract, bundle }) {
        const out = (await gen(models.evaluator, CompletionSchema, [
          'Judge whether the delivered work meets EACH acceptance criterion.',
          'Assess every one, and use only the ids given.',
          'CRITERIA:',
          ...contract.acceptanceCriteria.map((c) => `  ${c.criterionId}: ${c.statement}`),
          `DELIVERABLE: ${JSON.stringify(bundle.deliverable)}`,
        ].join('\n'))) as {
          criteria: Array<{ criterionId: string; met: boolean; detail: string }>;
          redFlags: string[];
        };

        const known = new Set(contract.acceptanceCriteria.map((c) => c.criterionId));
        return { criteria: keepKnown(out.criteria, known), redFlags: out.redFlags };
      },
    },

    reconciler: createModelReconciler({
      generator,
      provider: models.evaluator.provider,
      model: models.evaluator.model,
    }),
  };
}
