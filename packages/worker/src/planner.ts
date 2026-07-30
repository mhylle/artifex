/**
 * Model-backed planner and reconciler — the Orchestrator's two seams, wired to
 * real models through the Model Router.
 *
 * Both schemas are TypeBox objects handed to the model verbatim for structured
 * output (ADR-0004): the shape we constrain generation with is the same object we
 * validate the response against, so there is no seam to drift.
 *
 * These schemas are deliberately *worker-local* rather than in `shared-types`.
 * They are not contracts between packages — nothing outside the Orchestrator ever
 * sees a decomposition proposal. `shared-types` is for shapes that cross a
 * boundary; putting every internal shape there would make the leaf package a
 * dumping ground.
 *
 * Both run at the tier the Tier Policy engine computed for the task. Decomposition
 * is the highest-leverage thing the system does — a bad split is a mistake every
 * descendant inherits — which is exactly why root decomposition scores a high
 * floor rather than being hardcoded to a big model.
 */
import { StringEnum } from '@artifex/shared-types';
import type { TaskContract } from '@artifex/shared-types';
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

import type { ChildResult, DecompositionProposal, Planner, Reconciler } from './orchestrator.js';

const BLAST_RADII = ['low', 'medium', 'high'] as const;

export const DecompositionProposalSchema = Type.Object(
  {
    subtasks: Type.Array(
      Type.Object(
        {
          objective: Type.String({ minLength: 1 }),
          category: Type.String({ minLength: 1 }),
          acceptanceCriteria: Type.Array(
            Type.Object(
              { criterionId: Type.String({ minLength: 1 }), statement: Type.String({ minLength: 1 }) },
              { additionalProperties: false },
            ),
            { minItems: 1 },
          ),
          outOfScope: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
          blastRadius: StringEnum(BLAST_RADII),
          effortShare: Type.Number({ minimum: 0, maximum: 1 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  {
    $id: 'DecompositionProposal',
    additionalProperties: false,
    description: 'A proposed split of one contract into atomic, individually-gradeable subtasks.',
  },
);
export type DecompositionProposalOutput = Static<typeof DecompositionProposalSchema>;

export const ReconciliationSchema = Type.Object(
  {
    summary: Type.String({ minLength: 1 }),
    /** Contradictions between children. Empty is a claim, not an omission. */
    conflicts: Type.Array(Type.String({ minLength: 1 })),
  },
  {
    $id: 'Reconciliation',
    additionalProperties: false,
    description: 'One reconciled result composed from several child deliverables.',
  },
);
export type Reconciliation = Static<typeof ReconciliationSchema>;

/** What the worker needs from a model backend — structurally the router's shape. */
export interface StructuredGenerator {
  generate(args: {
    readonly provider: string;
    readonly model: string;
    readonly probe: { readonly schema: unknown; readonly prompt: string };
  }): Promise<unknown>;
}

export interface ModelSeamOptions {
  readonly generator: StructuredGenerator;
  readonly provider: string;
  readonly model: string;
}

function decompositionPrompt(contract: TaskContract): string {
  return [
    `Split this objective into the smallest set of INDEPENDENT subtasks that fully covers it.`,
    ``,
    `OBJECTIVE: ${contract.objective}`,
    `ACCEPTANCE CRITERIA OF THE PARENT:`,
    ...contract.acceptanceCriteria.map((c) => `  - ${c.criterionId}: ${c.statement}`),
    `OUT OF SCOPE: ${contract.boundaries.outOfScope.join('; ') || '(nothing stated)'}`,
    ``,
    `Rules:`,
    `  - Every subtask MUST carry at least one acceptance criterion that a stranger could grade.`,
    `  - Every subtask MUST state what it does NOT cover, so siblings cannot overlap.`,
    `  - effortShare values are fractions of the parent budget and MUST sum to at most 1.`,
    `  - Subtasks must be independent: none may depend on another's output.`,
  ].join('\n');
}

/** A planner backed by a real model, constrained by {@link DecompositionProposalSchema}. */
export function createModelPlanner(options: ModelSeamOptions): Planner {
  return {
    async propose({ contract }) {
      const output = await options.generator.generate({
        provider: options.provider,
        model: options.model,
        probe: { schema: DecompositionProposalSchema, prompt: decompositionPrompt(contract) },
      });

      // Structural validity is the decoder's doing, not the model's; the
      // Orchestrator still enforces the rules that actually matter (gradeable
      // criteria, declared anti-scope, affordable effort shares).
      return output as DecompositionProposal;
    },
  };
}

/** A reconciler backed by a real model, constrained by {@link ReconciliationSchema}. */
export function createModelReconciler(options: ModelSeamOptions): Reconciler {
  return {
    async reconcile({ parent, children }) {
      const prompt = [
        `Reconcile these child results into ONE coherent answer to the parent objective.`,
        ``,
        `PARENT OBJECTIVE: ${parent.objective}`,
        ``,
        `CHILD RESULTS:`,
        ...children.map((c: ChildResult, i: number) => `  ${i + 1}. ${c.objective}: ${JSON.stringify(c.deliverable)}`),
        ``,
        `Do NOT simply concatenate them. Where two children disagree about the same`,
        `fact, say so explicitly in "conflicts" rather than presenting both as true.`,
      ].join('\n');

      const output = (await options.generator.generate({
        provider: options.provider,
        model: options.model,
        probe: { schema: ReconciliationSchema, prompt },
      })) as Reconciliation;

      return { deliverable: { summary: output.summary }, conflicts: output.conflicts };
    },
  };
}

/**
 * A planner that asks for ONE subtask at a time (defect `8b7e9e95`).
 *
 * The array-of-nested-objects schema is what makes small models run away: under
 * constrained decoding the grammar keeps the output syntactically alive while
 * the model reasons out loud inside the JSON channel, until it hits the context
 * limit. Measured: 32,690 completion tokens on a 78-token prompt.
 *
 * Flattening removes the cliff rather than raising the guard rail. Each call
 * returns a single subtask against a shallow schema, so the model never has to
 * hold an open array across a long generation. It costs N round trips instead of
 * one — a trade worth making, because the alternative is a planner that fails
 * stochastically and takes the whole mission with it.
 *
 * The count is asked for first, and separately, for the same reason.
 */
export const SubtaskCountSchema = Type.Object(
  { count: Type.Integer({ minimum: 1, maximum: 8 }) },
  { $id: 'SubtaskCount', additionalProperties: false },
);

export const SingleSubtaskSchema = Type.Object(
  {
    objective: Type.String({ minLength: 1 }),
    category: Type.String({ minLength: 1 }),
    criterion: Type.String({ minLength: 1 }),
    outOfScope: Type.String({ minLength: 1 }),
    blastRadius: StringEnum(BLAST_RADII),
  },
  { $id: 'SingleSubtask', additionalProperties: false },
);

export function createStepwisePlanner(options: ModelSeamOptions): Planner {
  return {
    async propose({ contract }) {
      const { count } = (await options.generator.generate({
        provider: options.provider,
        model: options.model,
        probe: {
          schema: SubtaskCountSchema,
          prompt: `How many INDEPENDENT subtasks fully cover this objective? Answer with a number only.\n\nOBJECTIVE: ${contract.objective}`,
        },
      })) as { count: number };

      const subtasks = [];
      for (let index = 0; index < count; index += 1) {
        const one = (await options.generator.generate({
          provider: options.provider,
          model: options.model,
          probe: {
            schema: SingleSubtaskSchema,
            prompt: [
              `Describe subtask ${index + 1} of ${count} for this objective.`,
              `It must be independent of the others and gradeable by a stranger.`,
              ``,
              `OBJECTIVE: ${contract.objective}`,
              ...(subtasks.length > 0
                ? ['ALREADY COVERED (do not repeat):', ...subtasks.map((s) => `  - ${s.objective}`)]
                : []),
            ].join('\n'),
          },
        })) as { objective: string; category: string; criterion: string; outOfScope: string; blastRadius: 'low' | 'medium' | 'high' };

        subtasks.push({
          objective: one.objective,
          category: one.category,
          acceptanceCriteria: [{ criterionId: `ac-${index + 1}`, statement: one.criterion }],
          outOfScope: [one.outOfScope],
          blastRadius: one.blastRadius,
          // Shares are assigned here rather than asked for: a model returning
          // shares that sum above 1 is a refusal the Orchestrator would raise,
          // and there is nothing to gain from letting it invent them.
          effortShare: 1 / count,
        });
      }

      return { subtasks };
    },
  };
}
