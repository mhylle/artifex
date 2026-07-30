/**
 * The live ledger stream — Postgres `LISTEN/NOTIFY` → websocket.
 *
 * The dashboard renders ledger events and persists nothing of its own
 * (invariant #1), which makes this the only thing between a NOTIFY and a
 * browser. Two consequences shape the design:
 *
 *  - **NOTIFY carries a pointer, not the event.** Postgres caps NOTIFY at 8000
 *    bytes and an evidence bundle exceeds it, so P2 deliberately publishes
 *    `seq`/`eventId`/… and nothing more. This service hydrates the full event by
 *    `seq` rather than trusting the notification — which is also exactly the path
 *    a consumer uses to catch up after a disconnect.
 *
 *  - **A late subscriber must not see a mission that started halfway through.**
 *    Opening the cockpit mid-mission replays what was missed and *then* goes
 *    live, because a cockpit showing a partial trail is worse than none.
 */
import { Injectable } from '@nestjs/common';
import type { LedgerEvent } from '@artifex/shared-types';

import type { LedgerNotification, LedgerReader } from './ledger.types';

export type LedgerSubscriber = (event: LedgerEvent) => void;

@Injectable()
export class LedgerStreamService {
  readonly #subscribers = new Map<string, Set<LedgerSubscriber>>();

  constructor(private readonly reader: LedgerReader) {}

  /** Subscribe to live events for one mission. Returns an unsubscribe handle. */
  subscribe(missionId: string, subscriber: LedgerSubscriber): () => void {
    const set = this.#subscribers.get(missionId) ?? new Set<LedgerSubscriber>();
    set.add(subscriber);
    this.#subscribers.set(missionId, set);

    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.#subscribers.delete(missionId);
    };
  }

  /** Replay the mission's history to this subscriber, then keep it live. */
  async replayThenSubscribe(missionId: string, subscriber: LedgerSubscriber): Promise<() => void> {
    const history = await this.reader.replay({ missionId });
    for (const event of history) this.#deliver(subscriber, event);

    return this.subscribe(missionId, subscriber);
  }

  /** Handle one `LISTEN/NOTIFY` pointer from the ledger. */
  async onNotification(notification: LedgerNotification): Promise<void> {
    const set = this.#subscribers.get(notification.missionId);
    if (set === undefined || set.size === 0) return;

    // Hydrate from the ledger. The notification is a pointer by design.
    const events = await this.reader.replay({ missionId: notification.missionId });
    const event = events.find((e) => e.seq === notification.seq);
    // A pointer with no row behind it is skipped rather than delivered as a
    // hole — a gap in the trail must never look like a real event.
    if (event === undefined) return;

    for (const subscriber of set) this.#deliver(subscriber, event);
  }

  /**
   * Deliver to one subscriber, absorbing its failure.
   *
   * A browser tab that throws must not starve every other watcher of the same
   * mission — the same discipline the ledger listener uses.
   */
  #deliver(subscriber: LedgerSubscriber, event: LedgerEvent): void {
    try {
      subscriber(event);
    } catch {
      // Intentionally swallowed: one bad subscriber is not a stream failure.
    }
  }
}
