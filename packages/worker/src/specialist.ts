/**
 * The Worker Swarm specialist — restate or bounce, never guess (R8 AC-3).
 *
 * A specialist reads its contract and restates it before doing anything. If the
 * restatement surfaces ambiguity, it **bounces** the task back rather than
 * picking an interpretation and running with it.
 *
 * That ordering is the point. An agent that guesses produces work that looks
 * finished and is wrong in a way nobody can see until fold-up, by which time
 * several siblings have consumed it. Bouncing costs one cheap round trip;
 * guessing costs the subtree.
 *
 * A specialist is handed a {@link WorkerContractView}, never a full contract —
 * the verification plan is withheld so it cannot optimise against its own grader.
 */
import { WorkerContractViewSchema, validate } from '@artifex/shared-types';
import type { EvidenceBundle, WorkerContractView } from '@artifex/shared-types';

export interface ClarityJudge {
  assess(input: { readonly contract: WorkerContractView }): Promise<{
    readonly restatement: string;
    /** Non-empty means bounce. Ambiguity is a property of the contract, not a mood. */
    readonly ambiguities: readonly string[];
  }>;
}

export interface SpecialistWork {
  execute(input: {
    readonly contract: WorkerContractView;
    readonly restatement: string;
    /**
     * Context the Context Broker granted for this task (invariant #6).
     *
     * Reaches the worker rather than only the ledger — a grant nobody reads is
     * a log line, not a channel. `null` when nothing was granted, which is every
     * task whose contract entitles it to nothing and every runtime with no
     * context store.
     */
    readonly priorKnowledge?: unknown;
    /**
     * Why the PREVIOUS attempt at this task was rejected (R36).
     *
     * The system reviews its own work and says precisely what was wrong, then
     * used to hand the retry the original contract and nothing else — so the
     * worker could not know it had failed, let alone why, and produced the same
     * kind of answer again while the ladder burned a rung.
     *
     * The same rule `decomposition.resplit` already applies one level up:
     * re-propose FROM the verdict, because re-proposing from the same objective
     * very often reproduces the same plan.
     *
     * Empty or absent on a first attempt, which must read as "no prior
     * failure" rather than as a failure nobody will explain.
     */
    readonly priorFindings?: readonly string[];
    /**
     * Who is acting, and when — required by the Action Broker (R13).
     *
     * The ritual already knows both; before this they stopped here, so a work
     * seam had no way to attribute an invocation even if it could make one. That
     * was the fourth of ADR-0015's missing links: not a missing broker, a
     * missing path to it.
     */
    readonly agentId: string;
    readonly occurredAt: string;
  }): Promise<{
    readonly deliverable: unknown;
    readonly actions: EvidenceBundle['actions'];
    readonly consulted: EvidenceBundle['consulted'];
    readonly assumptions: string[];
    readonly effortSpent: number;
  }>;
}

export type SpecialistOutcome =
  | { readonly kind: 'bounced'; readonly restatement: string; readonly ambiguities: readonly string[] }
  | {
      readonly kind: 'delivered';
      readonly restatement: string;
      readonly bundle: EvidenceBundle;
      /** Objections raised but set aside because the gate was bypassed (R36). */
      readonly overruled?: readonly string[];
    };

export async function runSpecialist(input: {
  readonly contract: WorkerContractView;
  readonly agentId: string;
  readonly judge: ClarityJudge;
  readonly work: SpecialistWork;
  readonly bundleId: string;
  readonly producedAt: string;
  /** What the broker granted, passed through to the work seam. */
  readonly priorKnowledge?: unknown;
  /** The sources it came from, recorded on the bundle (R40's `consulted`). */
  readonly consulted?: EvidenceBundle['consulted'];
  /** Why the previous attempt was rejected, carried to the work seam (R36). */
  readonly priorFindings?: readonly string[];
  /**
   * Do the work even if the clarity judge objects (R36).
   *
   * Set only after a bounce has already been answered by a clarification and
   * the judge has come back with a DIFFERENT objection. An objection that
   * cannot survive one rewrite is a fresh opinion, not a persistent defect, and
   * the measured false-bounce rate is 17-58% depending on model.
   *
   * Explicit rather than achieved by passing a judge that always agrees: the
   * decision to overrule belongs on the trail and in the caller, not hidden in
   * a stub. The judge still runs, and its objection is still returned, so
   * nothing is suppressed — only the refusal to work is.
   */
  readonly bypassClarityGate?: boolean;
}): Promise<SpecialistOutcome> {
  const { contract, agentId, judge, work, bundleId, producedAt } = input;

  // The worker view is a closed schema, so a full contract fails here rather
  // than being silently accepted. P2.5 made the withholding a guarantee; this is
  // where the swarm actually honours it.
  const viewCheck = validate(WorkerContractViewSchema, contract);
  if (!viewCheck.ok) {
    throw new Error(
      `specialist refused the contract: it is not a worker view (a worker must never see the verification plan) — ${viewCheck.errors
        .map((e) => e.message)
        .join('; ')}`,
    );
  }

  const { restatement, ambiguities } = await judge.assess({ contract });

  if (ambiguities.length > 0 && input.bypassClarityGate !== true) {
    // Bouncing does no work. "Bounce but try anyway" is just guessing with a
    // disclaimer attached, and the disclaimer is not what the parent needs.
    //
    // The bypass is not that. It is the caller saying this objection has
    // already been answered once and replaced with a different one, so it is no
    // longer evidence about the contract — see `bypassClarityGate`.
    return { kind: 'bounced', restatement, ambiguities: [...ambiguities] };
  }

  const result = await work.execute({
    contract, restatement, priorKnowledge: input.priorKnowledge, agentId, occurredAt: producedAt,
    ...(input.priorFindings === undefined ? {} : { priorFindings: input.priorFindings }),
  });

  return {
    kind: 'delivered',
    restatement,
    // Carried so the caller can record WHAT it overruled. The judge still ran
    // and still objected; only the refusal to work was set aside.
    ...(ambiguities.length > 0 ? { overruled: [...ambiguities] } : {}),
    bundle: {
      bundleId,
      taskId: contract.taskId,
      agentId,
      deliverable: result.deliverable,
      actions: result.actions,
      // Brokered sources joined with whatever the work consulted itself. Both
      // are real consultations, and recording only one understates the trail.
      consulted: [...(input.consulted ?? []), ...result.consulted],
      assumptions: result.assumptions,
      // Reflection is P8.6; present-and-null until then, never absent.
      reflection: null,
      effortSpent: result.effortSpent,
      producedAt,
    },
  };
}
