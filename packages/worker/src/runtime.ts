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

import type { ControlSignals } from './mission-loop.js';
import { DecomposeOrDelegateSchema, createModelReconciler, createStepwisePlanner } from './planner.js';
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

const RewrittenObjectiveSchema = Type.Object(
  { objective: Type.String({ minLength: 1 }) },
  { $id: 'RewrittenObjective', additionalProperties: false },
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

/** The slice of the ledger the control seam reads. */
export interface ControlReader {
  replay(filter: { missionId: string }): Promise<
    Array<{ taskId: string | null; type: string; payload?: Record<string, unknown> }>
  >;
}

/**
 * Operator control, derived from the ledger (R17).
 *
 * The same fold the control plane performs, run on the runtime side — there is
 * no shared "is paused" state, because a second copy is a second truth. Both
 * read the trail, so they cannot disagree.
 *
 * A failed read means RUN, deliberately: a database hiccup must not silently
 * pause a mission. Failing open is the safer error here, because a wrongly
 * paused mission looks exactly like an idle one and nobody investigates it.
 */
export function createLedgerControl(reader: ControlReader, missionId = ''): ControlSignals {
  return {
    async check(taskId: string) {
      let events: Array<{ taskId: string | null; type: string }>;
      try {
        events = await reader.replay({ missionId });
      } catch {
        return 'run';
      }

      let state: 'run' | 'paused' | 'cancelled' = 'run';
      for (const event of events) {
        if (event.taskId !== null && event.taskId !== taskId) continue;
        if (event.type === 'operator.paused') state = 'paused';
        else if (event.type === 'operator.resumed') state = 'run';
        else if (event.type === 'operator.cancelled') return 'cancelled';
      }
      return state;
    },

    /**
     * Effort the operator has granted this task (defect `9fbee9d6`).
     *
     * Summed rather than last-wins: two top-ups of 10 are 20 of extra budget,
     * not 10. Grants accumulate the way spending does.
     *
     * A failed read returns 0 — the contract's own ceiling still binds. Failing
     * the other way would let a database hiccup hand a task unlimited budget.
     */
    async grantedBudget(taskId: string) {
      let events: Array<{ taskId: string | null; type: string; payload?: Record<string, unknown> }>;
      try {
        events = await reader.replay({ missionId });
      } catch {
        return 0;
      }

      let total = 0;
      for (const event of events) {
        if (event.type !== 'operator.budget_granted') continue;
        if (event.taskId !== null && event.taskId !== taskId) continue;
        const amount = event.payload?.['amount'];
        if (typeof amount === 'number' && amount > 0) total += amount;
      }
      return total;
    },

    /**
     * The autonomy dial as the operator last set it (defect `0d39d84b`).
     *
     * Last-wins rather than summed: unlike budget grants, turning a dial
     * replaces the setting rather than adding to it.
     *
     * `null` on failure or absence, so the contract's own dial governs — the
     * mission behaves as it was commissioned when the trail says nothing.
     */
    async currentDial(_missionId: string) {
      let events: Array<{ taskId: string | null; type: string; payload?: Record<string, unknown> }>;
      try {
        events = await reader.replay({ missionId });
      } catch {
        return null;
      }

      let dial: 'autonomous' | 'checkpointed' | 'supervised' | null = null;
      for (const event of events) {
        if (event.type !== 'operator.dial_turned') continue;
        const value = event.payload?.['autonomyDial'];
        if (value === 'autonomous' || value === 'checkpointed' || value === 'supervised') {
          dial = value;
        }
      }
      return dial;
    },
  };
}

export function createMissionSeams(
  generator: StructuredGenerator,
  models: RuntimeModels,
  control?: ControlSignals,
): MissionSeams {
  const gen = (
    m: { provider: string; model: string },
    schema: unknown,
    prompt: string,
  ): Promise<unknown> => generator.generate({ provider: m.provider, model: m.model, probe: { schema, prompt } });

  return {
    // Passed through rather than constructed here: the runtime owns the ledger
    // connection, and this module owns the model seams.
    ...(control === undefined ? {} : { control }),

    planner: createStepwisePlanner({
      generator,
      provider: models.evaluator.provider,
      model: models.evaluator.model,
    }),

    /**
     * The decompose-or-delegate gate (R31).
     *
     * Runs on the EVALUATIVE tier, not the worker tier: "should this be split"
     * is a judgement about the shape of the work, and fold-up taught us that
     * evaluative questions belong a tier above the doing (insight `1aad1dd5`).
     *
     * The prompt asks for the entangled case explicitly rather than for a
     * general opinion, because the default has to be splitting — a gate that
     * kept everything whole would quietly turn the swarm back into one agent.
     */
    decompositionGate: {
      async assess({ contract }) {
        const out = (await gen(models.evaluator, DecomposeOrDelegateSchema, [
          'Decide whether this work should be SPLIT into independent subtasks or KEPT WHOLE for one agent.',
          '',
          'Keep it whole only when the parts are so entangled that splitting would damage the result:',
          'when each part constrains the others, when it must be done in one continuous line of reasoning,',
          'or when a later part cannot be written without holding the earlier part in mind.',
          'Otherwise split — most work splits cleanly, and splitting is the default.',
          '',
          `OBJECTIVE: ${contract.objective}`,
          'MUST SATISFY:',
          ...contract.acceptanceCriteria.map((c) => `  - ${c.statement}`),
        ].join('\n'))) as { keepWhole?: unknown; rationale?: unknown };

        // Anything malformed reads as "split": that is what every caller did
        // before the gate existed, so a confused model costs nothing.
        return {
          keepWhole: out.keepWhole === true,
          rationale: typeof out.rationale === 'string' && out.rationale.length > 0
            ? out.rationale
            : 'The gate returned no rationale.',
        };
      },
    },

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

    /**
     * Repairs a contract the worker could not restate (defect `1e3905a4`).
     *
     * Runs at the evaluator tier because rewriting a specification is authoring
     * work, not execution — and because the thing being repaired is the
     * Orchestrator's output, so it belongs at the Orchestrator's end of the
     * ladder rather than the worker's.
     *
     * Note what it is NOT allowed to do: the acceptance criteria are returned
     * unchanged (`null`). A task that could rewrite its own criteria could
     * dissolve any objective it found hard by redefining success — the exact
     * move invariant #4 exists to prevent. Only the objective's *wording* is in
     * scope here; what counts as done is not.
     */
    clarifier: {
      async clarify({ contract, ambiguities }) {
        const out = (await gen(models.evaluator, RewrittenObjectiveSchema, [
          'Rewrite this task objective so the listed ambiguities disappear.',
          'Keep the SAME work in scope — resolve the wording, do not narrow or change the task.',
          '',
          `OBJECTIVE: ${contract.objective}`,
          'AMBIGUITIES REPORTED BY THE WORKER:',
          ...ambiguities.map((a) => `  - ${a}`),
          'IT MUST STILL SATISFY:',
          ...contract.acceptanceCriteria.map((c) => `  - ${c.statement}`),
        ].join('\n'))) as { objective: string };

        return { objective: out.objective, acceptanceCriteria: null };
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
