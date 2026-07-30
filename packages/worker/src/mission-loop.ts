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

export interface MissionSeams {
  readonly planner: Planner;
  readonly coverageJudge: CoverageJudge;
  readonly registry: RegistryLookup;
  readonly author: DesignAuthor;
  readonly clarityJudge: ClarityJudge;
  readonly work: SpecialistWork;
  readonly completionJudge: CompletionJudge;
  readonly reconciler: Reconciler;
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

  const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  // ---- decompose -----------------------------------------------------------
  // A seam that throws is a *failure*, not a crash. Model calls fail for real
  // reasons — a small model running away under constrained decoding, a backend
  // timing out — and a mission that dies on one of those loses its whole ledger
  // trail and tells the operator nothing. Surrender is the designed outcome for
  // "cannot proceed"; an unhandled exception is not.
  let children;
  try {
    children = await decompose(mission, seams.planner);
  } catch (error) {
    return surrender('decomposition failed', [describe(error)]);
  }
  for (const child of children) {
    record(child.taskId, 'contract', 'task.contracted', 'orchestrator', {
      objective: child.objective, ceiling: child.budget.ceiling, blastRadius: child.blastRadius,
    });
  }

  // ---- Gate A: audit the PLAN before spending anything on it ---------------
  let aVerdict;
  try {
    aVerdict = await gateA(mission, children, seams.coverageJudge, verdictMeta(seq));
  } catch (error) {
    return surrender('Gate A could not be evaluated', [describe(error)]);
  }
  record(mission.taskId, 'verification', 'gate_a.verdict_issued', 'reviewer', { ...aVerdict });

  if (aVerdict.outcome === 'fail') {
    return surrender('Gate A rejected the decomposition', aVerdict.findings.map((f) => f.detail));
  }

  // ---- per-leaf: staff → execute → Gate B → escalate ------------------------
  const completed: Array<{ objective: string; deliverable: unknown }> = [];

  for (const child of children) {
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
        // A bounce is a specification problem, so it climbs the ladder too rather
        // than being retried identically — retrying an ambiguous contract just
        // rehearses the ambiguity.
        rungIndex += 1;
        if (rungIndex >= ladder.length) break;
        record(child.taskId, 'escalation', 'escalation.rung_climbed', 'orchestrator', {
          rung: ladder[rungIndex], reason: 'contract was bounced as ambiguous',
        });
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
      return surrender(
        `task ${child.taskId} exhausted its escalation ladder`,
        [`"${child.objective}" could not be verified within ${maxAttempts} attempts`],
      );
    }

    completed.push({ objective: child.objective, deliverable: delivered });
  }

  // ---- fold up -------------------------------------------------------------
  let folded;
  try {
    folded = await foldUp(mission, completed, seams.reconciler);
  } catch (error) {
    return surrender('fold-up failed', [describe(error)]);
  }
  record(mission.taskId, 'contract', 'mission.folded', 'orchestrator', {
    childCount: folded.childCount, conflicts: folded.conflicts,
  });

  return { outcome: 'delivered', deliverable: folded.deliverable, trail, escalations };
}
