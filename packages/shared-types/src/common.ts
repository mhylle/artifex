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

/** Who performed an act. Every ledger event is attributable. */
export const ACTOR_KINDS = [
  'orchestrator',
  'agent_creator',
  'reviewer',
  'learning_agent',
  'context_broker',
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
