/**
 * The proposal emitter — the Learning Agent's only outward channel.
 *
 * Invariant #4: **the learner does not own the yardstick.** It may rewrite
 * prompts, playbooks and taxonomies; it may never rewrite the constitutional
 * core — metrics, review independence, ledger integrity, budget enforcement.
 * Amendments are *propose-only*, and this is where that is enforced.
 *
 * Note that a proposal is permitted to **target** the constitution. That is not
 * a loophole, it is the amendment protocol working: the learner is allowed to
 * argue that a rule should change. What it cannot do is *make* the change. The
 * distinction between arguing and acting is the whole design.
 */
import type { LedgerEventInput } from '@artifex/shared-types';

import type { EventSink } from './event-sink.js';

/**
 * The immutable core.
 *
 * Frozen rather than merely documented: "we promise not to edit this" is not a
 * guarantee, it is an intention. A learner that could edit the yardstick would
 * make every measurement in the system unfalsifiable, so the object refuses.
 */
export const CONSTITUTIONAL_CORE = Object.freeze({
  /** How value-per-effort is defined. The learner may not redefine success. */
  metricDefinitions: Object.freeze(['value_per_effort', 'gate_b_pass_rate', 'clade_metaproductivity']),
  /** A reviewer is never the author. */
  reviewIndependence: true,
  /** The ledger is append-only; history is corrected by appending, never by editing. */
  ledgerIntegrity: true,
  /** Budgets bind in both directions and cannot be waived by the thing spending them. */
  budgetEnforcement: true,
  /** Amendments are argued, never applied, by the learner. */
  amendmentProtocol: 'propose-only',
});

export interface Proposal {
  readonly missionId: string;
  readonly title: string;
  readonly rationale: string;
  /** Ledger events that justify the proposal — an unevidenced proposal is an opinion. */
  readonly evidenceEventIds: readonly string[];
  readonly targets?: 'prompts' | 'playbooks' | 'taxonomies' | 'constitution';
}

export interface EmitterClock {
  newId(): string;
  now(): string;
}

export class ProposalEmitter {
  constructor(
    private readonly sink: EventSink,
    private readonly clock: EmitterClock,
  ) {}

  /**
   * Record a proposal. Note what this method does NOT do: apply it.
   *
   * There is deliberately no `apply`, `amend` or `adopt` here. A human ratifies
   * constitutional change out of band — that is what makes the amendment
   * protocol a protocol rather than a formality.
   */
  async propose(proposal: Proposal): Promise<LedgerEventInput> {
    if (proposal.rationale.trim().length === 0) {
      throw new Error('a proposal needs a rationale — an unargued proposal is noise, not a proposal');
    }

    const event: LedgerEventInput = {
      eventId: this.clock.newId(),
      missionId: proposal.missionId,
      taskId: null,
      family: 'learning',
      type: 'learning.proposal_emitted',
      actor: { kind: 'learning_agent', id: 'learning-agent', displayName: 'Learning Agent' },
      payload: {
        title: proposal.title,
        rationale: proposal.rationale,
        evidenceEventIds: [...proposal.evidenceEventIds],
        targets: proposal.targets ?? 'prompts',
        // Stated on every proposal so the record itself carries the constraint,
        // not just the code that produced it.
        status: 'proposed',
        appliedBy: null,
      },
      occurredAt: this.clock.now(),
    };

    await this.sink.append(event);
    return event;
  }
}
