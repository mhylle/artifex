/**
 * Defect `b3b4e554` — the live stream was never connected.
 *
 * `LedgerStreamService.onNotification` was thoroughly unit-tested and never
 * called: no process anywhere opened a Postgres `LISTEN`. A mission ran to
 * completion while a connected dashboard sat at "1 events"; reloading replayed
 * all 19. Green unit tests cannot see an uncalled function.
 *
 * So these tests assert the *wiring*, not the handler. Every one of them fails
 * if the bridge stops subscribing — which is the failure that actually shipped.
 */
import { describe, expect, it, vi } from 'vitest';

import { LedgerLiveBridge } from './ledger-live.bridge';
import type { LedgerListenerLike } from './ledger-live.bridge';
import type { LedgerNotification } from './ledger.types';

const POINTER: LedgerNotification = {
  seq: 7,
  eventId: 'e-7',
  missionId: 'm-1',
  taskId: 't-1',
  family: 'contract',
  type: 'task.contracted',
};

/** A listener under our control, standing in for the Postgres connection. */
function fakeListener() {
  const handlers = new Set<(n: LedgerNotification) => void>();
  let stopped = false;
  const listener: LedgerListenerLike = {
    onNotification(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async stop() {
      stopped = true;
    },
  };
  return {
    listener,
    emit: (n: LedgerNotification) => handlers.forEach((h) => h(n)),
    get handlerCount() { return handlers.size; },
    get stopped() { return stopped; },
  };
}

function harness(start?: () => Promise<LedgerListenerLike>) {
  const received: LedgerNotification[] = [];
  const stream = { onNotification: async (n: LedgerNotification) => void received.push(n) };
  const fake = fakeListener();
  const bridge = new LedgerLiveBridge(
    stream,
    start ?? (async () => fake.listener),
    { retryDelayMs: 1 },
  );
  return { bridge, stream, received, fake };
}

describe('b3b4e554 — a NOTIFY reaches the stream because something actually subscribed', () => {
  it('subscribes to the listener on bootstrap', async () => {
    const { bridge, fake } = harness();

    await bridge.onApplicationBootstrap();

    expect(fake.handlerCount).toBe(1);
  });

  it('routes a notification from the listener into the stream', async () => {
    const { bridge, fake, received } = harness();
    await bridge.onApplicationBootstrap();

    fake.emit(POINTER);
    await vi.waitFor(() => expect(received).toHaveLength(1));

    expect(received[0]).toEqual(POINTER);
  });

  it('DISTRACTOR: before bootstrap nothing is subscribed — the bridge is what connects them', async () => {
    // Without this, a bridge that subscribed in its constructor would pass the
    // tests above while still being dead in a real app if never instantiated.
    const { fake, received } = harness();

    fake.emit(POINTER);

    expect(fake.handlerCount).toBe(0);
    expect(received).toHaveLength(0);
  });

  it('releases the connection on shutdown', async () => {
    const { bridge, fake } = harness();
    await bridge.onApplicationBootstrap();

    await bridge.onApplicationShutdown();

    expect(fake.stopped).toBe(true);
  });
});

describe('b3b4e554 — a listener that cannot start must be loud and must retry', () => {
  it('does not throw out of bootstrap when Postgres is unreachable', async () => {
    // memory-fabric's rule: nothing may throw out of a bootstrap hook. But a
    // silently dead listener is exactly the bug being fixed, so it must retry.
    const { bridge } = harness(async () => { throw new Error('ECONNREFUSED'); });

    await expect(bridge.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('reports itself as not live while it cannot connect', async () => {
    const { bridge } = harness(async () => { throw new Error('ECONNREFUSED'); });

    await bridge.onApplicationBootstrap();

    expect(bridge.live).toBe(false);
  });

  it('DISTRACTOR: retries until it connects, rather than giving up silently', async () => {
    // A one-shot attempt would leave the dashboard permanently dead after any
    // transient startup race with Postgres — indistinguishable from an idle system.
    const fake = fakeListener();
    let attempts = 0;
    const received: LedgerNotification[] = [];
    const bridge = new LedgerLiveBridge(
      { onNotification: async (n) => void received.push(n) },
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('ECONNREFUSED');
        return fake.listener;
      },
      { retryDelayMs: 1 },
    );

    await bridge.onApplicationBootstrap();
    await vi.waitFor(() => expect(bridge.live).toBe(true));

    expect(attempts).toBe(3);
    fake.emit(POINTER);
    await vi.waitFor(() => expect(received).toHaveLength(1));
  });
});
