/**
 * Measuring the reviewer (R35).
 *
 * Every gate in Artifex is a model asked a question, and the constitution says
 * the learner does not own the yardstick. Nothing, though, ever checked the
 * yardstick itself: a verdict was issued once and never compared against a
 * second opinion, and rubber-stamping was assumed away rather than measured.
 *
 * Three mechanisms, which fail differently on purpose:
 *
 *   {@link calibrationOf}  re-review a sample, record DISAGREEMENT. Catches a
 *                          reviewer that is inconsistent with itself.
 *   {@link probeMisses}    inject work whose answer is known, record a MISS.
 *                          Catches what calibration cannot — a reviewer that is
 *                          consistently wrong in the same direction agrees with
 *                          itself perfectly, and unanimity sampling (ADR-0010)
 *                          is silent for exactly the same reason (`627cd71c`).
 *                          Only a known answer catches that.
 *   {@link independenceViolation}  the verifier must not be the producer.
 *
 * All three return MEASUREMENTS, never verdicts. A calibration result that could
 * overturn a gate would put the yardstick in the business of overruling the
 * thing it measures.
 */

export interface IssuedVerdict {
  readonly taskId: string;
  readonly outcome: 'pass' | 'fail';
  readonly reviewerId: string;
  readonly verdictId: string;
  /**
   * What the task was asked to do, and what it produced.
   *
   * A re-reviewer needs the WORK, not just a verdict id. A first version of this
   * interface carried only ids, which meant the only thing a second opinion
   * could be formed from was the first opinion — and agreement would then have
   * measured nothing but obedience.
   *
   * Optional so a caller that only wants to compare two existing verdict sets
   * (a replay, a bench) is not forced to reconstruct payloads it already has.
   */
  readonly objective?: string;
  readonly deliverable?: unknown;
}

export interface ReReview {
  readonly taskId: string;
  readonly outcome: 'pass' | 'fail';
  readonly reviewerId: string;
}

export interface Calibration {
  /** How many verdicts actually got an independent second opinion. */
  readonly compared: number;
  readonly disagreements: number;
  /** `null` when nothing was compared — 0/0 is not 100%. */
  readonly agreementRate: number | null;
  readonly disagreed: ReadonlyArray<{
    readonly taskId: string;
    readonly original: 'pass' | 'fail';
    readonly reReview: 'pass' | 'fail';
  }>;
  /** Re-reviews that could not be used, and why. */
  readonly refused: ReadonlyArray<{ readonly taskId: string; readonly reason: string }>;
}

/**
 * Compare issued verdicts against independent re-reviews (R35 AC-0).
 *
 * Two rules do the work here, and both exist because the comfortable answer is
 * the wrong one:
 *
 *   - a verdict with no re-review is NOT counted as agreement. Silence is not
 *     agreement — the same rule Gate A applies to an unassessed criterion — and
 *     counting it would make a reviewer that is never sampled look perfect.
 *   - a re-review from the ORIGINAL reviewer is refused. A reviewer agreeing
 *     with itself measures nothing, and would report a flawless rate precisely
 *     when the reviewer is most consistently wrong.
 */
export function calibrationOf(
  issued: readonly IssuedVerdict[],
  reReviews: readonly ReReview[],
): Calibration {
  const byTask = new Map(issued.map((v) => [v.taskId, v]));
  const disagreed: Array<{ taskId: string; original: 'pass' | 'fail'; reReview: 'pass' | 'fail' }> = [];
  const refused: Array<{ taskId: string; reason: string }> = [];
  let compared = 0;

  for (const re of reReviews) {
    const original = byTask.get(re.taskId);
    if (original === undefined) continue;

    if (original.reviewerId === re.reviewerId) {
      refused.push({ taskId: re.taskId, reason: 'the re-review came from the original reviewer' });
      continue;
    }

    compared += 1;
    if (original.outcome !== re.outcome) {
      disagreed.push({ taskId: re.taskId, original: original.outcome, reReview: re.outcome });
    }
  }

  return {
    compared,
    disagreements: disagreed.length,
    agreementRate: compared === 0 ? null : (compared - disagreed.length) / compared,
    disagreed,
    refused,
  };
}

/** Work planted in the review stream whose correct verdict is already known. */
export interface Probe {
  readonly taskId: string;
  readonly expected: 'pass' | 'fail';
}

/**
 * Probes the reviewer got wrong (R35 AC-1).
 *
 * Scored in BOTH directions. Rubber-stamping — passing planted bad work — is the
 * failure the criterion names, but reflexive rejection is the other, and it is
 * the one the tier-2 judges have actually shown (ADR-0010: a 58% false-bounce
 * rate, an ordinary split rejected as non-atomic, prompt examples returned as
 * red flags). A calibration that measured only leniency would have missed all
 * of it.
 *
 * A probe the reviewer never processed is not scored: it says nothing about the
 * reviewer, and counting it would punish it for work that never arrived.
 */
export function probeMisses(
  probes: readonly Probe[],
  issued: readonly IssuedVerdict[],
): ReadonlyArray<{ taskId: string; expected: 'pass' | 'fail'; actual: 'pass' | 'fail' }> {
  const byTask = new Map(issued.map((v) => [v.taskId, v]));

  return probes.flatMap((probe) => {
    const verdict = byTask.get(probe.taskId);
    if (verdict === undefined) return [];
    if (verdict.outcome === probe.expected) return [];
    return [{ taskId: probe.taskId, expected: probe.expected, actual: verdict.outcome }];
  });
}

/**
 * Why this verifier may not grade this producer, or null if it may (R35 AC-2).
 *
 * Lineage, not merely identity. Two designs promoted from one parent inherit its
 * prompt and its blind spots, so one grading the other is closer to self-review
 * than to independent verification — and the blind spot they share is exactly
 * the one neither will notice.
 *
 * Ancestry is passed in rather than looked up, so this stays a pure decision the
 * caller can test. The Asset Registry's recursive clade query already produces
 * it.
 *
 * KNOWN LIMITATION: nothing sets `parent_design_id` today (defect `cb939996`),
 * so no live design has recorded ancestry and only the identity half can fire in
 * production. Written now anyway, because the data is already modelled and a
 * check written when the producer arrives is a check written under pressure.
 */
export function independenceViolation(input: {
  readonly producerDesignId: string;
  readonly verifierDesignId: string;
  readonly producerAncestry?: readonly string[];
  readonly verifierAncestry?: readonly string[];
}): string | null {
  if (input.producerDesignId === input.verifierDesignId) {
    return `the verifier is the same design as the producer (${input.producerDesignId}) — that is self-review, not verification`;
  }

  const producerLine = new Set([input.producerDesignId, ...(input.producerAncestry ?? [])]);
  const shared = [input.verifierDesignId, ...(input.verifierAncestry ?? [])].filter((id) => producerLine.has(id));

  if (shared.length > 0) {
    return `the verifier shares design lineage with the producer (common ancestor ${shared.join(', ')}) — designs promoted from one parent inherit its blind spots`;
  }

  return null;
}
