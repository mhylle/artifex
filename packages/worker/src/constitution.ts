/**
 * The Constitution — the immutable core (invariant #4).
 *
 * The Learning Agent may rewrite prompts, playbooks and taxonomies; it may never
 * rewrite what is in this file. These clauses are the yardstick, and a system
 * that can edit its own yardstick cannot be measured by it.
 *
 * This module holds *guards*: pure predicates that a proposed action either
 * satisfies or does not. They perform no I/O and consult no configuration —
 * a constitutional clause that could be switched off by config would not be one.
 */
import type { BlastRadius } from '@artifex/shared-types';

export class ConstitutionViolation extends Error {
  /** Which clause was breached — carried so the ledger can record it precisely. */
  readonly clause: string;

  constructor(clause: string, detail: string) {
    super(`constitutional violation [${clause}]: ${detail}`);
    this.name = 'ConstitutionViolation';
    this.clause = clause;
  }
}

export interface Ruling {
  readonly permitted: boolean;
  readonly clause: string;
  readonly detail: string;
}

export interface AgentAssignment {
  readonly agentId: string;
  readonly provider: string;
  readonly model: string;
}

export interface ReviewAssignment {
  readonly taskId: string;
  readonly blastRadius: BlastRadius;
  readonly worker: AgentAssignment;
  readonly reviewer: AgentAssignment;
}

const CLAUSE = 'review-independence';

/**
 * Review independence (invariants #3 and #4).
 *
 * Two distinct rules, and conflating them is the usual mistake:
 *
 *  1. **Agent independence is absolute.** An agent may never review its own work,
 *     at any blast radius. "One writes, another critiques" collapses the moment
 *     the critic is the author in a different prompt, and no cost argument
 *     rescues it — a self-approval is not evidence of anything.
 *
 *  2. **Model independence is required above low blast radius.** Sharing a model
 *     means sharing its blind spots: the reviewer is systematically likeliest to
 *     miss exactly what the worker got wrong. That correlation is worth paying to
 *     break when a mistake is expensive.
 *
 *     At *low* blast radius it is not. The task is reversible and cheap to
 *     re-run, the reviewing agent is still a different agent with a different
 *     contract, and spending a larger model on it would burn budget that
 *     invariant #7 says belongs elsewhere. Permitting model reuse here is what
 *     lets the swarm run its bulk work on the smallest models available.
 */
export function checkReviewIndependence(assignment: ReviewAssignment): Ruling {
  const { worker, reviewer, blastRadius, taskId } = assignment;

  if (worker.agentId === reviewer.agentId) {
    return {
      permitted: false,
      clause: CLAUSE,
      detail: `task ${taskId}: agent ${worker.agentId} cannot review its own work at any blast radius`,
    };
  }

  const sameModel = worker.provider === reviewer.provider && worker.model === reviewer.model;
  if (sameModel && blastRadius !== 'low') {
    return {
      permitted: false,
      clause: CLAUSE,
      detail:
        `task ${taskId}: reviewer shares the worker's model (${worker.provider}/${worker.model}) ` +
        `at ${blastRadius} blast radius — shared blind spots are not independent review`,
    };
  }

  return {
    permitted: true,
    clause: CLAUSE,
    detail: sameModel
      ? `task ${taskId}: model reuse permitted at low blast radius; reviewing agent is independent`
      : `task ${taskId}: reviewer is independent in both agent and model`,
  };
}

/** {@link checkReviewIndependence}, as an assertion for call sites that cannot continue. */
export function assertReviewIndependence(assignment: ReviewAssignment): void {
  const ruling = checkReviewIndependence(assignment);
  if (!ruling.permitted) {
    throw new ConstitutionViolation(ruling.clause, ruling.detail);
  }
}

const REACH_CLAUSE = 'fast-loop-reach';

/**
 * What the fast loop (R26) is permitted to patch mid-mission.
 *
 * `layer` is the literal `'worker'` and `kind` is a closed set, so a target
 * above the worker layer does not type-check. That is the first of the three
 * bars AC-2's "by construction" asks for; {@link checkFastLoopReach} is the
 * second, for data that reaches the runtime having never been type-checked, and
 * a CHECK constraint on `hot_fix` is the third.
 *
 * Deliberately NARROWER than `Proposal.targets` in `proposal-emitter.ts`, which
 * may name the constitution. A proposal argues; a hot-fix acts. The learner is
 * allowed to argue that any rule should change, and allowed to change almost
 * nothing.
 */
export interface HotFixTarget {
  readonly layer: 'worker';
  readonly kind: 'role_instructions' | 'knowledge';
  readonly assetId: string;
}

/** The only layer the fast loop may act on, and the only assets within it. */
const PERMITTED_KINDS: readonly string[] = ['role_instructions', 'knowledge'];

/**
 * May the fast loop patch this target? (R26 AC-2)
 *
 * An ALLOW-list, not a blocklist, and that is the whole design of the guard.
 * "Refuse meta and core" permits every layer nobody has thought of yet — and new
 * layers are exactly what a self-improving system grows. Anything that is not
 * recognisably a worker-layer asset is refused, including an unknown `kind`
 * within the worker layer: a worker's budget and its contract are not its
 * prompt, and neither is the fast loop's to rewrite.
 *
 * The reviewer rubric is the case worth stating aloud. A system that can patch
 * its own marking scheme mid-run can make any failure disappear without
 * improving anything — invariant #4's yardstick problem in its fastest form.
 */
export function checkFastLoopReach(target: HotFixTarget): Ruling {
  const { layer, kind, assetId } = target as { layer: string; kind: string; assetId: string };

  if (layer !== 'worker') {
    return {
      permitted: false,
      clause: REACH_CLAUSE,
      detail:
        `target ${assetId}: the fast loop may patch the worker layer only, not '${layer}' — ` +
        'a mid-mission change above the worker layer alters work nobody reviewed',
    };
  }

  if (!PERMITTED_KINDS.includes(kind)) {
    return {
      permitted: false,
      clause: REACH_CLAUSE,
      detail:
        `target ${assetId}: '${kind}' is not a patchable worker-layer asset ` +
        `(permitted: ${PERMITTED_KINDS.join(', ')})`,
    };
  }

  return {
    permitted: true,
    clause: REACH_CLAUSE,
    detail: `target ${assetId}: worker-layer ${kind} is within the fast loop's reach`,
  };
}

/** {@link checkFastLoopReach}, as an assertion for call sites that cannot continue. */
export function assertFastLoopReach(target: HotFixTarget): void {
  const ruling = checkFastLoopReach(target);
  if (!ruling.permitted) {
    throw new ConstitutionViolation(ruling.clause, ruling.detail);
  }
}
