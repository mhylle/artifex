/**
 * The cockpit's control plane (R17) — where a human acts on a running mission.
 *
 * "Mission control is a cockpit, not a window. Humans approve escalations,
 * answer clarifications, pause subtrees, top up budgets and turn the autonomy
 * dial from here — and **every such act is itself a ledger event, first-class
 * and attributable like everything the agents do**."
 *
 * That symmetry is the whole design of this service. It has exactly two
 * operations: append what the operator did, and derive the current control
 * state back out of those appends. It stores nothing. There is no `paused` flag
 * anywhere in the system — pause is a fact in the trail, read by the dashboard
 * and the runtime alike, which is invariant #1 applied to human action.
 */
import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import type { AutonomyDial, LedgerEventInput } from '@artifex/shared-types';

import type { LedgerReader, LedgerSink } from './ledger.types';

export type CockpitAction =
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'grant_budget'
  | 'turn_dial'
  | 'annotate'
  | 'decide'
  | 'restate';

export interface CockpitRequest {
  readonly missionId: string;
  /** `null` addresses the whole mission rather than one task. */
  readonly taskId: string | null;
  readonly action: CockpitAction;
  readonly operator: string;
  readonly amount?: number;
  readonly autonomyDial?: AutonomyDial;
  readonly note?: string;
  /** For `decide`: what the human concluded about a waiting item. */
  readonly decision?: 'approve' | 'reject';
  /**
   * For `restate`: the criteria this mission should now be graded against.
   *
   * A mission whose specification cannot be verified is not fixed by running it
   * again — the surrender dossier says so in its own words ("relax or restate").
   * Amending it on the same trail keeps one piece of work as one mission.
   */
  readonly acceptanceCriteria?: readonly { criterionId: string; statement: string }[];
  /** For `restate`: an amended objective, when the wording itself was the problem. */
  readonly objective?: string;
}

export type ControlState = 'run' | 'paused' | 'cancelled';

/**
 * How a decision reaches the runtime.
 *
 * The worker resumes by replaying the trail (R41), but it only replays when a
 * job arrives — so an answer has to put the mission back on the queue. Without
 * this the decision would be a fact nobody acts on.
 */
export interface MissionResumer {
  resume(missionId: string): Promise<void>;
}

export interface CockpitClock {
  now(): string;
  newId(): string;
}

/** Event type and family per action — the taxonomy, in one place. */
const SHAPE: Record<CockpitAction, { type: string; family: LedgerEventInput['family'] }> = {
  pause: { type: 'operator.paused', family: 'decision' },
  resume: { type: 'operator.resumed', family: 'decision' },
  cancel: { type: 'operator.cancelled', family: 'decision' },
  // Economic, not decision: "grants are economic events — visible in every later
  // cost analysis", which is a family lookup rather than a string scan.
  grant_budget: { type: 'operator.budget_granted', family: 'economic' },
  turn_dial: { type: 'operator.dial_turned', family: 'decision' },
  annotate: { type: 'operator.annotated', family: 'decision' },
  // Answering an attention item. Its own type rather than an annotation,
  // because the runtime must be able to tell "a human has ruled on this" from
  // "a human wrote something down" — only the first unblocks a task.
  decide: { type: 'operator.decided', family: 'decision' },
  // `contract`, not `decision`: this CHANGES what the work is graded against,
  // which is a contract event in the taxonomy rather than a ruling about one.
  restate: { type: 'operator.restated', family: 'contract' },
};

@Injectable()
export class CockpitService {
  constructor(
    private readonly ledger: LedgerSink,
    private readonly reader: LedgerReader,
    private readonly clock: CockpitClock,
    private readonly resumer?: MissionResumer,
  ) {}

  /** Record what the operator did. The only write path for human action. */
  async act(request: CockpitRequest): Promise<{ eventId: string }> {
    const shape = SHAPE[request.action];
    if (shape === undefined) {
      throw new BadRequestException(`unknown cockpit action "${String(request.action)}"`);
    }
    if (request.operator.trim().length === 0) {
      // An unattributed human act defeats the symmetry rule: the trail would
      // record that *someone* paused this, which is not accountability.
      throw new BadRequestException('a cockpit action must name the operator performing it');
    }

    const payload = this.#payloadFor(request);
    const eventId = this.clock.newId();

    await this.ledger.append({
      eventId,
      missionId: request.missionId,
      taskId: request.taskId,
      family: shape.family,
      type: shape.type,
      actor: { kind: 'human', id: request.operator, displayName: request.operator },
      payload,
      occurredAt: this.clock.now(),
    });

    // Only a DECISION unblocks. Re-enqueuing on every action would restart
    // missions the operator has just paused or cancelled.
    // A restatement unblocks for the same reason a decision does: the runtime
    // resumes by replaying the trail, and only replays when a job arrives.
    if ((request.action === 'decide' || request.action === 'restate') && this.resumer !== undefined) {
      try {
        await this.resumer.resume(request.missionId);
      } catch {
        // The ruling is already recorded, and it is the one thing only the human
        // can supply. Losing it because a queue blinked would be the worse
        // failure; the mission can be re-enqueued again.
      }
    }

    return { eventId };
  }

  /**
   * What the runtime should do with this task right now.
   *
   * Folded from the trail on every call rather than cached: the runtime and the
   * dashboard must never be able to disagree about whether something is paused,
   * and the cheapest way to guarantee that is to have exactly one derivation.
   */
  async controlState(missionId: string, taskId: string): Promise<ControlState> {
    const events = await this.reader.replay({ missionId });

    let state: ControlState = 'run';
    for (const event of events) {
      // A mission-wide signal (no taskId) governs every task under it; a
      // task-scoped one governs only its own.
      const addressed = event.taskId === null || event.taskId === taskId;
      if (!addressed) continue;

      switch (event.type) {
        case 'operator.paused':
          state = 'paused';
          break;
        case 'operator.resumed':
          // The latest signal wins, or pause would be a one-way door.
          state = 'run';
          break;
        case 'operator.cancelled':
          // Cancellation is terminal. A resume cannot restart work whose
          // accounting has already been written — the operator would be
          // reviving something the ledger has already closed out.
          return 'cancelled';
        default:
          break;
      }
    }
    return state;
  }

  #payloadFor(request: CockpitRequest): Record<string, unknown> {
    switch (request.action) {
      case 'grant_budget': {
        if (typeof request.amount !== 'number' || request.amount <= 0) {
          throw new BadRequestException('a budget grant needs a positive amount');
        }
        return { amount: request.amount, unit: 'effort-units' };
      }
      case 'restate': {
        // Invariant #2: no work without a contract, and a contract is what the
        // work is graded against. A restatement with nothing to grade against
        // would leave the mission ungradeable — worse than the untestable
        // criterion it was meant to replace.
        const criteria = request.acceptanceCriteria ?? [];
        if (criteria.length === 0) {
          throw new BadRequestException(
            'restating a mission needs at least one acceptance criterion — a mission nobody can grade is not a mission',
          );
        }
        if (criteria.some((c) => c.statement.trim().length === 0)) {
          throw new BadRequestException('an acceptance criterion cannot be blank');
        }
        return {
          acceptanceCriteria: criteria.map((c) => ({ ...c })),
          // Only when it actually changed. Recording `objective: undefined`
          // would spread over the commissioned objective and blank it.
          ...(request.objective === undefined || request.objective.trim().length === 0
            ? {}
            : { objective: request.objective.trim() }),
          ...(request.note === undefined ? {} : { note: request.note }),
        };
      }
      case 'turn_dial': {
        if (request.autonomyDial === undefined) {
          throw new BadRequestException('turning the dial needs the new setting');
        }
        return {
          autonomyDial: request.autonomyDial,
          // Stated in the event itself so replay can never read this as
          // retroactive: "takes effect at the next gate, never retroactively".
          appliesFrom: 'next_gate',
        };
      }
      case 'decide': {
        if (request.decision !== 'approve' && request.decision !== 'reject') {
          throw new BadRequestException('a decision must be approve or reject');
        }
        return { decision: request.decision, ...(request.note === undefined ? {} : { note: request.note }) };
      }
      case 'annotate': {
        if (request.note === undefined || request.note.trim().length === 0) {
          throw new BadRequestException('an annotation needs a note');
        }
        return { note: request.note };
      }
      default:
        return {};
    }
  }
}
