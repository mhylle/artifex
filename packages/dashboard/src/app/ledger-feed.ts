/**
 * The live ledger feed — the cockpit's only data source.
 *
 * It holds the raw event list and nothing else. Everything the operator sees is
 * derived from that list by `buildMissionTree`, so there is no view state that
 * could drift from the ledger (invariant #1: the dashboard is a view, never a
 * second truth).
 *
 * The API's `watch` message replays the mission's history before going live, so
 * a cockpit opened mid-mission shows the whole trail rather than the tail —
 * which matters because an operator cannot tell a partial trail from a complete
 * one just by looking at it.
 */
import { Injectable, computed, signal } from '@angular/core';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

import { buildMissionTree } from './mission-tree';
import type { LedgerEventView } from './mission-tree';

@Injectable({ providedIn: 'root' })
export class LedgerFeed {
  /** The raw trail. The ONLY thing this service stores. */
  readonly events = signal<LedgerEventView[]>([]);

  /** Everything visible is derived, never accumulated. */
  readonly tree = computed(() => buildMissionTree(this.events()));
  readonly connected = signal(false);

  #socket: Socket | undefined;

  /**
   * `127.0.0.1` rather than `localhost` deliberately. On this machine WSL's
   * `wslrelay.exe` holds IPv6 `[::1]:3000`, and browsers resolve `localhost` to
   * `::1` first — so a `localhost` URL reaches the relay instead of the control
   * plane, and the socket silently never connects.
   */
  watch(missionId: string, url = 'http://127.0.0.1:3000'): void {
    this.#socket?.disconnect();
    this.events.set([]);

    const socket = io(url, { transports: ['websocket'] });
    this.#socket = socket;

    socket.on('connect', () => {
      this.connected.set(true);
      socket.emit('watch', missionId);
    });
    socket.on('disconnect', () => this.connected.set(false));

    socket.on('ledger', (event: LedgerEventView) => {
      // Append-only here too, mirroring the substrate. De-duplicated by seq
      // because a reconnect replays history the client may already hold.
      this.events.update((current) =>
        current.some((e) => e.seq === event.seq) ? current : [...current, event],
      );
    });
  }

  stop(): void {
    this.#socket?.disconnect();
    this.#socket = undefined;
    this.connected.set(false);
  }
}
