/**
 * The escalation ladder's two missing halves (R36).
 *
 * `ErrorClassSchema` has always said its class "selects the escalation rung",
 * and nothing ever read it for that: the loop advanced `rungIndex += 1`
 * unconditionally, so a task that was *specified* wrong was retried verbatim —
 * rehearsing, at a higher price each time, the mistake it had just been told
 * about. `stallLimit` was likewise copied from parent to child and read nowhere.
 *
 * Two rules that sound contradictory and are not:
 *
 *   - the **entry** rung is a function of the error class (R36 AC-0/AC-1);
 *   - every failure *after* that climbs exactly one rung (the loop's own
 *     invariant #2).
 *
 * They constrain different moments. A task jumps to where its failure belongs
 * and then walks from there — and never walks back to a cheaper remedy it has
 * already been told will not work.
 */
import type { ErrorClass, EscalationRung } from '@artifex/shared-types';

/**
 * Which rung a failure of this class *belongs* at, cheapest-first by name.
 *
 * Named rungs rather than indexes, because a contract's ladder is its own: a
 * mission may authorise only `['retry_same', 'retry_higher_tier']`, and the
 * entry rung must be one it actually granted.
 *
 * The reasoning per class, since these are judgements and not arithmetic:
 *
 *   `specification_fault`   the task was described wrong. No amount of trying
 *                           harder fixes a wrong description; the plan is what
 *                           has to change.
 *   `coordination_failure`  the plan claimed these pieces would compose and they
 *                           did not. Retrying either piece alone cannot discover
 *                           the seam between them — that is also a plan fault.
 *   `capability_gap`        the agent cannot do this. The same agent retried is
 *                           the same agent, so a retry is a rehearsal; another
 *                           agent is the cheapest thing that could work.
 *   `schema_violation`      a formatting failure, not a thinking one. A bigger
 *                           model holds structure better, and that is the whole
 *                           remedy — measured repeatedly on tier 1.
 *   `budget_exhaustion`     no retry can afford it. The cheap rungs all spend
 *                           more of the thing that just ran out.
 *   `execution_error`       an ordinary slip. Rung 1 with the verdict as
 *                           feedback is exactly what the ladder starts with.
 *   `stall`                 the same attempt is repeating. Something about WHO
 *                           or WHAT runs has to change, so a plain retry is the
 *                           one remedy guaranteed not to help.
 *
 * `verification_failure` is deliberately absent: it means the check itself
 * could not be completed, which says nothing about why. Falling through to rung
 * 1 is the honest response to a diagnosis nobody has made.
 */
const RUNG_FOR_CLASS: Partial<Record<ErrorClass, EscalationRung>> = {
  specification_fault: 're_decomposition',
  coordination_failure: 're_decomposition',
  capability_gap: 'different_agent',
  schema_violation: 'retry_higher_tier',
  budget_exhaustion: 'agent_redesign',
  stall: 'different_agent',
  execution_error: 'retry_same',
};

/**
 * The index in THIS contract's ladder where a failure of this class enters.
 *
 * Returns an index rather than a rung so the caller cannot accidentally take a
 * remedy the contract withheld: a mapped rung the ladder does not contain falls
 * back to rung 0, because a contract that granted only cheap remedies did not
 * silently grant the expensive ones.
 */
export function entryRungFor(errorClass: ErrorClass, ladder: readonly EscalationRung[]): number {
  const wanted = RUNG_FOR_CLASS[errorClass];
  if (wanted === undefined) return 0;

  const index = ladder.indexOf(wanted);
  return index === -1 ? 0 : index;
}

/** One attempt, as far as "was this the same attempt again" is concerned. */
export interface AttemptSignature {
  readonly tier: number;
  readonly designId: string;
  readonly errorClasses: readonly ErrorClass[];
}

/**
 * Has this task been attempted the same way `limit` times in a row? (R36 AC-2)
 *
 * "The same way" is deliberately structural — same tier, same design, same
 * failure classes. A tier bump or a new agent changed what ran, and a DIFFERENT
 * failure means the task moved: it now fails somewhere else, which is
 * information the next attempt can use. Neither is a stall, and treating them
 * as one would trip on exactly the mechanisms meant to break stalls.
 *
 * Only the most recent run of identical attempts counts. Matching anywhere in
 * history would trip on a task that repeated itself early and has since moved
 * on, punishing it for a rut it already climbed out of.
 */
export function isStalled(history: readonly AttemptSignature[], limit: number): boolean {
  if (limit < 1 || history.length < limit) return false;

  const key = (a: AttemptSignature) => `${a.tier}::${a.designId}::${[...a.errorClasses].sort().join(',')}`;
  const latest = key(history[history.length - 1]!);

  let run = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (key(history[i]!) !== latest) break;
    run += 1;
  }

  return run >= limit;
}

/**
 * The class among a verdict's findings that should choose the entry rung.
 *
 * The WORST, meaning the one whose remedy sits highest on this ladder. A verdict
 * naming both a specification fault and an ordinary slip has told us the task is
 * specified wrong; entering at the slip's cheap rung would retry a description
 * we already know to be broken, and the slip would very likely recur because its
 * cause was never addressed.
 *
 * Returns null for an empty list, so the caller falls back to a plain one-rung
 * step rather than to a rung nobody diagnosed.
 */
export function worstClass(
  classes: readonly ErrorClass[],
  ladder: readonly EscalationRung[],
): ErrorClass | null {
  return classes.reduce<ErrorClass | null>(
    (worst, cls) =>
      worst === null || entryRungFor(cls, ladder) > entryRungFor(worst, ladder) ? cls : worst,
    null,
  );
}
