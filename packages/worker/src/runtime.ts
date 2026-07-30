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

import type { RegistryLookup } from './agent-creator.js';
import { composeDesign } from './design-playbook.js';
import type { ControlSignals, DecompositionGate } from './mission-loop.js';
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

/**
 * Wrap a decompose-or-delegate gate so keeping work whole requires UNANIMITY
 * across `samples` calls (defect `890cdea5`).
 *
 * Splitting is the safe default and the recoverable one: a plan split too finely
 * costs coordination, while a plan wrongly kept whole hands an entire task graph
 * to one agent. Mission `8dd66596` did exactly that — five independent tool
 * descriptions collapsed onto one worker, which bounced, escalated and
 * surrendered — and the gate's own rationale in that run argued for splitting
 * while its boolean said otherwise. No schema catches a confident wrong answer;
 * repetition does.
 *
 * The pattern is not new here: the admission gate already samples N times and
 * requires unanimity (`d678cd8c`) rather than trusting a single call. This is
 * the same guard applied to the decision that shapes the whole tree.
 *
 * A sample that THROWS counts as a dissent. A call that failed did not vote to
 * keep whole, and treating an error as assent would let a flaky backend collapse
 * a task graph.
 */
export function sampledDecompositionGate(
  gate: DecompositionGate,
  samples: number,
): DecompositionGate {
  return {
    async assess(input) {
      const verdicts = await Promise.all(
        Array.from({ length: Math.max(1, samples) }, async () => {
          try {
            return await gate.assess(input);
          } catch (error) {
            return { keepWhole: false, rationale: `Gate sample failed (${describeError(error)}).` };
          }
        }),
      );

      const dissent = verdicts.find((verdict) => !verdict.keepWhole);
      if (dissent === undefined) {
        return { keepWhole: true, rationale: verdicts[0]?.rationale ?? 'Unanimous: keep whole.' };
      }

      const dissenters = verdicts.filter((verdict) => !verdict.keepWhole).length;
      // The rationale reported is the one that DECIDED the outcome. Reporting a
      // majority's reasoning beside a split decision would make the trail
      // explain something that did not happen.
      return {
        keepWhole: false,
        rationale:
          dissenters === verdicts.length
            ? dissent.rationale
            : `${dissent.rationale} (${dissenters} of ${verdicts.length} samples dissented; keeping work whole requires unanimity.)`,
      };
    },
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createMissionSeams(
  generator: StructuredGenerator,
  models: RuntimeModels,
  control?: ControlSignals,
  registry?: RegistryLookup,
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
    decompositionGate: sampledDecompositionGate({
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
      // Three samples, unanimity required to keep whole (defect `890cdea5`).
      // Three because that is what the admission gate already uses for the same
      // job — turning a single confident answer into a repeated one — and
      // because splitting is the recoverable direction, so the cost of a false
      // split is far below the cost of a false collapse.
    }, 3),

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

    /**
     * The reuse market's read and write halves (R38).
     *
     * Absent, staffing degrades to "always author a fresh design" — which is
     * exactly what the swarm did for its whole life until now, because this was
     * hard-coded to `{ bestForCategory: () => null }` (defect `41f7555c`).
     */
    registry: registry ?? { async bestForCategory() { return null; } },

    /**
     * Composed from the design playbook's typed blocks (R38 AC-2), not from a
     * template string and not from freeform generation. The design space is
     * constrained by construction: the composer can only emit known block
     * kinds, each filled from a named contract field.
     */
    author: {
      async design({ contract }) {
        const composed = composeDesign(contract);
        return { roleInstructions: composed.roleInstructions, capabilities: composed.capabilities };
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
