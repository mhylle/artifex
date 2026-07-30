/**
 * The mission loop — everything assembled (R9).
 *
 * decompose → **Gate A** → staff → execute → **Gate B** → fold up, with the
 * escalation ladder on failure. This is where the pieces built in P4–P8.6 stop
 * being components and become a system.
 *
 * Three properties this function exists to guarantee, none of which any single
 * component could:
 *
 *  1. **Gate A runs before anything executes.** "Verify both ends" means the
 *     decomposition is audited *before* budget is spent on it, so a mission whose
 *     plan does not cover its own criteria never reaches a worker.
 *  2. **One failure climbs exactly one rung.** The ladder is ordered cheapest
 *     first; jumping it wastes the cheap remedies, and skipping it means
 *     rehearsing the same failure forever.
 *  3. **Surrender is a first-class outcome.** A mission that cannot succeed
 *     produces a dossier of what blocked it — not a crash, and not a fabricated
 *     success. Bounded failure is why `stopTryingWhen` and `maxAttempts` exist.
 */
import type { EscalationRung, LedgerEventInput, LogicalTier, TaskContract } from '@artifex/shared-types';

import { staff } from './agent-creator.js';
import type { DesignAuthor, RegistryLookup } from './agent-creator.js';
import { decompose, foldUp } from './orchestrator.js';
import type { Planner, Reconciler } from './orchestrator.js';
import { gateA, gateB } from './reviewer.js';
import type { CompletionJudge, CoverageJudge } from './reviewer.js';
import { runSpecialist } from './specialist.js';
import type { ClarityJudge, SpecialistWork } from './specialist.js';

/**
 * Rewrites a contract the worker could not restate (defect `1e3905a4`).
 *
 * A bounce says the *specification* is unclear, so the only thing that can fix
 * it is changing the specification. Optional: without it the loop still climbs
 * the ladder and surrenders honestly, it just cannot repair the contract.
 */
export interface Clarifier {
  clarify(input: {
    readonly contract: TaskContract;
    readonly ambiguities: readonly string[];
  }): Promise<{
    readonly objective: string;
    readonly acceptanceCriteria: readonly { criterionId: string; statement: string }[] | null;
  }>;
}

export interface MissionSeams {
  readonly planner: Planner;
  readonly coverageJudge: CoverageJudge;
  readonly registry: RegistryLookup;
  readonly author: DesignAuthor;
  readonly clarityJudge: ClarityJudge;
  readonly work: SpecialistWork;
  readonly completionJudge: CompletionJudge;
  readonly reconciler: Reconciler;
  readonly clarifier?: Clarifier;
}

export interface Escalation {
  readonly taskId: string;
  readonly rung: EscalationRung;
  readonly fromTier: LogicalTier;
  readonly toTier: LogicalTier;
  readonly reason: string;
}

export interface MissionResult {
  readonly outcome: 'delivered' | 'surrendered';
  readonly deliverable: unknown;
  readonly trail: LedgerEventInput[];
  readonly escalations: Escalation[];
}

const FRONTIER_TIER = 3;

/** Either a subtree's assembled deliverable, or the surrender that ended it. */
type SubtreeOutcome =
  | { readonly ok: true; readonly deliverable: unknown }
  | { readonly ok: false; readonly result: MissionResult };

/**
 * Is this contract a leaf?
 *
 * Taken from the dossier's own definition rather than invented: splitting
 * continues "until each leaf carries exactly **one responsibility** with **one
 * verifiable outcome** — and no further". A contract with a single acceptance
 * criterion already has one verifiable outcome, so it is done being split.
 *
 * This also guarantees termination without a magic number: a split must
 * partition its parent's criteria, and one criterion cannot be partitioned.
 */
function isAtomic(contract: TaskContract): boolean {
  return contract.acceptanceCriteria.length <= 1;
}

export async function runMission(
  mission: TaskContract,
  seams: MissionSeams,
  options: {
    readonly now: string;
    /**
     * How many times to retry the SAME tier before spending an escalation rung
     * (defect `626f6596`). The ladder exists for *substantive* failure — work
     * that came back wrong. A backend hiccup is not that, and spending
     * `retry_higher_tier` on one burns a real remedy on a non-problem.
     *
     * It matters at scale rather than in the small: every leaf needs a model
     * call to survive, so with `n` leaves the failure probability compounds —
     * and fanning out is the direction this system is built to grow in.
     * Defaults to 1: enough to absorb a hiccup, not enough to hide a fault.
     */
    readonly transientRetries?: number;
    /**
     * Called for each event as it is recorded, so the trail can be persisted and
     * streamed while the mission runs rather than in a burst at the end.
     *
     * Defect `b3b4e554`: the worker appended `result.trail` only after this
     * function resolved, so a connected dashboard sat blind for the whole
     * mission and then jumped straight to the finished state. The dossier
     * promises events "streamed as they happen".
     *
     * Deliberately synchronous and failure-absorbing: the mission must not slow
     * to the speed of the ledger, and must not die because a subscriber threw.
     */
    readonly onEvent?: (event: LedgerEventInput) => void;
  },
): Promise<MissionResult> {
  const { now } = options;
  const transientRetries = options.transientRetries ?? 1;
  const trail: LedgerEventInput[] = [];
  const escalations: Escalation[] = [];
  let seq = 0;

  const record = (
    taskId: string,
    family: LedgerEventInput['family'],
    type: string,
    actorKind: LedgerEventInput['actor']['kind'],
    payload: Record<string, unknown>,
  ): void => {
    seq += 1;
    const event: LedgerEventInput = {
      eventId: `${mission.taskId.slice(0, 24)}${seq.toString(16).padStart(12, '0')}`,
      missionId: mission.missionId,
      taskId,
      family,
      type,
      actor: { kind: actorKind, id: actorKind, displayName: null },
      payload,
      occurredAt: now,
    };
    trail.push(event);

    // The trail is still returned in full — replay and the mission result do not
    // depend on anyone listening. This is an additional path, not a substitute.
    try {
      options.onEvent?.(event);
    } catch {
      // A subscriber's failure is not a mission failure. The event is already in
      // the trail, so nothing is lost that replay cannot recover.
    }
  };

  const verdictMeta = (n: number) => ({
    verdictId: `${mission.taskId.slice(0, 24)}${(n + 0xf00000).toString(16).padStart(12, '0')}`,
    reviewerId: mission.taskId,
    issuedAt: now,
  });

  record(mission.taskId, 'contract', 'mission.started', 'orchestrator', { objective: mission.objective });

  const surrender = (reason: string, blockers: string[]): MissionResult => {
    record(mission.taskId, 'escalation', 'mission.surrendered', 'orchestrator', { reason, blockers });
    return { outcome: 'surrendered', deliverable: null, trail, escalations };
  };

  /** Surrender from inside the recursion, carried back up rather than thrown. */
  const fail = (reason: string, blockers: string[]): SubtreeOutcome => ({
    ok: false,
    result: surrender(reason, blockers),
  });

  /**
   * How deep splitting may go.
   *
   * Derived from the mission's own contract, not chosen: a split must partition
   * acceptance criteria, so a mission with `n` criteria cannot meaningfully
   * split more than `n` levels — by then every leaf holds one criterion and
   * {@link isAtomic} stops it anyway. The bound exists only so a planner that
   * keeps inventing multi-criterion children cannot recurse forever.
   */
  const depthBound = Math.max(1, mission.acceptanceCriteria.length);

  const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  /**
   * Run one subtree: decompose, gate the plan, run each child, assemble.
   *
   * Recursive because integration is the decomposition tree walked backwards —
   * whoever split the work owns reassembling it, level by level, and every
   * assembly faces the same review gate the leaves did.
   */
  const runSubtree = async (parent: TaskContract, depth: number): Promise<SubtreeOutcome> => {
    // ---- decompose -----------------------------------------------------------
    // A seam that throws is a *failure*, not a crash. Model calls fail for real
    // reasons — a small model running away under constrained decoding, a backend
    // timing out — and a mission that dies on one of those loses its whole ledger
    // trail and tells the operator nothing. Surrender is the designed outcome for
    // "cannot proceed"; an unhandled exception is not.
    let children;
    try {
      children = await decompose(parent, seams.planner);
    } catch (error) {
      return fail('decomposition failed', [describe(error)]);
    }
    for (const child of children) {
      record(child.taskId, 'contract', 'task.contracted', 'orchestrator', {
        objective: child.objective,
        ceiling: child.budget.ceiling,
        blastRadius: child.blastRadius,
        // The graph, not just the label (R15). Edges can only be drawn from data
        // that was recorded — the canvas is a projection, so anything it needs to
        // show has to exist in the trail first.
        category: child.category,
        parentTaskId: child.parentTaskId,
        dependsOn: [...child.dependencies.consumesTaskIds],
      });
    }

    // ---- Gate A: audit the PLAN before spending anything on it ---------------
    let aVerdict;
    try {
      aVerdict = await gateA(parent, children, seams.coverageJudge, verdictMeta(seq));
    } catch (error) {
      return fail('Gate A could not be evaluated', [describe(error)]);
    }
    record(parent.taskId, 'verification', 'gate_a.verdict_issued', 'reviewer', { ...aVerdict });

    if (aVerdict.outcome === 'fail') {
      return fail('Gate A rejected the decomposition', aVerdict.findings.map((f) => f.detail));
    }

    // ---- per-leaf: staff → execute → Gate B → escalate ------------------------
    const completed: Array<{ objective: string; deliverable: unknown }> = [];

    for (let child of children) {
      // A task that is not yet atomic is a PARENT: it assembles, it does not
      // execute. This is the recursion the dossier specifies — "splitting
      // continues until each leaf carries exactly one responsibility with one
      // verifiable outcome — and no further".
      if (!isAtomic(child) && depth + 1 < depthBound) {
        const sub = await runSubtree(child, depth + 1);
        if (!sub.ok) return sub;
        completed.push({ objective: child.objective, deliverable: sub.deliverable });
        continue;
      }

      const ladder = child.escalationPolicy.ladder;
      let rungIndex = -1;
      let tierBump = 0;
      let delivered: unknown = null;
      let settled = false;

      // Bounded by the ladder AND by maxAttempts — whichever runs out first.
      const maxAttempts = Math.min(child.stoppingConditions.maxAttempts, ladder.length + 1);

      let retriesUsed = 0;

      for (let attempt = 0; attempt < maxAttempts && !settled; attempt += 1) {
        let manifest;
        try {
          manifest = await staff({ contract: child, registry: seams.registry, author: seams.author });
        } catch (error) {
          rungIndex += 1;
          if (rungIndex >= ladder.length) break;
          record(child.taskId, 'escalation', 'escalation.rung_climbed', 'orchestrator', {
            rung: ladder[rungIndex], reason: `staffing failed: ${describe(error)}`,
          });
          escalations.push({ taskId: child.taskId, rung: ladder[rungIndex]!, fromTier: 1, toTier: 1, reason: describe(error) });
          continue;
        }
        const tier = Math.min(manifest.logicalTier + tierBump, FRONTIER_TIER) as LogicalTier;
        record(child.taskId, 'staffing', 'agent.staffed', 'agent_creator', {
          designId: manifest.designId, logicalTier: tier, attempt: attempt + 1,
        });

        const { verificationPlan: _withheld, ...workerView } = child;
        let outcome;
        try {
          outcome = await runSpecialist({
            contract: workerView, agentId: manifest.designId, judge: seams.clarityJudge, work: seams.work,
            bundleId: `${child.taskId.slice(0, 24)}${(attempt + 0xb00000).toString(16).padStart(12, '0')}`,
            producedAt: now,
          });
        } catch (error) {
          // Retry the same tier first. Only a repeated failure is evidence of a
          // problem the ladder can actually remedy.
          if (retriesUsed < transientRetries) {
            retriesUsed += 1;
            record(child.taskId, 'execution', 'task.retried', 'worker', {
              reason: describe(error), attempt: retriesUsed,
            });
            attempt -= 1; // a retry is not an attempt against the ladder
            continue;
          }
          record(child.taskId, 'execution', 'task.failed', 'worker', { reason: describe(error) });
          rungIndex += 1;
          if (rungIndex >= ladder.length) break;
          const rung = ladder[rungIndex]!;
          const fromTier = tier;
          if (rung === 'retry_higher_tier') tierBump += 1;
          const toTier = Math.min(manifest.logicalTier + tierBump, FRONTIER_TIER) as LogicalTier;
          escalations.push({ taskId: child.taskId, rung, fromTier, toTier, reason: describe(error) });
          record(child.taskId, 'escalation', 'escalation.rung_climbed', 'orchestrator', {
            rung, fromTier, toTier, reason: describe(error),
          });
          continue;
        }

        if (outcome.kind === 'bounced') {
          record(child.taskId, 'execution', 'task.bounced', 'worker', { ambiguities: outcome.ambiguities });

          // The error class picks the rung (R36). A bounce is a SPECIFICATION
          // fault: the contract could not be restated, so nothing about running it
          // again — at any size of model — addresses the problem. Climbing one rung
          // from the bottom lands on `retry_higher_tier`, and measurement across
          // the local ladder showed a bigger model is *worse* at this gate
          // (2b 33% false-bounce, 9b 17%, 12b 58%), so the default remedy actively
          // increased the chance of bouncing again.
          const reDecomposition = ladder.indexOf('re_decomposition');
          rungIndex = reDecomposition > rungIndex ? reDecomposition : rungIndex + 1;
          if (rungIndex >= ladder.length) break;

          const rung = ladder[rungIndex]!;
          const reason = `contract was bounced as ambiguous: ${outcome.ambiguities.join('; ')}`;
          escalations.push({ taskId: child.taskId, rung, fromTier: tier, toTier: tier, reason });
          record(child.taskId, 'escalation', 'escalation.rung_climbed', 'orchestrator', { rung, reason });

          // Enact the rung rather than merely recording it: rewrite the contract
          // the worker could not read. Without a clarifier the loop still climbs
          // and surrenders — honestly, but unable to repair anything.
          if (seams.clarifier !== undefined) {
            try {
              const rewritten = await seams.clarifier.clarify({
                contract: child,
                ambiguities: outcome.ambiguities,
              });
              child = {
                ...child,
                objective: rewritten.objective,
                ...(rewritten.acceptanceCriteria === null
                  ? {}
                  : { acceptanceCriteria: [...rewritten.acceptanceCriteria] }),
              };
              record(child.taskId, 'decision', 'task.recontracted', 'orchestrator', {
                objective: child.objective, reason: 'rewritten after a bounce',
              });
            } catch (error) {
              // A clarifier that fails leaves the original contract standing; the
              // ladder has already advanced, so this cannot loop.
              record(child.taskId, 'decision', 'task.recontract_failed', 'orchestrator', {
                reason: describe(error),
              });
            }
          }
          continue;
        }

        record(child.taskId, 'execution', 'task.executed', 'worker', { bundleId: outcome.bundle.bundleId });

        let bVerdict;
        try {
          bVerdict = await gateB(child, outcome.bundle, seams.completionJudge, verdictMeta(seq));
        } catch (error) {
          record(child.taskId, 'verification', 'gate_b.unevaluable', 'reviewer', { reason: describe(error) });
          rungIndex += 1;
          if (rungIndex >= ladder.length) break;
          const rung = ladder[rungIndex]!;
          const fromTier = tier;
          if (rung === 'retry_higher_tier') tierBump += 1;
          const toTier = Math.min(manifest.logicalTier + tierBump, FRONTIER_TIER) as LogicalTier;
          escalations.push({ taskId: child.taskId, rung, fromTier, toTier, reason: describe(error) });
          record(child.taskId, 'escalation', 'escalation.rung_climbed', 'orchestrator', {
            rung, fromTier, toTier, reason: describe(error),
          });
          continue;
        }
        record(child.taskId, 'verification', 'gate_b.verdict_issued', 'reviewer', { ...bVerdict });

        if (bVerdict.outcome === 'pass') {
          delivered = outcome.bundle.deliverable;
          settled = true;
          break;
        }

        // ---- exactly ONE rung per failure -----------------------------------
        rungIndex += 1;
        if (rungIndex >= ladder.length) break;
        const rung = ladder[rungIndex]!;
        const fromTier = tier;
        // A tier bump IS a rung, so only that rung changes the tier; the others
        // change who or what runs, not how much model is thrown at it.
        if (rung === 'retry_higher_tier') tierBump += 1;
        const toTier = Math.min(manifest.logicalTier + tierBump, FRONTIER_TIER) as LogicalTier;

        escalations.push({
          taskId: child.taskId, rung, fromTier, toTier,
          reason: bVerdict.findings.map((f) => f.detail).join('; '),
        });
        record(child.taskId, 'escalation', 'escalation.rung_climbed', 'orchestrator', {
          rung, fromTier, toTier, errorClasses: bVerdict.findings.map((f) => f.errorClass),
        });
      }

      if (!settled) {
        return fail(
          `task ${child.taskId} exhausted its escalation ladder`,
          [`"${child.objective}" could not be verified within ${maxAttempts} attempts`],
        );
      }

      completed.push({ objective: child.objective, deliverable: delivered });
    }

    // ---- fold up -------------------------------------------------------------
    let folded;
    try {
      folded = await foldUp(parent, completed, seams.reconciler);
    } catch (error) {
      return fail('fold-up failed', [describe(error)]);
    }
    record(parent.taskId, 'contract', parent.taskId === mission.taskId ? 'mission.folded' : 'task.folded', 'orchestrator', {
        childCount: folded.childCount, conflicts: folded.conflicts,
      });


    return { ok: true, deliverable: folded.deliverable };
  };

  const root = await runSubtree(mission, 0);
  if (!root.ok) return root.result;

  return { outcome: 'delivered', deliverable: root.deliverable, trail, escalations };
}
