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
  | 'annotate';

export interface CockpitRequest {
  readonly missionId: string;
  /** `null` addresses the whole mission rather than one task. */
  readonly taskId: string | null;
  readonly action: CockpitAction;
  readonly operator: string;
  readonly amount?: number;
  readonly autonomyDial?: AutonomyDial;
  readonly note?: string;
}

export type ControlState = 'run' | 'paused' | 'cancelled';

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
};

@Injectable()
export class CockpitService {
  constructor(
    private readonly ledger: LedgerSink,
    private readonly reader: LedgerReader,
    private readonly clock: CockpitClock,
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
