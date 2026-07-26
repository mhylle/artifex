/**
 * The reflection record — what a worker's self-critique pass produced (R12).
 *
 * Reflection improves a deliverable; it never rules on one. That boundary is
 * structural here, not documentary: this schema declares no `gate`, no
 * `outcome` and no `verdictId`, and because it is a closed object those fields
 * cannot be smuggled in at runtime either. A reflection record is *incapable*
 * of being mistaken for a Verdict, which is what keeps review independence
 * (invariants #3 and #4) intact while still getting the cheap self-review win.
 *
 * The pass critiques against the task's acceptance criteria only — never the
 * verification plan, which `WorkerContractView` withholds by construction.
 */
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

import { IdSchema, SelfAssessmentSchema, SlugIdSchema, TextSchema, TimestampSchema } from './common.js';

/** One criterion, as the author judged their own draft against it. */
export const CritiqueSchema = Type.Object(
  {
    /** References an `AcceptanceCriterion.criterionId` from the contract. */
    criterionId: SlugIdSchema,
    assessment: SelfAssessmentSchema,
    note: TextSchema,
  },
  {
    // No `$id` on embedded sub-schemas — ajv rejects registering an id twice.
    additionalProperties: false,
    description: "A worker's self-assessment of one acceptance criterion.",
  },
);
export type Critique = Static<typeof CritiqueSchema>;

export const ReflectionRecordSchema = Type.Object(
  {
    reflectionId: IdSchema,
    /**
     * The ledger event holding the pre-reflection draft. Carrying a pointer
     * rather than a second copy of the deliverable keeps the bundle small and
     * makes both versions recoverable by replay (R12 AC-0) — the same pointer
     * discipline the ledger's NOTIFY payload uses.
     */
    priorDraftEventId: IdSchema,
    critiques: Type.Array(CritiqueSchema, { minItems: 1 }),
    /** Whether the critique actually changed the deliverable. */
    revised: Type.Boolean(),
    /**
     * Charged against the task contract's existing budget — there is no second
     * budget and no separate cap (ADR-0007). Recording the cost here is what
     * lets the Learning Agent ask whether reflection pays for itself.
     */
    effortSpent: Type.Number({ minimum: 0 }),
    performedAt: TimestampSchema,
  },
  {
    additionalProperties: false,
    description:
      'The output of a self-critique pass. Never a verdict: no gate, no outcome, no verdict id.',
  },
);
export type ReflectionRecord = Static<typeof ReflectionRecordSchema>;
