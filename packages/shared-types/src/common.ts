/**
 * Shared primitives and vocabularies used across the Artifex schemas.
 *
 * Every vocabulary here is drawn from the functional design (`solution/`) or an
 * ADR — none are invented. They are deliberately *closed* enums: the escalation
 * ladder, the tier policy, and the learning loop all key off these values, so a
 * free-text field would push the failure into a query nobody writes.
 */
import { Type } from '@sinclair/typebox';
import type { SchemaOptions, Static, TSchema } from '@sinclair/typebox';

/**
 * A closed string vocabulary rendered as `{ type: 'string', enum: [...] }`.
 *
 * TypeBox's `Type.Union([Type.Literal(...)])` renders as `anyOf`/`const`, which
 * several structured-output backends handle worse than a plain `enum` — and
 * these schemas are handed to models verbatim (ADR-0004).
 */
export function StringEnum<const T extends readonly string[]>(
  values: T,
  options: SchemaOptions = {},
): TSchema & { static: T[number] } {
  return Type.Unsafe<T[number]>({ type: 'string', enum: [...values], ...options });
}

/** A system-assigned entity id. */
export const IdSchema = Type.String({ format: 'uuid' });

/**
 * An id authored alongside the thing it names (e.g. an acceptance criterion),
 * rather than assigned by the system — so it is a readable slug, not a UUID.
 * Verdicts reference these, which is what makes per-clause compliance a lookup.
 */
export const SlugIdSchema = Type.String({ minLength: 1 });

/** A non-empty human-authored string. */
export const TextSchema = Type.String({ minLength: 1 });

/** An ISO-8601 instant. */
export const TimestampSchema = Type.String({ format: 'date-time' });

/**
 * The two categories Artifex assigns to a contract itself, rather than reading
 * from a planner's proposal.
 *
 * Every other category is free text the planner invented at runtime, and the
 * whole capability taxonomy is deliberately open (R23/R38). These two are not:
 * intake stamps `MISSION_CATEGORY` on task zero, and the Agent Creator derives
 * `VERIFICATION_CATEGORY_PREFIX + <capability>` for every verifier it staffs.
 *
 * They live here because two packages need the same answer. The API writes the
 * mission category, the worker filters on it, and a literal in each would let a
 * rename pass silently — which is the two-sites-keying-on-different-versions
 * shape that produced defect `340aa7de`.
 */
export const MISSION_CATEGORY = 'mission';
export const VERIFICATION_CATEGORY_PREFIX = 'verification.';

/**
 * How expensive being wrong here is. Drives the computed model tier (ADR-0002)
 * and the Reviewer's verification depth.
 */
export const BLAST_RADII = ['low', 'medium', 'high'] as const;
export const BlastRadiusSchema = StringEnum(BLAST_RADII, {
  description: 'Cost-of-error for this task; drives model tier and verification depth.',
});
export type BlastRadius = Static<typeof BlastRadiusSchema>;

/**
 * The per-mission autonomy dial — "from fully autonomous to closely supervised".
 * Governs budget-vs-blast-radius trade-offs and where the human sits on the
 * escalation ladder (ADR-0002).
 */
export const AUTONOMY_DIAL_SETTINGS = ['autonomous', 'checkpointed', 'supervised'] as const;
export const AutonomyDialSchema = StringEnum(AUTONOMY_DIAL_SETTINGS, {
  description: 'Per-mission autonomy setting, fixed at intake on task zero.',
});
export type AutonomyDial = Static<typeof AutonomyDialSchema>;

/**
 * The 4-tier ladder (ADR-0002). Tier is a *computed policy*, never a per-agent
 * constant; the Model Catalog maps a logical tier to a concrete model.
 */
export const LogicalTierSchema = Type.Integer({
  minimum: 0,
  maximum: 3,
  description: '0 = no LLM, 1 = local small, 2 = local mid, 3 = frontier (ADR-0002).',
});
export type LogicalTier = Static<typeof LogicalTierSchema>;

/**
 * Rungs of the failure-escalation ladder, cheapest first. A tier bump is itself
 * a rung; the rung chosen is driven by the error class in the verdict.
 */
export const ESCALATION_RUNGS = [
  'retry_same',
  'retry_higher_tier',
  'different_agent',
  'agent_redesign',
  're_decomposition',
  'human_review',
  'surrender',
] as const;
export const EscalationRungSchema = StringEnum(ESCALATION_RUNGS, {
  description: 'A rung of the escalation ladder, cheapest first.',
});
export type EscalationRung = Static<typeof EscalationRungSchema>;

/**
 * The shared error taxonomy. Every verdict finding carries one; it is what
 * steers the escalation ladder (e.g. a specification fault jumps straight to
 * re-decomposition rather than rehearsing the same mistake).
 */
export const ERROR_CLASSES = [
  'specification_fault',
  'capability_gap',
  'execution_error',
  'verification_failure',
  'coordination_failure',
  'stall',
  'budget_exhaustion',
  'schema_violation',
] as const;
export const ErrorClassSchema = StringEnum(ERROR_CLASSES, {
  description: 'Shared error taxonomy; selects the escalation rung and feeds learning.',
});
export type ErrorClass = Static<typeof ErrorClassSchema>;

/**
 * Verification depth, scaled to blast radius. Never shown to the executing
 * worker in gameable detail.
 */
export const VERIFICATION_DEPTHS = ['single', 'redundant', 'consistency'] as const;
export const VerificationDepthSchema = StringEnum(VERIFICATION_DEPTHS, {
  description: 'single check / independent redundant runs / consistency-across-runs.',
});
export type VerificationDepth = Static<typeof VerificationDepthSchema>;

/**
 * How consequential a tool is. Reading the world, computing over it, and
 * changing it are three different risks, so they are three different classes
 * (ADR-0007) — the three tool kinds ADR-0006 names: search, code execution, APIs.
 */
export const TOOL_RISK_CLASSES = ['read', 'compute', 'write'] as const;
export const ToolRiskClassSchema = StringEnum(TOOL_RISK_CLASSES, {
  description: 'Consequence class of a tool; bounded by blast radius, gated by the autonomy dial.',
});
export type ToolRiskClass = Static<typeof ToolRiskClassSchema>;

/**
 * How a brokered invocation ended. `denied` is a first-class outcome, not an
 * absence: a refused tool call is logged, never silently dropped.
 */
export const ACTION_OUTCOMES = ['ok', 'denied', 'error'] as const;
export const ActionOutcomeSchema = StringEnum(ACTION_OUTCOMES, {
  description: 'Result of a brokered tool invocation; `denied` is logged, never silent.',
});
export type ActionOutcome = Static<typeof ActionOutcomeSchema>;

/**
 * A worker's own read on one of its acceptance criteria during self-critique.
 *
 * Deliberately NOT the Verdict vocabulary (`pass`/`fail`): reflection improves a
 * deliverable, it never rules on one. Sharing the words would be the first step
 * toward sharing the authority (ADR-0007).
 */
export const SELF_ASSESSMENTS = ['met', 'unmet', 'uncertain'] as const;
export const SelfAssessmentSchema = StringEnum(SELF_ASSESSMENTS, {
  description: "A worker's own read on a criterion during self-critique. Never a verdict.",
});
export type SelfAssessment = Static<typeof SelfAssessmentSchema>;

/** Who performed an act. Every ledger event is attributable. */
export const ACTOR_KINDS = [
  'orchestrator',
  'agent_creator',
  'reviewer',
  'learning_agent',
  'context_broker',
  'action_broker',
  'worker',
  'human',
  'system',
] as const;
export const ActorKindSchema = StringEnum(ACTOR_KINDS);
export type ActorKind = Static<typeof ActorKindSchema>;

export const ActorSchema = Type.Object(
  {
    kind: ActorKindSchema,
    id: TextSchema,
    displayName: Type.Union([TextSchema, Type.Null()]),
  },
  {
    // No `$id` on embedded sub-schemas: they are inlined into several root
    // schemas, and ajv rejects registering the same id twice.
    additionalProperties: false,
    description: 'The attributable author of an act — agent, human operator, or the system.',
  },
);
export type Actor = Static<typeof ActorSchema>;

/**
 * Effort is a currency: budgets bind in both directions — a floor that prevents
 * drive-by shallow work, a ceiling that prevents runaway effort.
 */
export const BudgetSchema = Type.Object(
  {
    floor: Type.Number({ minimum: 0 }),
    ceiling: Type.Number({ minimum: 0 }),
    unit: TextSchema,
  },
  {
    additionalProperties: false,
    description: 'Effort budget floor and ceiling.',
  },
);
export type Budget = Static<typeof BudgetSchema>;
