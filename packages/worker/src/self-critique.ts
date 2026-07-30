/**
 * The worker self-critique pass (R12, ADR-0006/0007).
 *
 * A specialist critiques its own draft against its acceptance criteria and may
 * revise it, *before* the evidence bundle reaches the Reviewer. The economic
 * argument is Artifex's own: Gate B commonly runs a tier **above** the worker,
 * so paying a Tier-2 rejection plus an escalation rung to catch what a same-tier
 * self-pass would have caught is a bad trade under invariant #7.
 *
 * Everything here is shaped by one constraint: **self-review must never become
 * self-verification.** ADR-0006 warned that a reflection feature would drift into
 * a second, non-independent Reviewer, so:
 *
 *   - the pass emits a `ReflectionRecord`, which by construction has no `gate`,
 *     `outcome` or `verdictId` and cannot acquire them;
 *   - `gateBRequired` is returned as an unconditional `true`, so there is no
 *     branch in which a "clean" critique short-circuits review;
 *   - the pass critiques against `acceptanceCriteria` and is handed a
 *     `WorkerContractView`, so it never sees the verification plan it would
 *     otherwise learn to satisfy instead of the objective.
 */
import { WorkerContractViewSchema, validate } from '@artifex/shared-types';
import type {
  EvidenceBundle,
  LedgerEventInput,
  ReflectionRecord,
  SelfAssessment,
  WorkerContractView,
} from '@artifex/shared-types';

export interface CritiqueJudge {
  assess(input: {
    readonly contract: WorkerContractView;
    readonly draft: EvidenceBundle;
  }): Promise<{
    readonly critiques: ReadonlyArray<{
      readonly criterionId: string;
      readonly assessment: SelfAssessment;
      readonly note: string;
    }>;
    /** Null when the critique found nothing worth changing. */
    readonly revisedDeliverable: unknown | null;
    readonly effortSpent: number;
  }>;
}

export interface SelfCritiqueResult {
  readonly bundle: EvidenceBundle;
  /**
   * True when a proposed revision was DISCARDED because it broke a criterion the
   * critique itself had just marked met (defect `cd677737`).
   */
  readonly regressionRejected: boolean;
  readonly event: LedgerEventInput;
  /**
   * Always `true`. Present as a value rather than an assumption so the call site
   * reads as a fact about the system, and so a future change that tried to make
   * it conditional would have to fight an explicit test.
   */
  readonly gateBRequired: true;
}

export async function selfCritique(input: {
  readonly contract: WorkerContractView;
  readonly draft: EvidenceBundle;
  readonly judge: CritiqueJudge;
  readonly reflectionId: string;
  /** The ledger event holding the pre-reflection draft. */
  readonly priorDraftEventId: string;
  readonly performedAt: string;
  /**
   * Optional second look at the REVISION (defect `cd677737`).
   *
   * Observed live: a correct critique produced a destructive repair — it fixed
   * the unmet criterion and broke one it had just marked met, turning "22% in
   * 2024" into "5% in [Source Name]". Since R12's justification is economic —
   * a cheap self-pass beats a Gate B rejection — a regressing pass inverts the
   * argument: it spends budget to make the work worse and still pays for the
   * rejection.
   *
   * The guard invents no threshold: it re-checks only the criteria the critique
   * ITSELF marked met, and discards the revision if any of them broke. Optional
   * because it costs another judge call; without it the previous behaviour
   * stands, so this is opt-in hardening rather than a silent block.
   */
  readonly recheck?: CritiqueJudge;
}): Promise<SelfCritiqueResult> {
  const { contract, draft, judge, reflectionId, priorDraftEventId, performedAt, recheck } = input;

  const viewCheck = validate(WorkerContractViewSchema, contract);
  if (!viewCheck.ok) {
    throw new Error(
      `self-critique refused the contract: it is not a worker view (reflection must never see the verification plan) — ${viewCheck.errors
        .map((e) => e.message)
        .join('; ')}`,
    );
  }

  const { critiques, revisedDeliverable, effortSpent } = await judge.assess({ contract, draft });

  // Same rule the Reviewer applies: a judge inventing criteria is critiquing a
  // different task, and a reflection built on invented criteria would revise the
  // deliverable toward a standard nobody agreed to.
  const known = new Set(contract.acceptanceCriteria.map((c) => c.criterionId));
  const invented = critiques.filter((c) => !known.has(c.criterionId)).map((c) => c.criterionId);
  if (invented.length > 0) {
    throw new Error(
      `self-critique named criteria not in the contract (${invented.join(', ')}) — it is critiquing a different task`,
    );
  }

  let revised = revisedDeliverable !== null;
  let regressionRejected = false;

  if (revised && recheck !== undefined) {
    const previouslyMet = critiques.filter((c) => c.assessment === 'met').map((c) => c.criterionId);
    if (previouslyMet.length > 0) {
      const second = await recheck.assess({
        contract,
        draft: { ...draft, deliverable: revisedDeliverable },
      });
      const broke = second.critiques.some(
        (c) => previouslyMet.includes(c.criterionId) && c.assessment !== 'met',
      );
      if (broke) {
        // Keep the draft. A revision that trades one satisfied criterion for
        // another is not an improvement, and reflection must not be able to
        // make the work worse on its own authority.
        revised = false;
        regressionRejected = true;
      }
    }
  }

  const reflection: ReflectionRecord = {
    reflectionId,
    priorDraftEventId,
    critiques: critiques.map((c) => ({ ...c })),
    revised,
    effortSpent,
    performedAt,
  };

  const bundle: EvidenceBundle = {
    ...draft,
    deliverable: revised ? revisedDeliverable : draft.deliverable,
    reflection,
    // Reflection spends the contract's EXISTING budget — there is no second
    // budget and no separate cap (ADR-0007). Its cost is attributed here, which
    // is what makes "does reflection pay for itself?" an answerable question.
    effortSpent: draft.effortSpent + effortSpent,
  };

  const event: LedgerEventInput = {
    eventId: reflectionId,
    missionId: contract.missionId,
    taskId: contract.taskId,
    // `execution`, deliberately not `verification`: an internal execution step,
    // not a ruling. That keeps the verification family exclusively the
    // Reviewer's, putting "self-review is never self-verification" in the
    // taxonomy itself rather than only in prose.
    family: 'execution',
    type: 'reflection.pass_completed',
    actor: { kind: 'worker', id: draft.agentId, displayName: null },
    payload: {
      reflectionId, priorDraftEventId, revised, effortSpent,
      critiques: reflection.critiques,
      // Recorded so the Learning Agent can see reflection FAILING, not only
      // succeeding — a pass whose revisions keep getting rejected is evidence
      // that this seam is costing more than it returns.
      regressionRejected,
    },
    occurredAt: performedAt,
  };

  return { bundle, event, gateBRequired: true, regressionRejected };
}
