import { OnGatewayConnection, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Socket } from 'socket.io';

import { LedgerStreamService } from './ledger-stream.service';

/**
 * The dashboard's live feed.
 *
 * A client subscribes to ONE mission and receives that mission's events only.
 * `replayThenSubscribe` is used rather than a bare subscribe so a cockpit opened
 * mid-mission shows the whole trail — a partial trail is worse than none,
 * because the operator cannot tell which it is looking at.
 */
@WebSocketGateway({ cors: true })
export class LedgerGateway implements OnGatewayConnection {
  readonly #stops = new Map<string, () => void>();

  constructor(private readonly stream: LedgerStreamService) {}

  handleConnection(client: Socket): void {
    client.on('disconnect', () => {
      this.#stops.get(client.id)?.();
      this.#stops.delete(client.id);
    });
  }

  @SubscribeMessage('watch')
  async watch(client: Socket, missionId: string): Promise<void> {
    this.#stops.get(client.id)?.();
    const stop = await this.stream.replayThenSubscribe(missionId, (event) => {
      client.emit('ledger', event);
    });
    this.#stops.set(client.id, stop);
  }
}
