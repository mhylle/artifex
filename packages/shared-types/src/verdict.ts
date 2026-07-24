/**
 * The Reviewer's structured verdict.
 *
 * Invariant: *verify both ends* — Gate A audits the decomposition before any
 * execution, Gate B verifies completion against the contract afterwards. Every
 * verdict names the failed criterion, the failing step, and an error class from
 * the shared taxonomy: that record is what steers the escalation ladder and
 * feeds the learning loop.
 *
 * Verdicts are immutable once issued. That is a constitutional property enforced
 * by the append-only ledger, not something a schema can express.
 */
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

import {
  ErrorClassSchema,
  IdSchema,
  SlugIdSchema,
  StringEnum,
  TextSchema,
  TimestampSchema,
  VerificationDepthSchema,
} from './common.js';

export const GATES = ['A', 'B'] as const;
export const GateSchema = StringEnum(GATES, {
  description: 'A = atomicity/coverage before execution; B = completion against the contract.',
});
export type Gate = Static<typeof GateSchema>;

export const VERDICT_OUTCOMES = ['pass', 'fail'] as const;
export const VerdictOutcomeSchema = StringEnum(VERDICT_OUTCOMES);
export type VerdictOutcome = Static<typeof VerdictOutcomeSchema>;

/** One failed criterion, tied to the step that failed and its error class. */
export const VerdictFindingSchema = Type.Object(
  {
    criterionId: SlugIdSchema,
    errorClass: ErrorClassSchema,
    failingStep: Type.Union([TextSchema, Type.Null()]),
    detail: TextSchema,
  },
  {
    additionalProperties: false,
    description: 'A per-clause failure: which criterion, which step, which error class.',
  },
);
export type VerdictFinding = Static<typeof VerdictFindingSchema>;

export const VerdictSchema = Type.Object(
  {
    verdictId: IdSchema,
    taskId: IdSchema,
    gate: GateSchema,
    outcome: VerdictOutcomeSchema,
    reviewerId: IdSchema,
    /** The depth actually run, so reviewer rigour is itself measurable. */
    verificationDepth: VerificationDepthSchema,
    /** Empty on a pass; a fail must name at least one criterion (enforced by the Reviewer). */
    findings: Type.Array(VerdictFindingSchema),
    /**
     * Outputs discarded because their structure smells wrong even when the
     * criteria technically pass — suspiciously exact fits, missing work
     * products, verification-shaped answers.
     */
    redFlags: Type.Array(TextSchema),
    issuedAt: TimestampSchema,
  },
  {
    $id: 'Verdict',
    additionalProperties: false,
    description: 'An immutable structured verdict from Gate A or Gate B.',
  },
);
export type Verdict = Static<typeof VerdictSchema>;
