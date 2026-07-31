/**
 * The constitutional amendment protocol (R29).
 *
 * Invariant #4 has two halves. R11 built the first — the learner may argue for
 * a change and cannot make one, enforced by a `ProposalEmitter` with no `apply`.
 * This is the second: how a petition is **evaluated** and **ratified**.
 *
 * The dossier's sentence is the whole specification — *"Petitions argued from
 * evidence, evaluated on the sealed bench, ratified out-of-band per the autonomy
 * dial."* Each clause is a rule here, and the middle one is load-bearing: R25
 * split the bench precisely because "nothing that optimizes against a benchmark
 * may also own it", and a petition scored on the OPEN slice would be graded on
 * the very cases the learner has been tuning against. That matters most here, of
 * all places, because a petition is a request to change the rules the system is
 * measured by.
 *
 * Pure. No I/O, no clock, no model — it decides, the loop and the store enact.
 */

export interface Petition {
  readonly missionId: string;
  readonly title: string;
  readonly rationale: string;
  /** Ledger events the petition is argued from. Never empty. */
  readonly evidenceEventIds: readonly string[];
  readonly targets: 'constitution';
}

/**
 * Why this petition cannot be filed, or null.
 *
 * Both refusals come straight from the dossier's wording. "Argued from evidence"
 * makes an unevidenced petition an opinion, and the emitter's own comment
 * already says as much about proposals; a petition with no rationale is not an
 * argument at all.
 */
export function petitionRefusal(petition: Petition): string | null {
  if (petition.evidenceEventIds.length === 0) {
    return 'a petition must carry the ledger evidence it is argued from — an unevidenced petition is an opinion';
  }
  if (petition.rationale.trim().length === 0) {
    return 'a petition must be argued — a rationale is what distinguishes a petition from a preference';
  }
  return null;
}

/** A bench case as the evaluator sees it. The slice is part of the case, not a caller's promise. */
export interface BenchCaseRef {
  readonly caseId: string;
  readonly slice: 'open' | 'sealed';
}

export interface SealedEvaluation {
  readonly evaluated: number;
  readonly supported: number;
  readonly verdict: 'supported' | 'unsupported' | 'unevaluated';
}

/**
 * Score a petition against the sealed bench (R29 AC-0).
 *
 * **Throws on an open case rather than filtering it.** Silently dropping the
 * open slice would let a caller believe a thirty-case evaluation happened when
 * three cases were scored — and the count is exactly what a reader would use to
 * judge how much the verdict is worth. A refusal is loud; a filter is a lie by
 * omission.
 *
 * Support must be **unanimous**. This is a change to the rules the system is
 * measured by, and ADR-0010's unanimity principle applies in the direction that
 * preserves the status quo: the conservative outcome for an amendment is not to
 * amend, so one sealed case arguing against leaves the Constitution alone.
 *
 * An empty bench is `unevaluated`, never `supported`. Zero of zero is 100% by
 * arithmetic and nothing by evidence, and a petition that "passed" an empty
 * bench would be the strongest possible argument built on no measurement.
 */
export function evaluateOnSealedBench(
  petition: Petition,
  results: ReadonlyArray<{ readonly case: BenchCaseRef; readonly supportsPetition: boolean }>,
): SealedEvaluation {
  const open = results.filter((r) => r.case.slice !== 'sealed');
  if (open.length > 0) {
    throw new Error(
      `petition "${petition.title}" was scored against ${open.length} non-sealed case(s) ` +
        `(${open.map((r) => r.case.caseId).join(', ')}) — a petition is evaluated on the SEALED bench, ` +
        'never on a slice the learner could have optimized against',
    );
  }

  const supported = results.filter((r) => r.supportsPetition).length;

  return {
    evaluated: results.length,
    supported,
    verdict: results.length === 0
      ? 'unevaluated'
      : supported === results.length
        ? 'supported'
        : 'unsupported',
  };
}

/** A recorded human decision about a petition. */
export interface RatificationDecision {
  readonly petitionId: string;
  readonly decision: 'ratified' | 'rejected';
  /** Who decided. Anything but a human leaves the petition pending. */
  readonly decidedBy: string;
}

export interface RatificationState {
  readonly status: 'pending' | 'ratified' | 'rejected';
  /** Why a decision was disregarded, when one was. */
  readonly refused: string | null;
}

/**
 * Has this petition been ratified out of band? (R29 AC-1)
 *
 * "Out-of-band" is the operative phrase and it is enforced here rather than
 * assumed: a decision recorded by the LEARNING AGENT is disregarded, because a
 * decision the proposer made for itself is not out-of-band by any reading. That
 * is invariant #4 in one predicate — no quantity of evidence lets the learner
 * ratify its own amendment.
 *
 * Anything without a decision stays `pending`, which is what "remains a proposal
 * until that decision is recorded" means: pending is the default, and the
 * absence of a decision is never read as consent.
 */
export function ratificationState(
  petitionId: string,
  decisions: readonly RatificationDecision[],
): RatificationState {
  for (const decision of decisions) {
    if (decision.petitionId !== petitionId) continue;

    if (decision.decidedBy === 'learning_agent') {
      return {
        status: 'pending',
        refused:
          'the decision was recorded by the learning agent — a petition is ratified out-of-band, ' +
          'and the proposer deciding for itself is not out-of-band',
      };
    }

    return { status: decision.decision, refused: null };
  }

  return { status: 'pending', refused: null };
}

/**
 * Should the Learning Agent petition to amend the Constitution? (R29 AC-0)
 *
 * A petition is warranted only where the learner's OWN authority cannot help.
 * It may rewrite prompts, playbooks and taxonomies freely, so a weak spot it
 * could address that way is not a constitutional matter — it is Tuesday.
 *
 * The one weak spot in this shape is the **budget-versus-value outlier**. When a
 * category spends near its ceiling and still surrenders, no prompt rewrite
 * reaches it: `budget_exhaustion` routes to `agent_redesign` (R36), the redesign
 * is produced but cannot be RUN because the ceiling is already blown
 * (ADR-0011), and budget enforcement is in the constitutional core where the
 * learner may argue and not act. That is precisely the situation the amendment
 * protocol exists for.
 *
 * DERIVED, not chosen: the trigger reads the weak spot's own recorded reasons
 * rather than a threshold invented here, and `NEAR_CEILING` already decided what
 * "near its ceiling" means (R27). A second number would be a second answer to a
 * question the science loop has already answered.
 *
 * Returns null when nothing warrants a petition, which is the ordinary case —
 * an amendment protocol that fired routinely would make the Constitution a
 * suggestion.
 */
export function petitionFromWeakSpots(input: {
  readonly missionId: string;
  readonly weakSpots: ReadonlyArray<{
    readonly category: string;
    readonly severity: number;
    readonly observations: number;
    readonly reasons: readonly string[];
  }>;
  readonly evidenceEventIds: readonly string[];
}): Petition | null {
  const budgetBound = input.weakSpots.find((spot) =>
    spot.reasons.some((r) => r.includes('budget-versus-value outlier')),
  );
  if (budgetBound === undefined) return null;

  // An unevidenced petition would be refused by `petitionRefusal` anyway; not
  // filing one is better than filing something that cannot be argued.
  if (input.evidenceEventIds.length === 0) return null;

  return {
    missionId: input.missionId,
    title: `Budget enforcement blocks remedy in "${budgetBound.category}"`,
    rationale:
      `Category "${budgetBound.category}" is a budget-versus-value outlier across ` +
      `${budgetBound.observations} observation(s): ${budgetBound.reasons.join('; ')}. ` +
      'No remedy within the learner\'s authority reaches this. budget_exhaustion routes to ' +
      'agent_redesign, and a task that overran its ceiling cannot afford to run the replacement — ' +
      'so the redesign is produced and never tried. Changing that means changing budget ' +
      'enforcement, which is constitutional and therefore argued rather than applied.',
    evidenceEventIds: [...input.evidenceEventIds],
    targets: 'constitution',
  };
}
