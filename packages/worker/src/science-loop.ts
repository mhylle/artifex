/**
 * The science loop (R27) — mine, hypothesize, experiment, replicate, adopt.
 *
 * R11 gave the Learning Agent a read-only projection and a propose-only
 * emitter, both per-mission. What was missing is the loop that turns many
 * missions into a ranked list of weak spots, tests candidates comparably, and
 * refuses to adopt anything on the strength of one good run.
 *
 * One idea applied four times: **evidence, not enthusiasm.** Rank from what the
 * ledger recorded rather than from a hunch; give every candidate the same budget
 * so the comparison means something; demand a result that reproduces; and demand
 * it hold on a slice it was never tuned against.
 *
 * All pure. The Learning Agent may propose, never enact (invariant #4), so
 * nothing here writes anywhere — it returns decisions for the constitutional
 * path to act on.
 */

/** What one mission contributes to the picture of a category. */
export interface MissionEvidence {
  readonly missionId: string;
  readonly category: string;
  readonly gateBAttempts: number;
  readonly gateBPasses: number;
  readonly escalations: number;
  readonly budgetSpent: number;
  readonly budgetCeiling: number;
  readonly surrendered: boolean;
}

export interface WeakSpot {
  readonly category: string;
  /** Higher is worse. Comparable only within one ranking. */
  readonly severity: number;
  /** How many missions this rests on — one bad mission is not a weak category. */
  readonly observations: number;
  /** Why it ranked, in words a human can check against the ledger. */
  readonly reasons: readonly string[];
}

/**
 * A category is weak when its pass rate is poor, when it only ever succeeds by
 * escalating, when it spends near its ceiling, or when it surrenders.
 *
 * Thresholds are the point of judgement here, and they are set where the
 * dossier's own language puts them rather than tuned: a pass rate below 3/4 is
 * "not reliably meeting its criteria"; more escalations than Gate B attempts
 * means the category typically needs more than one climb per verdict; and
 * spending 90% of the ceiling is the same figure R37's dossier uses to decide
 * budget was the constraint. Keeping them identical across the system matters
 * more than any one of them being optimal — two different definitions of
 * "expensive" would make the learning loop and the dossier disagree about the
 * same mission.
 */
const POOR_PASS_RATE = 0.75;
const NEAR_CEILING = 0.9;

/**
 * Rank weak spots across a mission history (R27 AC-0).
 *
 * Aggregated per CATEGORY across missions, never per mission: a single failure
 * is noise, and ranking per mission would promote whichever one happened to go
 * worst most recently. A healthy history ranks nothing — "always find something
 * to fix" sends the loop chasing noise forever.
 */
export function rankWeakSpots(history: readonly MissionEvidence[]): WeakSpot[] {
  const byCategory = new Map<string, MissionEvidence[]>();
  for (const entry of history) {
    byCategory.set(entry.category, [...(byCategory.get(entry.category) ?? []), entry]);
  }

  const spots: WeakSpot[] = [];

  for (const [category, entries] of byCategory) {
    const attempts = entries.reduce((n, e) => n + e.gateBAttempts, 0);
    const passes = entries.reduce((n, e) => n + e.gateBPasses, 0);
    const escalations = entries.reduce((n, e) => n + e.escalations, 0);
    const surrenders = entries.filter((e) => e.surrendered).length;

    const reasons: string[] = [];
    let severity = 0;

    // Surrender is the strongest signal: the category did not merely struggle,
    // it stopped.
    if (surrenders > 0) {
      severity += 3 * surrenders;
      reasons.push(`${surrenders} mission(s) surrendered in this category`);
    }

    const passRate = attempts === 0 ? 1 : passes / attempts;
    if (attempts > 0 && passRate < POOR_PASS_RATE) {
      severity += 2 * (1 - passRate);
      reasons.push(
        `compliance is ${passes}/${attempts} (${Math.round(passRate * 100)}%) — below the ${Math.round(POOR_PASS_RATE * 100)}% the category is expected to hold`,
      );
    }

    // Passing eventually, but only by climbing. Invisible in a pass rate, and
    // paid for every single time.
    if (attempts > 0 && escalations > attempts) {
      severity += escalations / attempts;
      reasons.push(`${escalations} escalations across ${attempts} verdicts — an escalation hot spot`);
    }

    // Counted PER MISSION, not pooled across the category (defect `d08191c8`).
    //
    // Pooling summed spend and ceiling and compared the totals, which hides the
    // pattern the criterion is about. Measured live: a mission that spent 100%
    // of its ceiling left `technical writing` pooling to 19/152 — about 12.5% —
    // so a category that blew its budget was invisible behind ten generous
    // missions and the amendment petition could never fire.
    //
    // This cannot lose a detection the pooled rule made, and that is provable
    // rather than hoped: the pooled ratio is a weighted average of the
    // per-mission ratios with weights `ceiling_i / Σceiling`, and a weighted
    // average never exceeds its largest term. So `Σspent/Σceiling >= 0.9`
    // implies some mission was already at or over 0.9. The old rule was a
    // strictly weaker form of this one, which is why it is replaced rather than
    // OR-ed — an OR would add a branch that can never be the only one taken.
    //
    // `NEAR_CEILING` is unchanged. What changed is the population the existing
    // bar is applied to, so no constant is invented here.
    const overSpending = entries.filter(
      (e) => e.budgetCeiling > 0 && e.budgetSpent / e.budgetCeiling >= NEAR_CEILING,
    );
    if (overSpending.length > 0) {
      // Weighted by how many missions, matching the surrender rule above: one is
      // an incident, five is the pattern an amendment would be argued from.
      severity += overSpending.length;
      const worst = overSpending.reduce((a, b) =>
        b.budgetSpent / b.budgetCeiling > a.budgetSpent / a.budgetCeiling ? b : a,
      );
      reasons.push(
        `${overSpending.length} of ${entries.length} mission(s) spent at least ` +
          `${Math.round(NEAR_CEILING * 100)}% of budget (worst: ${worst.budgetSpent} of ` +
          `${worst.budgetCeiling}) — a budget-versus-value outlier`,
      );
    }

    if (reasons.length === 0) continue;

    spots.push({ category, severity, observations: entries.length, reasons });
  }

  return spots.sort((a, b) => b.severity - a.severity);
}

export interface ExperimentSlot {
  readonly candidateId: string;
  readonly budget: number;
  readonly cases: readonly string[];
}

/**
 * Plan an experiment so heterogeneous candidates stay comparable (R27 AC-1).
 *
 * Same budget and the SAME cases for every candidate. A different bench is a
 * different exam, and a different budget is a different exam sat under different
 * conditions — either one produces numbers that look comparable and are not.
 *
 * Refuses rather than approximating. An uneven split still yields a score, and
 * a score nobody can trust is worse than no score because nobody notices.
 */
export function experimentPlan(
  candidates: readonly string[],
  options: { readonly totalBudget: number; readonly benchCases: readonly string[] },
): ExperimentSlot[] {
  if (options.benchCases.length === 0) {
    throw new Error('cannot experiment against an empty bench — zero cases scores every candidate perfectly');
  }

  const per = options.totalBudget / candidates.length;
  if (!Number.isInteger(per) || per <= 0) {
    throw new Error(
      `a budget of ${options.totalBudget} does not divide evenly across ${candidates.length} candidates — ` +
      `an uneven split makes the comparison meaningless while still producing numbers`,
    );
  }

  return candidates.map((candidateId) => ({
    candidateId,
    budget: per,
    cases: options.benchCases,
  }));
}

export interface CandidateRun {
  readonly won: boolean;
  readonly slice: 'open' | 'sealed';
}

export interface CandidateResult {
  readonly candidateId: string;
  /** Runs on the OPEN bench — the slice the candidate may be tuned against. */
  readonly runs: readonly CandidateRun[];
  /** The held-out run, on a slice it was never tuned against. Null if never run. */
  readonly heldOut: CandidateRun | null;
}

export interface AdoptionDecision {
  readonly adopt: boolean;
  readonly reason: string;
  /**
   * Kept whether or not it was adopted.
   *
   * The half people forget: a rejected candidate is a MEASUREMENT, and throwing
   * it away means the next hypothesis re-runs the same experiment. Knowing a
   * candidate failed the held-out slice is the most useful thing about it — it
   * says the idea does not transfer, which is a different finding from it being
   * weak.
   */
  readonly evidence: {
    readonly candidateId: string;
    readonly wins: number;
    readonly losses: number;
    readonly heldOutWon: boolean | null;
  };
}

/** At least this many independent wins before a result counts as reproduced. */
const REPLICATIONS_REQUIRED = 2;

/**
 * Decide whether a measured win earns swarm-wide adoption (R27 AC-2, AC-3).
 *
 * Two independent bars, and both must clear:
 *
 *   - **it replicates.** One win is a coin landing well. The ladder, the gates
 *     and the admission gate all already treat a single sample as insufficient;
 *     adoption is the most consequential decision in the system and gets at
 *     least the same care.
 *   - **it holds out.** Winning only where it was tuned is the definition of
 *     overfitting, and the sealed slice (R25) exists precisely to catch it.
 *     Absent is not a pass: a candidate with no held-out run has sat one exam.
 */
export function adoptionDecision(result: CandidateResult): AdoptionDecision {
  const wins = result.runs.filter((r) => r.won).length;
  const losses = result.runs.length - wins;

  const evidence = {
    candidateId: result.candidateId,
    wins,
    losses,
    heldOutWon: result.heldOut === null ? null : result.heldOut.won,
  };

  if (wins < REPLICATIONS_REQUIRED) {
    return {
      adopt: false,
      reason:
        `won ${wins} time(s) — a single lucky run adopts nothing, and ${REPLICATIONS_REQUIRED} independent wins ` +
        `are needed before a result counts as replicated`,
      evidence,
    };
  }

  if (losses > 0) {
    return {
      adopt: false,
      reason: `won ${wins} and lost ${losses} — an inconsistent result is noise, not a measured win`,
      evidence,
    };
  }

  if (result.heldOut === null) {
    return {
      adopt: false,
      reason: 'it was never run on a held-out slice — an untested slice is not a passed one',
      evidence,
    };
  }

  if (!result.heldOut.won) {
    return {
      adopt: false,
      reason:
        'it failed the held-out slice it was not tuned against — winning only where it was tuned is overfitting',
      evidence,
    };
  }

  return {
    adopt: true,
    reason: `replicated across ${wins} runs and held on a slice it was not tuned against`,
    evidence,
  };
}
