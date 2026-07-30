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

/**
 * The distinct sub-objectives, asked for together (defect `2e5eaece`).
 *
 * Asking one subtask at a time removed the runaway-generation cliff, but it also
 * removed the model's only chance to *see* that it was repeating itself: each
 * call was a fresh context whose sole anchor was the parent objective, so a
 * small model reproduced the parent every time.
 *
 * A flat array of strings restores that visibility while keeping the shallow
 * shape that made stepwise safe — there is no nested object for the grammar to
 * hold open across a long generation.
 */
export const SubtaskOutlineSchema = Type.Object(
  { objectives: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 8 }) },
  { $id: 'SubtaskOutline', additionalProperties: false },
);

/**
 * Compare objectives the way a reader would, not the way `===` does.
 *
 * The shipped duplicates were byte-identical, but "Explain the heat pump." and
 * "explain  the heat pump" are the same instruction to any worker, and a split
 * containing both is not a split.
 */
function normalize(objective: string): string {
  return objective
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** How many times to ask for a replacement before accepting a smaller split. */
const REPLACEMENT_ATTEMPTS = 2;

export function createStepwisePlanner(options: ModelSeamOptions): Planner {
  const ask = async <T>(schema: unknown, prompt: string): Promise<T> =>
    (await options.generator.generate({
      provider: options.provider,
      model: options.model,
      probe: { schema, prompt },
    })) as T;

  return {
    async propose({ contract }) {
      const { count } = await ask<{ count: number }>(
        SubtaskCountSchema,
        `How many INDEPENDENT subtasks fully cover this objective? Answer with a number only.\n\nOBJECTIVE: ${contract.objective}`,
      );

      const outlinePrompt = (exclude: readonly string[]): string =>
        [
          `List ${count} DISTINCT sub-objectives that together fully cover this objective.`,
          `Each must be a different piece of the work — not a restatement of the whole.`,
          ``,
          `OBJECTIVE: ${contract.objective}`,
          ...(exclude.length > 0
            ? ['', 'These are already taken; give different ones:', ...exclude.map((o) => `  - ${o}`)]
            : []),
        ].join('\n');

      // Accepted objectives, keyed by normalized form. The parent is seeded as
      // already-taken: a child that restates its parent is the tree pretending
      // to have split, and two such children are the defect that shipped.
      const taken = new Set<string>([normalize(contract.objective)]);
      const accepted: string[] = [];

      const absorb = (candidates: readonly string[]): void => {
        for (const objective of candidates) {
          const key = normalize(objective);
          if (key.length === 0 || taken.has(key)) continue;
          taken.add(key);
          accepted.push(objective);
        }
      };

      absorb((await ask<{ objectives: string[] }>(SubtaskOutlineSchema, outlinePrompt([]))).objectives);

      // Ask again for what the model duplicated away, naming what it may not
      // reuse. Deduplicating without re-asking would quietly shrink every split.
      for (let attempt = 0; accepted.length < count && attempt < REPLACEMENT_ATTEMPTS; attempt += 1) {
        const before = accepted.length;
        absorb(
          (await ask<{ objectives: string[] }>(SubtaskOutlineSchema, outlinePrompt(accepted))).objectives,
        );
        if (accepted.length === before) break; // Nothing new arriving; stop paying for it.
      }

      // A model that only ever repeats the parent is telling us this work does
      // not decompose. Handing back the parent as its own single child is the
      // honest reading — and it is what the decompose-or-delegate gate (R31)
      // will formalize. Two identical children never is.
      if (accepted.length === 0) accepted.push(contract.objective);

      const subtasks = [];
      for (const [index, objective] of accepted.entries()) {
        const one = await ask<{
          objective: string;
          category: string;
          criterion: string;
          outOfScope: string;
          blastRadius: 'low' | 'medium' | 'high';
        }>(
          SingleSubtaskSchema,
          [
            `Detail this subtask so a stranger could execute and grade it.`,
            ``,
            `SUBTASK: ${objective}`,
            `PART OF: ${contract.objective}`,
            `SIBLINGS (do not do their work): ${accepted.filter((o) => o !== objective).join('; ') || '(none)'}`,
          ].join('\n'),
        );

        subtasks.push({
          // The outline decides the objective, not the detail call — otherwise a
          // model could reintroduce a duplicate at the last step, past the guard.
          objective,
          category: one.category,
          acceptanceCriteria: [{ criterionId: `ac-${index + 1}`, statement: one.criterion }],
          outOfScope: [one.outOfScope],
          blastRadius: one.blastRadius,
          // Computed from what SURVIVED, not from what was asked for: shares
          // derived from `count` would under-allocate the parent budget whenever
          // duplicates were dropped.
          effortShare: 1 / accepted.length,
        });
      }

      return { subtasks };
    },
  };
}
