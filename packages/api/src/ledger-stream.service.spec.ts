/**
 * P10 — the live ledger stream (R10 AC-2, API half).
 *
 * The dashboard renders ledger events and persists nothing of its own, so this
 * service is the only thing standing between a Postgres NOTIFY and a browser.
 * Two properties matter: a subscriber gets *its own* mission's events and
 * nobody else's, and a subscriber that joins late is not silently missing
 * history — because NOTIFY carries a pointer, not the event.
 */
import { LedgerStreamService } from './ledger-stream.service';
import type { LedgerNotification, LedgerReader } from './ledger.types';

const MISSION_A = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';
const MISSION_B = 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39';

function event(missionId: string, seq: number, type = 'task.executed') {
  return {
    seq, eventId: `e-${seq}`, missionId, taskId: null,
    family: 'execution', type,
    actor: { kind: 'worker' as const, id: 'w', displayName: null },
    payload: {}, occurredAt: '2026-07-30T09:00:00.000Z', recordedAt: '2026-07-30T09:00:00.000Z',
  };
}

function readerOf(events: ReturnType<typeof event>[]): LedgerReader {
  return { async replay({ missionId }) { return events.filter((e) => e.missionId === missionId) as never; } };
}

function notification(missionId: string, seq: number): LedgerNotification {
  return { seq, eventId: `e-${seq}`, missionId, taskId: null, family: 'execution', type: 'task.executed' };
}

describe('R10 AC-2 — live ledger events reach the right subscriber', () => {
  it('delivers an event to a subscriber watching that mission', async () => {
    const service = new LedgerStreamService(readerOf([event(MISSION_A, 1)]));
    const seen: unknown[] = [];
    service.subscribe(MISSION_A, (e) => seen.push(e));

    await service.onNotification(notification(MISSION_A, 1));

    expect(seen).toHaveLength(1);
  });

  it('DISTRACTOR: a subscriber does NOT receive another mission\'s events', async () => {
    // Missions are isolated. Leaking B's trail into A's cockpit would be both a
    // correctness bug and a confidentiality one.
    const service = new LedgerStreamService(readerOf([event(MISSION_B, 1)]));
    const seen: unknown[] = [];
    service.subscribe(MISSION_A, (e) => seen.push(e));

    await service.onNotification(notification(MISSION_B, 1));

    expect(seen).toHaveLength(0);
  });

  it('reads the full event by seq — NOTIFY carries a pointer, not the payload', async () => {
    // Postgres caps NOTIFY at 8000 bytes and an evidence bundle exceeds it, so
    // the stream must hydrate from the ledger rather than trust the notification.
    const full = event(MISSION_A, 7, 'gate_b.verdict_issued');
    const service = new LedgerStreamService(readerOf([full]));
    const seen: Array<{ type: string }> = [];
    service.subscribe(MISSION_A, (e) => seen.push(e as { type: string }));

    await service.onNotification(notification(MISSION_A, 7));

    expect(seen[0]?.type).toBe('gate_b.verdict_issued');
  });

  it('a late subscriber gets the history it missed, then live events', async () => {
    // Opening the cockpit mid-mission must not show a mission that started
    // halfway through.
    const service = new LedgerStreamService(readerOf([event(MISSION_A, 1), event(MISSION_A, 2)]));
    const seen: Array<{ seq: number }> = [];

    await service.replayThenSubscribe(MISSION_A, (e) => seen.push(e as { seq: number }));

    expect(seen.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('DISTRACTOR: unsubscribing actually stops delivery', async () => {
    const service = new LedgerStreamService(readerOf([event(MISSION_A, 1)]));
    const seen: unknown[] = [];
    const stop = service.subscribe(MISSION_A, (e) => seen.push(e));

    stop();
    await service.onNotification(notification(MISSION_A, 1));

    expect(seen).toHaveLength(0);
  });

  it('DISTRACTOR: one failing subscriber does not starve the others', async () => {
    // A browser tab that throws must not take the whole stream down with it.
    const service = new LedgerStreamService(readerOf([event(MISSION_A, 1)]));
    const seen: unknown[] = [];
    service.subscribe(MISSION_A, () => { throw new Error('bad subscriber'); });
    service.subscribe(MISSION_A, (e) => seen.push(e));

    await service.onNotification(notification(MISSION_A, 1));

    expect(seen).toHaveLength(1);
  });

  it('an unknown seq is skipped rather than delivering a hole', async () => {
    const service = new LedgerStreamService(readerOf([]));
    const seen: unknown[] = [];
    service.subscribe(MISSION_A, (e) => seen.push(e));

    await service.onNotification(notification(MISSION_A, 99));

    expect(seen).toHaveLength(0);
  });
});
