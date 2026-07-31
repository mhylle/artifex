/**
 * When a carried assumption starts to matter (R30 AC-2).
 *
 * *"Given the dial permits carrying a low-stakes ambiguity as a flagged
 * assumption, when that assumption later becomes load-bearing for a task's
 * outcome, then it is escalated at that moment rather than at delivery."*
 *
 * **The trigger is structural, and the alternative was measured and rejected.**
 * The plan was to match a flagged assumption against the assumptions a worker
 * declares for itself (R40). There is fuel for that — 105 of 240 `task.executed`
 * events carry declared assumptions — but they are free-text prose in the
 * worker's own words, and an intake question is free-text prose in the model's.
 * Matching one to the other by string or token overlap is the "measurement tool
 * that lies" shape, and this project's rule is to judge against criteria and
 * never diff strings. A model call could judge the pair honestly; it would also
 * cost a call per task to answer a question the system can already answer.
 *
 * Because every intake question is raised `about` a specific criterion, and the
 * coverage partition already assigns each mission criterion to the tasks that
 * will satisfy it, an ambiguity about `m-1` is load-bearing exactly when a task
 * carrying `m-1` produces its outcome. No model, no string matching, and the
 * moment is the task's rather than the delivery's.
 *
 * The bound, stated rather than implied: this fires when the ambiguity is about
 * a criterion the task is *responsible for*, which is not the same as proving
 * the work leaned on it. It is the strongest signal available without asking a
 * model, and it errs toward telling the operator — an assumption about the
 * criterion being graded is worth surfacing even if the worker happened not to
 * need it.
 */

/** A low-stakes ambiguity the dial permitted carrying into the run. */
export interface FlaggedAssumption {
  /** The criterion or field the question was raised about. */
  readonly about: string;
  readonly question: string;
  readonly stakes: 'low' | 'high';
}

/**
 * Which carried assumptions just became load-bearing for this task.
 *
 * `alreadyEscalated` holds the `about` keys that have been raised before.
 * "Escalated at that moment" is a moment, singular: a second task covering the
 * same criterion must not re-raise it, or the attention queue refills with an
 * item the operator has already been shown — the same rule the escalation ladder
 * applies with `prior.decided`.
 */
export function loadBearingNow(
  flagged: readonly FlaggedAssumption[],
  taskCriterionIds: readonly string[],
  alreadyEscalated: ReadonlySet<string>,
): FlaggedAssumption[] {
  return flagged.filter(
    (assumption) =>
      !alreadyEscalated.has(assumption.about) && taskCriterionIds.includes(assumption.about),
  );
}
