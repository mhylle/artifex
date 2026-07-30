/**
 * What connects the ledger's `LISTEN` to the websocket stream.
 *
 * This class exists because of defect `b3b4e554`: `LedgerStreamService` and
 * `LedgerListener` were both complete and both well tested, and nothing joined
 * them. A mission ran end to end while a connected dashboard showed one event;
 * reloading replayed all nineteen. The stream was not broken — it was never
 * plugged in.
 *
 * The lesson generalises, and it is why the tests here assert the *subscription*
 * rather than the handler: a unit test cannot notice that nobody calls the
 * function it is exercising. Only the composition can be tested for existence.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import type { LedgerNotification } from './ledger.types';

/** The part of `LedgerListener` this bridge depends on. */
export interface LedgerListenerLike {
  onNotification(handler: (notification: LedgerNotification) => void): () => void;
  stop(): Promise<void>;
}

/** The part of `LedgerStreamService` this bridge depends on. */
export interface LedgerStreamLike {
  onNotification(notification: LedgerNotification): Promise<void>;
}

export interface LedgerLiveOptions {
  /** Gap between reconnect attempts. Small in tests, seconds in production. */
  readonly retryDelayMs?: number;
}

@Injectable()
export class LedgerLiveBridge implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly #log = new Logger(LedgerLiveBridge.name);
  readonly #retryDelayMs: number;

  #listener: LedgerListenerLike | undefined;
  #unsubscribe: (() => void) | undefined;
  #shuttingDown = false;
  #live = false;

  constructor(
    private readonly stream: LedgerStreamLike,
    private readonly start: () => Promise<LedgerListenerLike>,
    options: LedgerLiveOptions = {},
  ) {
    this.#retryDelayMs = options.retryDelayMs ?? 2000;
  }

  /**
   * Whether a live connection is currently held.
   *
   * Exposed because "no events are arriving" and "the listener is dead" look
   * identical from the dashboard, and that ambiguity is what let this defect
   * survive a full phase.
   */
  get live(): boolean {
    return this.#live;
  }

  async onApplicationBootstrap(): Promise<void> {
    // One attempt inline, so a healthy start is live before the app accepts
    // traffic. If it fails, retrying moves to the background: a bootstrap hook
    // must not throw (memory-fabric's rule) and must not hang the process, and
    // the control plane is still useful for intake and replay meanwhile.
    if (!(await this.#attempt())) {
      void this.#retryUntilConnected();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.#shuttingDown = true;
    this.#unsubscribe?.();
    await this.#listener?.stop();
    this.#live = false;
  }

  /** One connection attempt. Returns whether the stream is now live. */
  async #attempt(): Promise<boolean> {
    try {
      const listener = await this.start();
      this.#listener = listener;
      this.#unsubscribe = listener.onNotification((notification) => {
        // The handler is sync (pg's emitter), the stream is async: failures are
        // absorbed so one bad hydration cannot kill the subscription.
        void this.stream.onNotification(notification).catch((cause: unknown) => {
          this.#log.error(`failed to deliver ledger notification: ${String(cause)}`);
        });
      });
      this.#live = true;
      this.#log.log('live ledger stream connected');
      return true;
    } catch (cause: unknown) {
      this.#live = false;
      // Loud on purpose. A silent failure here is the defect this class fixes:
      // "no events are arriving" and "the listener is dead" must not look alike.
      this.#log.error(
        `live ledger stream unavailable (${String(cause)}); retrying in ${this.#retryDelayMs}ms`,
      );
      return false;
    }
  }

  async #retryUntilConnected(): Promise<void> {
    while (!this.#shuttingDown && !this.#live) {
      await new Promise((resolve) => setTimeout(resolve, this.#retryDelayMs));
      if (this.#shuttingDown) return;
      await this.#attempt();
    }
  }
}
