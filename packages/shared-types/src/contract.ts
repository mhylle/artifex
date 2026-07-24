/**
 * The task contract — Artifex's atom.
 *
 * Invariant: *no work without a contract*. Nothing executes without acceptance
 * criteria, boundaries, stopping conditions, and a budget, authored by the level
 * above. The mission is task zero, so a mission is a contract too.
 *
 * The field set mirrors the "anatomy of a task contract" in the functional
 * design: each one exists to kill a documented failure mode.
 */
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

import {
  AutonomyDialSchema,
  BlastRadiusSchema,
  BudgetSchema,
  EscalationRungSchema,
  IdSchema,
  SlugIdSchema,
  TextSchema,
  TimestampSchema,
  VerificationDepthSchema,
} from './common.js';

/**
 * A testable condition, written before execution by the level above. The
 * Reviewer checks these — exactly these.
 */
export const AcceptanceCriterionSchema = Type.Object(
  {
    criterionId: SlugIdSchema,
    statement: TextSchema,
  },
  {
    additionalProperties: false,
    description: 'One testable acceptance condition, referenced by id in verdicts.',
  },
);
export type AcceptanceCriterion = Static<typeof AcceptanceCriterionSchema>;

/** What this task must NOT do, and which sibling owns each neighbouring concern. */
export const BoundariesSchema = Type.Object(
  {
    outOfScope: Type.Array(TextSchema),
    siblingOwners: Type.Array(
      Type.Object(
        { concern: TextSchema, taskId: IdSchema },
        { additionalProperties: false },
      ),
    ),
  },
  {
    additionalProperties: false,
    description: 'Anti-scope; kills overlap, duplication and scope creep across siblings.',
  },
);

/**
 * Everything the worker is entitled to, plus parent-made cross-cutting choices
 * it must honour — the decisions that otherwise surface at fold-up, expensively.
 */
export const InputsSchema = Type.Object(
  {
    entitlements: Type.Array(TextSchema),
    pinnedDecisions: Type.Array(
      Type.Object(
        { id: SlugIdSchema, decision: TextSchema },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

/** Which sibling outputs this task consumes, and what it may request via the broker. */
export const DependenciesSchema = Type.Object(
  {
    consumesTaskIds: Type.Array(IdSchema),
    mayRequest: Type.Array(TextSchema),
  },
  { additionalProperties: false },
);

/** What "done" looks like AND what "stop trying" looks like. */
export const StoppingConditionsSchema = Type.Object(
  {
    doneWhen: Type.Array(TextSchema, { minItems: 1 }),
    stopTryingWhen: Type.Array(TextSchema, { minItems: 1 }),
    maxAttempts: Type.Integer({ minimum: 1 }),
    stallLimit: Type.Integer({ minimum: 1 }),
  },
  {
    additionalProperties: false,
    description: 'Kills step repetition and unaware-of-stopping-conditions loops.',
  },
);

/** Which ladder applies, and where the human sits per the autonomy dial. */
export const EscalationPolicySchema = Type.Object(
  {
    ladder: Type.Array(EscalationRungSchema, { minItems: 1 }),
    humanAt: Type.Union([EscalationRungSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

/**
 * Verification depth for this task, set by blast radius.
 *
 * Constitutionally *never* exposed to the executing worker in gameable detail —
 * a contract handed down to a worker must have this stripped (enforced where the
 * Context Broker serves contracts, not by this schema).
 */
export const VerificationPlanSchema = Type.Object(
  {
    depth: VerificationDepthSchema,
    requiredAgreement: Type.Union([Type.Integer({ minimum: 2 }), Type.Null()]),
  },
  {
    additionalProperties: false,
    description: 'Reviewer-only. Never shown to the executing worker in gameable detail.',
  },
);

export const TaskContractSchema = Type.Object(
  {
    // Lineage — full trail back to task zero. The contract id is also the key
    // into the ledger, which is what makes attribution and replay possible.
    taskId: IdSchema,
    missionId: IdSchema,
    parentTaskId: Type.Union([IdSchema, Type.Null()]),
    category: TextSchema,
    depth: Type.Integer({ minimum: 0 }),

    objective: TextSchema,
    acceptanceCriteria: Type.Array(AcceptanceCriterionSchema, { minItems: 1 }),
    boundaries: BoundariesSchema,
    inputs: InputsSchema,
    dependencies: DependenciesSchema,
    stoppingConditions: StoppingConditionsSchema,
    budget: BudgetSchema,
    escalationPolicy: EscalationPolicySchema,
    verificationPlan: VerificationPlanSchema,

    blastRadius: BlastRadiusSchema,
    /** Mission-level, fixed at intake on task zero and inherited by children. */
    autonomyDial: AutonomyDialSchema,
    createdAt: TimestampSchema,
  },
  {
    $id: 'TaskContract',
    additionalProperties: false,
    description:
      'The unit of delegated work. No task executes without one; the mission is task zero.',
  },
);
export type TaskContract = Static<typeof TaskContractSchema>;
