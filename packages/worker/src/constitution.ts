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
