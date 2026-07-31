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
import type { ControlSignals, DecompositionGate, DecompositionTemplateSeam, FastLoopSeam, KnowledgeCommonsSubmitter } from './mission-loop.js';
import { plantProbes } from './calibration.js';
import type { ContextStore } from './context-broker.js';
import type { ActionRecord, TaskContract, ToolSpec, WorkerContractView } from '@artifex/shared-types';

/**
 * The slice of the sealed bench the calibration seam reads (R35 AC-1).
 *
 * Structural, like every other fabric dependency here — the runtime imports no
 * repository. Sealed rather than open on purpose: the open slice is what the
 * Learning Agent optimises against, so scoring the Reviewer on it would measure
 * how well the reviewer agrees with something already tuned to the reviewer.
 */
export interface SealedBenchReader {
  sealedCases(): Promise<readonly {
    readonly caseId: string;
    readonly contract: unknown;
    readonly verifiedOutcome: unknown;
  }[]>;
}
import type { IntentJudge, PlanJudge } from './reviewer.js';
import { DecomposeOrDelegateSchema, createModelReconciler, createStepwisePlanner } from './planner.js';
import type { StructuredGenerator } from './planner.js';
import type { MissionSeams } from './mission-loop.js';

const AnswerSchema = Type.Object(
  { answer: Type.String({ minLength: 1 }) },
  { $id: 'WorkerAnswer', additionalProperties: false },
);

/**
 * What a worker assumed, asked for in its OWN probe (R40 AC-1).
 *
 * "Verifiable by a stranger" is the criterion, and a stranger cannot check work
 * whose unstated premises stayed in the model's head. So this is asked for
 * rather than inferred.
 *
 * It is a SEPARATE call rather than a second field on {@link AnswerSchema}, so
 * that eliciting provenance can never cost the deliverable: the answer is
 * already in hand before this is asked, and a failure here loses a nicety
 * rather than the work. Latency is not a constraint Artifex is under.
 *
 * Do NOT read this split as a fix for tier-1 JSON leakage. It was first adopted
 * on that theory — `qwen3.5:2b` returned a deliverable of
 * `", "assumptions": [] } // No specific assumption is needed..."` when the
 * worker schema carried two properties — but the same corruption reproduced on
 * the single-field schema afterwards, on the same objective. The leak tracks
 * the objective, not the schema width. It is open as its own defect; this
 * comment records the misattribution so nobody re-derives it.
 *
 * `assumptions` is read as optional at the use site so a dropped field means
 * "none declared" rather than losing an answer that was already produced.
 */
const AssumptionsSchema = Type.Object(
  { assumptions: Type.Array(Type.String({ minLength: 1 })) },
  { $id: 'WorkerAssumptions', additionalProperties: false },
);

/** Prompt line separator, named so it survives codegen that eats escapes. */
const NL = String.fromCharCode(10);

const PlanAuditSchema = Type.Object(
  {
    tasks: Type.Array(
      Type.Object(
        {
          taskId: Type.String({ minLength: 1 }),
          atomic: Type.Boolean(),
          detail: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    untestable: Type.Array(
      Type.Object(
        {
          taskId: Type.String({ minLength: 1 }),
          criterionId: Type.String({ minLength: 1 }),
          detail: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    overlaps: Type.Array(
      Type.Object(
        { taskIds: Type.Array(Type.String({ minLength: 1 })), detail: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
    ),
  },
  { $id: 'PlanAudit', additionalProperties: false },
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

const ReReviewSchema = Type.Object(
  { met: Type.Boolean(), detail: Type.String({ minLength: 1 }) },
  { $id: 'ReReview', additionalProperties: false },
);

const IntentSchema = Type.Object(
  {
    servesIntent: Type.Boolean(),
    detail: Type.String({ minLength: 1 }),
    redFlags: Type.Array(Type.String({ minLength: 1 })),
  },
  { $id: 'IntentAssessment', additionalProperties: false },
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

/**
 * Sample the plan audit and require UNANIMITY to reject (R33 AC-0).
 *
 * The house pattern for an unreliable model judgement, following the admission
 * gate (`d678cd8c`) and the decompose-or-delegate gate (`890cdea5`). Unanimity
 * is required in the SAFE direction, and here the safe direction is passing: a
 * false rejection surrenders a mission that would have succeeded, while a false
 * pass is still caught downstream by Gate B on the actual work.
 *
 * Measured need, not caution: on live mission d55b7f62 the evaluative model
 * rejected an ordinary two-way split as non-atomic on both attempts, the same
 * over-rejection that gave the clarity judge its 58% false-bounce rate.
 *
 * A throwing sample counts as "no complaint" — it produced no finding, and
 * treating an outage as a rejection would be the unsafe direction.
 */
/**
 * Sample the intent tier and require UNANIMITY to condemn (R34 AC-0/AC-2).
 *
 * The house pattern again (`d678cd8c`, `890cdea5`, R33's plan audit), and the
 * measured need is specific. On live mission e7dddf91 the evaluative model
 * returned red flags that were the PROMPT'S OWN EXAMPLE PHRASES echoed back
 * verbatim - "an answer shaped like a verification rather than an answer" - on
 * both attempts. It was completing a pattern, not inspecting a deliverable.
 *
 * The prompt no longer offers phrasings to copy and now demands each flag quote
 * the deliverable, but a prompt fix alone is a hope. Unanimity makes a
 * one-sample fluke unable to discard work on its own.
 *
 * Safe direction is PASSING, because a red flag now discards work that
 * otherwise satisfied every criterion: a false flag throws away good work
 * outright, while a missed one leaves work that already passed both other
 * tiers. A throwing sample counts as no complaint.
 */
export function sampledIntent(judge: IntentJudge, samples: number): IntentJudge {
  return {
    async assess(input) {
      const runs = await Promise.all(
        Array.from({ length: samples }, async () => {
          try {
            return await judge.assess(input);
          } catch {
            return null;
          }
        }),
      );

      const real = runs.filter((r): r is NonNullable<typeof r> => r !== null);
      if (real.length === 0) return { servesIntent: true, detail: 'intent tier unavailable', redFlags: [] };

      const condemned = real.filter((r) => !r.servesIntent);
      const servesIntent = condemned.length < real.length;

      // A flag survives only if every sample raised it. Compared on normalised
      // text, since two samples rarely word the same observation identically.
      const norm = (f: string) => f.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '');
      const counts = new Map<string, { flag: string; n: number }>();
      for (const run of real) {
        const seen = new Set<string>();
        for (const flag of run.redFlags) {
          const k = norm(flag);
          if (seen.has(k)) continue;
          seen.add(k);
          const entry = counts.get(k) ?? { flag, n: 0 };
          entry.n += 1;
          counts.set(k, entry);
        }
      }

      return {
        servesIntent,
        // A verdict's reason must match its outcome. Taking the first sample's
        // detail unconditionally could hand a PASSING verdict the reason of the
        // one sample that wanted to condemn — an operator reading "misses the
        // point" on a pass has been told the opposite of what happened.
        detail:
          (servesIntent
            ? real.find((r) => r.servesIntent)?.detail
            : condemned[0]?.detail) ?? 'no detail given',
        redFlags: [...counts.values()].filter((e) => e.n === real.length).map((e) => e.flag),
      };
    },
  };
}

export function sampledPlanAudit(judge: PlanJudge, samples: number): PlanJudge {
  return {
    async audit(input) {
      const runs = await Promise.all(
        Array.from({ length: samples }, async () => {
          try {
            return await judge.audit(input);
          } catch {
            return null;
          }
        }),
      );

      const real = runs.filter((r): r is NonNullable<typeof r> => r !== null);
      if (real.length === 0) {
        return {
          tasks: input.children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'not audited' })),
          untestable: [],
          overlaps: [],
        };
      }

      // A task is non-atomic only if EVERY sample said so. The detail kept is
      // the first dissent-free explanation, so the verdict carries a reason a
      // re-split can act on rather than a bare flag.
      const tasks = input.children.map((child) => {
        const verdicts = real.map((r) => r.tasks.find((t) => t.taskId === child.taskId));
        const allSayCompound =
          verdicts.length === real.length && verdicts.every((v) => v !== undefined && !v.atomic);
        return {
          taskId: child.taskId,
          atomic: !allSayCompound,
          detail: verdicts.find((v) => v !== undefined && !v.atomic)?.detail ?? 'atomic',
        };
      });

      const unanimous = <T>(pick: (r: NonNullable<(typeof real)[number]>) => readonly T[], key: (t: T) => string) => {
        const counts = new Map<string, { item: T; n: number }>();
        for (const run of real) {
          // Distinct within a run, so one sample repeating itself cannot pass
          // for agreement between samples.
          const seen = new Set<string>();
          for (const item of pick(run)) {
            const k = key(item);
            if (seen.has(k)) continue;
            seen.add(k);
            const entry = counts.get(k) ?? { item, n: 0 };
            entry.n += 1;
            counts.set(k, entry);
          }
        }
        return [...counts.values()].filter((e) => e.n === real.length).map((e) => e.item);
      };

      return {
        tasks,
        untestable: unanimous((r) => r.untestable, (u) => `${u.taskId}::${u.criterionId}`),
        overlaps: unanimous((r) => r.overlaps, (o) => [...o.taskIds].sort().join('+')),
      };
    },
  };
}

/**
 * The two seams the science loop needs to run a candidate (ADR-0017).
 *
 * Built here rather than in `index.ts` because `AnswerSchema` and
 * `CompletionSchema` live here with the model seam, and a second copy of either
 * would let a candidate be asked for a different shape than a real worker is —
 * which would make the bench measure the schema rather than the change.
 *
 * The judge is the SAME completion judge Gate B uses, at the evaluative tier.
 * Judging a replay more cheaply than the original verdict would compare a
 * candidate against a standard the recorded outcome never had to meet.
 */
export function createCandidateSeams(generator: StructuredGenerator, models: RuntimeModels) {
  const gen = (
    m: { provider: string; model: string },
    schema: unknown,
    prompt: string,
  ): Promise<unknown> => generator.generate({ provider: m.provider, model: m.model, probe: { schema, prompt } });

  return {
    generator: {
      async answer(input: {
        readonly roleInstructions: string;
        readonly objective: string;
        readonly criteria: readonly string[];
      }): Promise<unknown> {
        // The candidate's patched instructions go FIRST, where a design's role
        // instructions sit for a real worker — the position is part of what is
        // under test, not a formatting choice.
        return (await gen(models.worker, AnswerSchema, [
          input.roleInstructions,
          '',
          'Answer the task so that EVERY acceptance criterion below is satisfied.',
          '',
          `TASK: ${input.objective}`,
          'ACCEPTANCE CRITERIA (you are graded on exactly these):',
          ...input.criteria.map((c) => `  - ${c}`),
        ].join('\n'))) as unknown;
      },
    },
    judge: {
      async meetsAll(input: {
        readonly objective: string;
        readonly criteria: readonly { readonly criterionId: string; readonly statement: string }[];
        readonly deliverable: unknown;
      }): Promise<boolean> {
        const out = (await gen(models.evaluator, CompletionSchema, [
          'Judge whether the delivered work meets EACH acceptance criterion.',
          'Assess every one, and use only the ids given.',
          '',
          `TASK: ${input.objective}`,
          'ACCEPTANCE CRITERIA:',
          ...input.criteria.map((c) => `  - ${c.criterionId}: ${c.statement}`),
          '',
          `DELIVERED: ${JSON.stringify(input.deliverable)}`,
        ].join('\n'))) as { criteria?: { criterionId: string; met: boolean }[] };

        const assessed = out.criteria ?? [];
        // Every criterion must be assessed AND met. A judge that returned a
        // subset would otherwise pass a candidate on the criteria it happened to
        // mention, which is how a partial answer becomes a win.
        const byId = new Map(assessed.map((c) => [c.criterionId, c.met]));
        return input.criteria.every((c) => byId.get(c.criterionId) === true);
      },
    },
  };
}

/**
 * What a worker needs in order to ACT (R13).
 *
 * Narrower than the {@link ActionBroker} on purpose: the seam carries no ledger
 * sink and no mission id, so the work seam cannot append an event of its own.
 * Every action reaches the trail through the broker or not at all, which is what
 * makes "the sole action channel" a structural claim rather than a convention.
 */
export interface ToolInvoker {
  /** What this build can run — intersected with the contract's grants by the caller. */
  readonly available: readonly ToolSpec[];
  invoke(input: {
    readonly agentId: string;
    readonly contract: WorkerContractView;
    readonly toolId: string;
    readonly args: Record<string, unknown>;
    readonly occurredAt: string;
  }): Promise<ActionRecord>;
}

/**
 * The agent's request to run a tool over its own draft.
 *
 * `useTool` is asked explicitly rather than inferred from a present `toolId`,
 * so "no tool would help" is an answer the model gives rather than one it gives
 * by omission — a missing field is indistinguishable from a model that lost
 * track of the schema.
 */
const ToolRequestSchema = Type.Object(
  {
    useTool: Type.Boolean({ description: 'True only if running a tool would change what you submit.' }),
    toolId: Type.Optional(Type.String({ description: 'Which tool to run; omit when useTool is false.' })),
  },
  { additionalProperties: false },
);

export function createMissionSeams(
  generator: StructuredGenerator,
  models: RuntimeModels,
  control?: ControlSignals,
  registry?: RegistryLookup,
  commons?: KnowledgeCommonsSubmitter,
  fastLoop?: FastLoopSeam,
  templates?: DecompositionTemplateSeam,
  context?: ContextStore,
  bench?: SealedBenchReader,
  tools?: ToolInvoker,
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
    ...(commons === undefined ? {} : { commons }),
    ...(fastLoop === undefined ? {} : { fastLoop }),
    ...(templates === undefined ? {} : { templates }),
    ...(context === undefined ? {} : { context }),

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
      async execute({ contract, agentId, occurredAt }) {
        /**
         * Effort, MEASURED (the chain behind `e758f460` / `cb939996`).
         *
         * This was a hardcoded `1`, and that one constant was load-bearing in
         * four places: R40's effort floor only binds for floors >= 2 while the
         * intake default is 1; R34's mechanical tier compares it to the ceiling
         * and could never trip; R37's pedigree reported `spent: 1` per task on
         * every live mission; and no task could exceed its ceiling, so
         * `budget_exhaustion` was unemittable and `agent_redesign` unreachable.
         *
         * Derived, not invented: the model-router does not surface token usage,
         * so the honest unit is the number of MODEL CALLS this task made — the
         * unit the codebase already implies, since `self-critique.ts` adds its
         * own calls to the same total.
         *
         * Counted per EXECUTION, not per process: a shared counter would make
         * every later task look costlier than the one before, and the ceiling
         * would trip on position rather than on cost.
         *
         * A FAILED call still counts. Charging only for successes would make a
         * task that burned its budget on failures look cheap — exactly backwards,
         * since the budget bounds what was SPENT, not what worked.
         */
        let calls = 0;
        const spend = async <T>(work: Promise<T>): Promise<T> => {
          calls += 1;
          return work;
        };
        // The worker MUST be shown its acceptance criteria — they are the spec.
        // Prompting with the objective alone was the P9 bug: the planner wrote
        // criteria the worker never aimed at, and Gate B correctly failed it.
        const out = (await spend(gen(models.worker, AnswerSchema, [
          'Answer the task so that EVERY acceptance criterion below is satisfied.',
          '',
          `TASK: ${contract.objective}`,
          'ACCEPTANCE CRITERIA (you are graded on exactly these):',
          ...contract.acceptanceCriteria.map((c) => `  - ${c.statement}`),
        ].join('\n')))) as { answer: string };

        // ---- the agent may now ACT on its own answer (R13 AC-0) -------------
        // Offered only what this contract was actually granted. The broker would
        // refuse anything else and log the denial, but showing an agent a tool it
        // cannot use invites it to spend a call discovering that.
        //
        // Placed AFTER the draft on purpose: the tools this build carries check
        // properties OF an answer, and there is nothing to check before one
        // exists. A tool that gathered material would belong before it — the
        // seam takes both, the roadmap decides which arrive.
        const actionRecords: ActionRecord[] = [];
        let revised = out.answer;
        const offered = (tools?.available ?? []).filter((spec) =>
          contract.inputs.toolEntitlements.some((grant) => grant.toolId === spec.toolId),
        );

        if (tools !== undefined && offered.length > 0) {
          // Failure is swallowed at every step below. A tool is an improvement to
          // an answer that already exists; losing the answer because the agent
          // fumbled the optional part would trade the work for the assistance.
          try {
            const ask = (await spend(gen(models.worker, ToolRequestSchema, [
              'You have drafted an answer. You may run ONE tool over it before submitting,',
              'or submit as it stands.',
              '',
              'TOOLS AVAILABLE:',
              ...offered.map((t) => `  - ${t.toolId}: ${t.description}`),
              '',
              'ACCEPTANCE CRITERIA (you are graded on exactly these):',
              ...contract.acceptanceCriteria.map((c) => `  - ${c.statement}`),
              '',
              `YOUR DRAFT ANSWER: ${out.answer}`,
              '',
              'The tool runs over the draft above. Set useTool false if no tool would',
              'change what you submit.',
            ].join('\n')))) as { useTool?: boolean; toolId?: string };

            if (ask.useTool === true && typeof ask.toolId === 'string') {
              // Through the broker, always. An agent that called the tool
              // directly would produce an unlogged side effect, which is the one
              // thing invariant #1 does not permit — and the reason this is a
              // broker rather than a library.
              // The agent decides WHETHER to measure; the system decides WHAT is
              // measured (defect `a08e6fee`).
              //
              // The model used to supply the text. Measured over five live
              // invocations: two supplied something that could not settle any
              // criterion — once its own draft *including the counts it had
              // hallucinated*, once the literal string "Caption and Summary
              // combined." in place of the content — and the other three passed
              // draft-like content. A first reading of only three of those calls
              // said "zero for three"; the fuller sample says two in five, and
              // the smaller number is recorded here rather than the tidier one.
              //
              // Two in five is still a failure rate for an input the agent has
              // no reason to get right, and the argument for removing it does not
              // rest on the rate. It is the same principle as the tier policy,
              // which computes a model rather than letting the agent pick one: an
              // agent that chooses its own measurement subject can choose a
              // flattering one. Removing the field makes that structural — it
              // cannot pass the wrong string if it cannot pass a string.
              const record = await tools.invoke({
                agentId,
                contract,
                toolId: ask.toolId,
                args: { text: out.answer },
                occurredAt,
              });
              actionRecords.push(record);

              // The result is fed BACK. A measurement the agent never sees
              // changes nothing about the deliverable, and an action that cannot
              // change the deliverable is theatre — it would satisfy the ledger
              // criterion while leaving the work exactly as it was.
              const second = (await spend(gen(models.worker, AnswerSchema, [
                'Revise your answer if the tool result shows a criterion is not met.',
                'If it already holds, return your answer unchanged.',
                '',
                'ACCEPTANCE CRITERIA (you are graded on exactly these):',
                ...contract.acceptanceCriteria.map((c) => `  - ${c.statement}`),
                '',
                `YOUR DRAFT ANSWER: ${out.answer}`,
                `TOOL ${record.toolId} RETURNED: ${record.resultDigest}`,
              ].join('\n')))) as { answer?: string };
              if (typeof second.answer === 'string' && second.answer.length > 0) {
                revised = second.answer;
              }
            }
          } catch {
            // A denial is already on the ledger, written by the broker. Nothing
            // is recorded here, because a second record of one refusal would let
            // the trail double-count it.
          }
        }

        // Asked AFTER the answer exists, and about that specific answer — the
        // premises are a property of the work that was done, not of the task in
        // the abstract. Named concretely on purpose: asking for "any
        // assumptions" gets back a paraphrase of the task, while asking for the
        // questions you answered for yourself gets back what a reviewer needs.
        // A failure here loses a NICETY, not the work — the answer is already in
        // hand. `AssumptionsSchema` has always said so; the code did not, and a
        // throwing elicitation took the whole execution down with it. The call
        // is still CHARGED, because it was still spent.
        let declared: { assumptions?: string[] } = {};
        try {
          declared = (await spend(gen(models.worker, AssumptionsSchema, [
            'List your ASSUMPTIONS: questions the task left open that you answered for',
            'yourself in order to produce the answer below. State them so a stranger who',
            'watched none of the work can check them.',
            'If the task left nothing open, return an empty list — do not invent',
            'assumptions to fill it.',
            '',
            `TASK: ${contract.objective}`,
            `THE ANSWER YOU GAVE: ${revised}`,
          ].join('\n')))) as { assumptions?: string[] };
        } catch {
          declared = {};
        }

        return {
          deliverable: { answer: revised },
          // The structured record the broker produced, not a sentence about it
          // (R13 AC-2). This was a hardcoded `[]`, which is why `reviewer.ts:450`
          // — which fails a task that carried entitlements and produced no
          // actions — could only ever punish.
          actions: actionRecords,
          consulted: [],
          assumptions: declared.assumptions ?? [],
          effortSpent: calls,
        };
      },
    },

    /**
     * Gate A's semantic clauses (R33 AC-0) — atomicity, testability as written,
     * and scope overlap between siblings.
     *
     * EVALUATIVE tier, like the other gates: "is this task one responsibility"
     * is a judgement about the shape of the work, and fold-up taught us that
     * evaluative questions belong a tier above the doing (insight `1aad1dd5`).
     *
     * A failed audit is treated as a CLEAN plan rather than a rejected one. That
     * is deliberate and it is the safe direction here: the deterministic clauses
     * still ran, and letting a model outage reject every decomposition would
     * turn a transient failure into a mission that cannot be planned at all.
     * The gate degrades to what it can prove rather than to a refusal.
     */
    planJudge: sampledPlanAudit({
      async audit({ parent, children }) {
        const clean = {
          tasks: children.map((c) => ({ taskId: c.taskId, atomic: true, detail: 'not audited' })),
          untestable: [],
          overlaps: [],
        };

        try {
          const out = (await gen(models.evaluator, PlanAuditSchema, [
            'Audit this task decomposition. Answer only about the tasks listed.',
            '',
            'ATOMIC means the task carries exactly ONE responsibility with ONE verifiable',
            'outcome. A task that researches AND writes is not atomic.',
            '',
            'UNTESTABLE means a criterion does not name an observable outcome AS WRITTEN.',
            'The grader reads the words, so judge the words: "the output is good" is',
            'untestable, "the output states a temperature in Celsius" is testable.',
            '',
            'OVERLAP means two tasks would do the same WORK. Two tasks each doing part of',
            'one parent criterion is normal partitioning, NOT overlap.',
            '',
            `PARENT OBJECTIVE: ${parent.objective}`,
            'TASKS:',
            ...children.map(
              (c) =>
                `  ${c.taskId} — ${c.objective}` + NL +
                c.acceptanceCriteria.map((x) => `      ${x.criterionId}: ${x.statement}`).join(NL),
            ),
          ].join(NL))) as {
            tasks: Array<{ taskId: string; atomic: boolean; detail: string }>;
            untestable: Array<{ taskId: string; criterionId: string; detail: string }>;
            overlaps: Array<{ taskIds: string[]; detail: string }>;
          };

          // Only tasks the plan actually contains. A model naming a task that is
          // not in the decomposition is grading a different plan, and letting an
          // invented id fail the gate would be unfixable by any re-split.
          const known = new Set(children.map((c) => c.taskId));
          return {
            tasks: out.tasks.filter((t) => known.has(t.taskId)),
            untestable: out.untestable.filter((u) => known.has(u.taskId)),
            overlaps: out.overlaps.filter((o) => o.taskIds.every((id) => known.has(id))),
          };
        } catch {
          return clean;
        }
      },
    }, 3),

    /**
     * Gate B's semantic INTENT tier (R34 AC-0).
     *
     * EVALUATIVE tier, a rung above the doing: "does this serve what was
     * actually wanted" is a judgement about the work, not part of it.
     *
     * Asked SEPARATELY from the completion judge rather than as extra fields on
     * it. The two questions pull in opposite directions - one reads the letter,
     * one reads the spirit - and a single call invites the model to reconcile
     * them into one comfortable answer. It also keeps the worker schema narrow,
     * which is what tier-1 models handle reliably.
     *
     * A failed call is treated as "serves the intent, nothing flagged". Safe
     * direction: the criteria tier and the mechanical tier have both already
     * run, so a model outage degrades the gate to what it can still prove
     * rather than failing work that may be perfectly good.
     */
    intentJudge: sampledIntent({
      async assess({ contract, bundle }) {
        try {
          const out = (await gen(models.evaluator, IntentSchema, [
            'Judge whether this deliverable serves what was actually WANTED, not merely',
            'whether it satisfies the wording of the criteria. A deliverable can meet every',
            'stated criterion sentence by sentence and still miss the point.',
            '',
            'Also raise RED FLAGS only for STRUCTURAL suspicion about THIS deliverable:',
            'something about its shape that suggests it was built to pass review rather',
            'than to answer. Each flag must QUOTE the part of the deliverable that',
            'prompted it. A flag that could be written without reading the deliverable',
            'is not a finding.',
            'Return an empty list if nothing about it is structurally suspicious - which',
            'is the normal case. A red flag DISCARDS work that otherwise passed.',
            '',
            `OBJECTIVE: ${contract.objective}`,
            'CRITERIA:',
            ...contract.acceptanceCriteria.map((c) => `  - ${c.statement}`),
            `DELIVERABLE: ${JSON.stringify(bundle.deliverable)}`,
          ].join(NL))) as { servesIntent: boolean; detail: string; redFlags: string[] };

          return out;
        } catch {
          return { servesIntent: true, detail: 'intent tier unavailable', redFlags: [] };
        }
      },
    }, 3),

    /**
     * The reviewer measuring itself (R35 AC-0).
     *
     * The re-review is a SEPARATE call that judges from the objective and the
     * deliverable and is never shown the original verdict — showing it the answer
     * would make agreement the default and the measurement worthless.
     *
     * Sampling, not sweeping: the FIRST verdict of each mission. Deterministic
     * rather than random on purpose — `Math.random` would make a mission
     * unreplayable, and replay-by-trail is how this system resumes (R41).
     * Calibration is a trend across missions; re-reviewing everything would
     * double the cost of verification to learn what a sample already tells us.
     *
     * HONEST LIMIT: this runs on the same evaluative model as the original
     * reviewer, because the Model Catalog has no third tier configured. That is
     * weaker independence than a different model would give — it catches noise
     * and inconsistency, but a model wrong the same way twice will agree with
     * itself. That specific blind spot is what the PROBES (AC-1) exist for, and
     * why `627cd71c` was logged rather than assumed solved.
     */
    calibration: {
      /**
       * Known-answer probes, drawn from the SEALED bench (R35 AC-1).
       *
       * The sealed slice's documented purpose is exactly this — "used to
       * evaluate amendment petitions and to calibrate the Reviewer" — so
       * reading it here is the grant working, not a leak. What R25 forbids is
       * the LEARNING AGENT seeing it, and the learner's reader is bound to the
       * open view.
       *
       * An empty bench yields no probes. That is the ordinary state of a young
       * system, not a fault, and the calibration simply reports none planted.
       */
      async probes() {
        if (bench === undefined) return [];
        try {
          const cases = await bench.sealedCases();
          return plantProbes(cases.map((c) => ({
            caseId: c.caseId,
            contract: c.contract as TaskContract,
            verifiedOutcome: c.verifiedOutcome,
          })));
        } catch {
          return [];
        }
      },
      async sample(issued) {
        const target = issued[0];
        if (target === undefined) return [];

        try {
          const out = (await gen(models.evaluator, ReReviewSchema, [
            'You are a SECOND, independent reviewer. Judge only whether the work below',
            'does what the task asked. You have not been told what the first reviewer',
            'decided, and you should not try to infer it.',
            '',
            `TASK: ${target.objective ?? 'unknown'}`,
            `DELIVERABLE: ${JSON.stringify(target.deliverable)}`,
          ].join(NL))) as { met: boolean; detail: string };

          return [{
            taskId: target.taskId,
            outcome: out.met ? ('pass' as const) : ('fail' as const),
            // A DIFFERENT reviewer id, or `calibrationOf` refuses the re-review
            // as non-independent — which is exactly the check working.
            reviewerId: 'calibration-re-reviewer',
          }];
        } catch {
          // A measurement that fails is a missing measurement, not a failure.
          return [];
        }
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
