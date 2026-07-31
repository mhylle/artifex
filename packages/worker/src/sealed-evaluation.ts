/**
 * Evaluating a petition against the sealed bench (R29 AC-0, second clause).
 *
 * `evaluateOnSealedBench` in `petition.ts` already decides the hard parts — it
 * refuses a non-sealed case rather than filtering it, requires unanimity, and
 * calls an empty set `unevaluated` rather than the arithmetic 100% that zero of
 * zero would give. It had no production caller, because nothing decided the one
 * thing it cannot: whether a given sealed case ARGUES FOR the petition.
 *
 * That decision is derived from recorded data, never asked of a model. Today the
 * only petition `petitionFromWeakSpots` will produce is the budget-versus-value
 * outlier, so support means the sealed case's own source task hit the same bar
 * the weak-spot ranking uses — `NEAR_CEILING` of its contract's ceiling.
 *
 * **This rule is specific to that petition kind, and deliberately so.** A second
 * kind would need its own support rule; reusing this one would score a petition
 * against a criterion it is not about, which is the sort of quiet mismatch that
 * makes a measurement look like evidence.
 */
import { evaluateOnSealedBench } from './petition.js';
import type { SealedEvaluation } from './petition.js';
import { NEAR_CEILING } from './science-loop.js';

/** A sealed bench case, as the store returns it plus the spend it was banked from. */
export interface ScorableCase {
  readonly caseId: string;
  readonly slice: 'open' | 'sealed';
  readonly capability: string;
  readonly contract: unknown;
  readonly verifiedOutcome: unknown;
  /** Effort the source task actually spent, absent when nothing recorded it. */
  readonly effortSpent?: number | undefined;
}

/** The sealed slice, and the spend each case was banked from. */
export interface SealedCaseSource {
  sealedCases(): Promise<readonly ScorableCase[]>;
}

/**
 * Does this sealed case argue for a budget-versus-value petition?
 *
 * Only if it ran at or over the ceiling itself. Absent spend and absent ceiling
 * both answer NO: an unmeasured case does not argue either way, and treating a
 * missing ceiling as "spent everything" would let the dogfood stub still sitting
 * in the live sealed slice — contract `{"o": "sealed case"}`, no budget at all —
 * cast a unanimous vote to amend the Constitution.
 */
export function supportsBudgetPetition(scorable: ScorableCase): boolean {
  const ceiling = (scorable.contract as { budget?: { ceiling?: unknown } } | undefined)?.budget?.ceiling;
  if (typeof ceiling !== 'number' || ceiling <= 0) return false;
  if (typeof scorable.effortSpent !== 'number') return false;

  return scorable.effortSpent / ceiling >= NEAR_CEILING;
}

/**
 * Score a petition against the sealed cases of the capability it argues about.
 *
 * Matched on CATEGORY because a petition is about one capability: sealed cases
 * from unrelated work say nothing about whether budget enforcement blocks the
 * remedy in *this* one, and counting them would dilute a real verdict with
 * evidence from somewhere else.
 *
 * Errors are NOT caught here. `evaluateOnSealedBench` throws when handed an open
 * case, and that refusal is the criterion's whole point — swallowing it would
 * turn "the learner cannot choose the slice" into a smaller, quieter count.
 */
export async function evaluatePetition(
  petition: { readonly title: string; readonly category: string },
  source: SealedCaseSource,
): Promise<SealedEvaluation> {
  const cases = await source.sealedCases();
  const relevant = cases.filter((c) => c.capability === petition.category);

  return evaluateOnSealedBench(
    { title: petition.title, rationale: '', missionId: '', evidenceEventIds: [], targets: 'constitution' },
    relevant.map((scorable) => ({
      case: { caseId: scorable.caseId, slice: scorable.slice },
      supportsPetition: supportsBudgetPetition(scorable),
    })),
  );
}
