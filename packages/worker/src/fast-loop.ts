/**
 * The fast loop (R26) — bounded in-mission hot-fixes that auto-revert.
 *
 * The other half of the two-speed learning cadence. R27's science loop runs
 * BETWEEN missions: mine, hypothesize, experiment, replicate, transfer-test,
 * adopt by ratchet. This one runs while a mission is still running, which is
 * what makes each of its bounds load-bearing — there is no human in the way and
 * no pause in which to notice a mistake.
 *
 * The dossier's wording is the specification: *worker layer only, one change at
 * a time, logged as an experiment, auto-reverted if the failure rate doesn't
 * move.* Every clause of that sentence is a bound, and this module refuses to
 * soften any of them.
 *
 * This module is pure — no I/O, no clock, no model. It decides; the mission loop
 * and the store enact. That keeps the bounds testable as arithmetic rather than
 * as behaviour observed through three seams.
 */
import type { HotFixTarget } from './constitution.js';

/** One Gate B result, as the fast loop reads the live trail. */
export interface GateBOutcome {
  readonly taskId: string;
  readonly category: string;
  readonly criterionId: string;
  readonly passed: boolean;
}

/** A category failing Gate B repeatedly on ONE criterion — the fast loop's trigger. */
export interface HotSpot {
  readonly category: string;
  readonly criterionId: string;
  readonly failures: number;
  /** Every result seen for this pair, failures and passes alike. */
  readonly observations: number;
  readonly failureRate: number;
  /**
   * What this category fails at on its OTHER criteria, or null if it has none.
   *
   * The reference point the prediction is anchored to. If a category fails `c-1`
   * three times in four while its other criteria fail one time in ten, the
   * honest prediction is that a fix brings `c-1` toward the rate the same
   * category already achieves elsewhere — a figure the system has measured, not
   * one chosen to look ambitious.
   */
  readonly peerFailureRate: number | null;
}

/**
 * The hot spot worth patching, or null (AC-0's "given").
 *
 * Keyed on the PAIR. Counting failures per category would merge unrelated
 * criteria into one number and aim a patch at their sum; counting per criterion
 * would merge unrelated categories, because criterion ids are only unique within
 * a contract and every contract has a `c-1`.
 *
 * `repeatLimit` is the contract's own `stoppingConditions.stallLimit`, passed in
 * rather than defined here. That figure is already the system's answer to "how
 * many times is repeatedly?" — R36's stall counter uses it for the same
 * question about attempts. Inventing a second number would be two answers to
 * one question, and the second one would have no evidence behind it.
 */
export function detectHotSpot(
  outcomes: readonly GateBOutcome[],
  repeatLimit: number,
): HotSpot | null {
  const tally = new Map<string, { category: string; criterionId: string; failures: number; observations: number }>();

  for (const o of outcomes) {
    // JSON rather than a delimiter string: a category or criterion id containing
    // the delimiter would silently merge two distinct pairs into one tally.
    const key = JSON.stringify([o.category, o.criterionId]);
    const row = tally.get(key) ?? {
      category: o.category, criterionId: o.criterionId, failures: 0, observations: 0,
    };
    row.observations += 1;
    if (!o.passed) row.failures += 1;
    tally.set(key, row);
  }

  const rows = [...tally.values()];

  const qualifying = rows
    .filter((r) => r.failures >= repeatLimit)
    .map((r) => {
      // The same category's OTHER criteria — the reference the prediction is
      // anchored to. Pooled across those criteria rather than averaged per
      // criterion, so a criterion with one observation cannot outvote one with
      // thirty (the same weighting argument as the clade score in R28).
      const peers = rows.filter((p) => p.category === r.category && p.criterionId !== r.criterionId);
      const peerObservations = peers.reduce((n, p) => n + p.observations, 0);
      const peerFailures = peers.reduce((n, p) => n + p.failures, 0);

      return {
        ...r,
        failureRate: r.failures / r.observations,
        peerFailureRate: peerObservations === 0 ? null : peerFailures / peerObservations,
      };
    });

  if (qualifying.length === 0) return null;

  // The WORST, not the first. With one patch per firing, which one it is decides
  // everything, and taking whichever the map happened to yield first would make
  // the choice an artefact of iteration order.
  qualifying.sort((a, b) => b.failureRate - a.failureRate || b.failures - a.failures);
  return qualifying[0]!;
}

/** The design whose instructions the fast loop may rewrite — worker layer, by definition. */
export interface WorkerAsset {
  readonly designId: string;
  readonly roleInstructions: string;
}

export interface HotFixPatch {
  readonly target: HotFixTarget;
  readonly replacement: string;
}

export interface HotFixPlan {
  readonly category: string;
  readonly criterionId: string;
  /** Exactly one. The type says "many" so that a violation is a length assertion, not a compile error nobody sees. */
  readonly patches: readonly HotFixPatch[];
  readonly bounds: {
    /**
     * How many observations of THIS pair must accrue before the fix is judged.
     *
     * Derived: the number the baseline rests on, so before and after are
     * compared over equal evidence. A shorter window would call noise an effect;
     * a longer one would leave an unproven change in place longer than the
     * evidence that justified it.
     */
    readonly windowObservations: number;
  };
  readonly predictedEffect: {
    readonly baselineFailureRate: number;
    /**
     * The rate the fix predicts, DERIVED rather than chosen (ADR-0013).
     *
     * It is the rate this same category already achieves on its other criteria:
     * the fix claims the patched criterion will come down to what its peers
     * manage. That is a real, falsifiable prediction taken from data the system
     * has measured — not an ambition, and not an invented significance
     * threshold.
     *
     * When the category has no other criteria there is no reference, and the
     * prediction degrades to the weakest honest claim: strictly better than
     * baseline. Kept explicit rather than defaulting to some fraction of the
     * baseline, which would be exactly the invented constant this avoids.
     */
    readonly predictedFailureRate: number;
    /** Whether the prediction rests on peer evidence or is the bare direction. */
    readonly basis: 'peer_criteria' | 'strict_improvement';
  };
}

/**
 * One bounded worker-layer patch for this hot spot (AC-0's "then").
 *
 * The patch itself appends a criterion-specific instruction to the design's
 * role prompt. That is the smallest worker-layer change that can plausibly move
 * a criterion's failure rate, and it is reversible by construction: reverting is
 * restoring the string this function was handed.
 */
export function hotFixPlan(spot: HotSpot, asset: WorkerAsset): HotFixPlan {
  return {
    category: spot.category,
    criterionId: spot.criterionId,
    patches: [
      {
        target: { layer: 'worker', kind: 'role_instructions', assetId: asset.designId },
        replacement:
          `${asset.roleInstructions}\n\n` +
          `Before submitting, check this specifically: criterion ${spot.criterionId} ` +
          `has been the failing one on ${spot.failures} of the last ${spot.observations} ` +
          `attempts in this category. Address it explicitly in the deliverable.`,
      },
    ],
    bounds: { windowObservations: spot.observations },
    predictedEffect:
      // A peer rate that is not actually better than the baseline is no
      // prediction at all — it would let the fix "succeed" by staying put. Fall
      // back to the bare direction in that case rather than pretending.
      spot.peerFailureRate !== null && spot.peerFailureRate < spot.failureRate
        ? {
            baselineFailureRate: spot.failureRate,
            predictedFailureRate: spot.peerFailureRate,
            basis: 'peer_criteria' as const,
          }
        : {
            baselineFailureRate: spot.failureRate,
            predictedFailureRate: spot.failureRate,
            basis: 'strict_improvement' as const,
          },
  };
}

export interface RevertDecision {
  readonly windowClosed: boolean;
  readonly revert: boolean;
  readonly reason: string;
  readonly observedFailureRate: number | null;
}

/**
 * Keep or revert, once the window closes (AC-1).
 *
 * **Revert is the default.** Every path that is not a measured strict
 * improvement reverts:
 *
 *   - the rate got worse                → revert
 *   - the rate did not move             → revert
 *   - the window closed with no data    → revert
 *
 * The last one is the important one. Treating "no evidence against" as "evidence
 * for" is exactly how an unevaluated change becomes permanent, and a fast loop
 * that leaves changes behind is a slow loop with worse bookkeeping.
 *
 * An OPEN window decides nothing — it neither keeps nor reverts. Judging at the
 * first result would make the verdict a coin flip.
 *
 * The window closes when it FILLS **or when the mission ends**, whichever comes
 * first. The second half is not a convenience: a window that closes only by
 * filling never closes at all once the patched category stops appearing, so the
 * hot-fix would outlive the mission that made it — which is the one outcome AC-1
 * exists to prevent. A window closed early is under-evidenced, and
 * under-evidenced reverts.
 */
export function revertDecision(
  plan: HotFixPlan,
  since: readonly GateBOutcome[],
  opts: { readonly missionEnded?: boolean } = {},
): RevertDecision {
  // Only observations of the patched pair count. Letting an unrelated
  // category's passes fill the window would let any patch look successful by
  // being followed by unrelated good news.
  const relevant = since.filter(
    (o) => o.category === plan.category && o.criterionId === plan.criterionId,
  );

  const filled = relevant.length >= plan.bounds.windowObservations;

  if (!filled && opts.missionEnded !== true) {
    return {
      windowClosed: false,
      revert: false,
      reason:
        `window open: ${relevant.length} of ${plan.bounds.windowObservations} observations`,
      observedFailureRate: relevant.length === 0 ? null : relevant.filter((o) => !o.passed).length / relevant.length,
    };
  }

  if (relevant.length === 0) {
    return {
      windowClosed: true,
      revert: true,
      reason: 'window closed with no observations — an unmeasured change is not an improvement',
      observedFailureRate: null,
    };
  }

  if (!filled) {
    // Closed early by the mission ending. Some evidence, but not the evidence
    // the plan asked for, so it cannot clear the bar the plan set.
    return {
      windowClosed: true,
      revert: true,
      reason:
        `mission ended with the window under-filled (${relevant.length} of ` +
        `${plan.bounds.windowObservations}) — under-evidenced reverts`,
      observedFailureRate: relevant.filter((o) => !o.passed).length / relevant.length,
    };
  }

  const observed = relevant.filter((o) => !o.passed).length / relevant.length;
  // Measured against the BASELINE, not against the prediction. AC-1's revert
  // condition is its own sentence — "whose measured failure rate does not move"
  // — so a fix that moved the rate but fell short of an ambitious prediction has
  // not met the stated condition for reverting, and reverting it anyway would
  // discard a real improvement.
  //
  // The prediction is not wasted: it is recorded on the experiment, and a fix
  // that improved without reaching it is precisely the kind of partial result
  // R27's science loop exists to turn into a hypothesis.
  const improved = observed < plan.predictedEffect.baselineFailureRate;

  return {
    windowClosed: true,
    revert: !improved,
    reason: improved
      ? `failure rate fell from ${plan.predictedEffect.baselineFailureRate.toFixed(2)} to ${observed.toFixed(2)}`
      : `failure rate did not improve on ${plan.predictedEffect.baselineFailureRate.toFixed(2)} (observed ${observed.toFixed(2)})`,
    observedFailureRate: observed,
  };
}
