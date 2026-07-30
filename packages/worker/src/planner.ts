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
