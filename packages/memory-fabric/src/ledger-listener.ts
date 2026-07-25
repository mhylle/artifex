/**
 * The live half of the one substrate: a dedicated connection holding `LISTEN`
 * so appends reach the dashboard without polling and without extra infra.
 *
 * The notification is a *pointer*, not the event — NOTIFY payloads are capped
 * at 8000 bytes and an evidence bundle will exceed that. Consumers take the
 * `seq` and read the row through {@link LedgerRepository.readSince}, which is
 * also exactly how they catch up after a disconnect.
 */
import type { LedgerEventFamily } from '@artifex/shared-types';
import { Client, type Notification } from 'pg';

import { LEDGER_CHANNEL } from './ledger-repository.js';

export interface LedgerNotification {
  seq: number;
  eventId: string;
  missionId: string;
  taskId: string | null;
  family: LedgerEventFamily;
  type: string;
}

export type LedgerNotificationHandler = (notification: LedgerNotification) => void;

export class LedgerListener {
  private readonly handlers = new Set<LedgerNotificationHandler>();

  private constructor(private readonly client: Client) {}

  /**
   * `LISTEN` is per-connection, so this takes its own client rather than
   * borrowing from a pool — a pooled connection could be handed to someone else
   * mid-subscription.
   */
  static async start(connectionString: string): Promise<LedgerListener> {
    const client = new Client({ connectionString });
    await client.connect();

    const listener = new LedgerListener(client);
    client.on('notification', (message: Notification) => listener.dispatch(message));
    await client.query(`LISTEN ${LEDGER_CHANNEL}`);

    return listener;
  }

  private dispatch(message: Notification): void {
    if (message.channel !== LEDGER_CHANNEL || message.payload === undefined) {
      return;
    }

    let notification: LedgerNotification;
    try {
      notification = JSON.parse(message.payload) as LedgerNotification;
    } catch {
      // A malformed payload must not take the stream down; the ledger row is
      // still there to be read by replay.
      return;
    }

    for (const handler of this.handlers) {
      try {
        handler(notification);
      } catch {
        // One bad subscriber must not starve the others, or kill the listener.
      }
    }
  }

  /** Subscribe; returns an unsubscribe function. */
  onNotification(handler: LedgerNotificationHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async stop(): Promise<void> {
    this.handlers.clear();
    await this.client.end();
  }
}
