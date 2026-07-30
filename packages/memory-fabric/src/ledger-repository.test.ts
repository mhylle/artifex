import { randomUUID } from 'node:crypto';

import { LedgerEventSchema, SchemaValidationError, validate } from '@artifex/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeEvent, startTestDatabase, withTimeout, type TestDatabase } from './__fixtures__/test-db.js';
import { LedgerListener } from './ledger-listener.js';
import { LedgerRepository } from './ledger-repository.js';

let db: TestDatabase;
let ledger: LedgerRepository;

beforeAll(async () => {
  db = await startTestDatabase();
  ledger = new LedgerRepository(db.pool);
});

afterAll(async () => {
  await db?.stop();
});

/**
 * R2 AC-0 — "Given a valid typed event, when appended to the ledger, then it
 * persists with a strictly greater monotonic id and a LISTEN/NOTIFY
 * notification is emitted."
 */
describe('R2 AC-0 — append assigns a monotonic id and notifies', () => {
  it('assigns a strictly greater id to each successive append', async () => {
    const first = await ledger.append(makeEvent());
    const second = await ledger.append(makeEvent());
    const third = await ledger.append(makeEvent());

    expect(second.seq).toBeGreaterThan(first.seq);
    expect(third.seq).toBeGreaterThan(second.seq);
  });

  it('returns a row that round-trips through the shared LedgerEvent schema', async () => {
    const appended = await ledger.append(makeEvent());

    // Proves the persisted row maps back to the typed shape, not just to
    // "something the repository happened to build".
    expect(validate(LedgerEventSchema, appended)).toEqual({ ok: true, value: appended });
  });

  it('emits a NOTIFY carrying the appended id', async () => {
    const listener = await LedgerListener.start(db.connectionString);
    try {
      const arrived = new Promise<{ seq: number; eventId: string }>((resolve) => {
        listener.onNotification(resolve);
      });

      const appended = await ledger.append(makeEvent());
      const notification = await withTimeout(arrived, 10_000, 'ledger NOTIFY');

      expect(notification.eventId).toBe(appended.eventId);
      expect(notification.seq).toBe(appended.seq);
    } finally {
      await listener.stop();
    }
  });

  // Distractor: kills an implementation that writes first and validates later
  // (or never). Typed events only — an invalid one must never reach the table.
  it('DISTRACTOR: refuses a schema-invalid event before it reaches the database', async () => {
    const before = await ledger.count();

    await expect(
      ledger.append(makeEvent({ family: 'not-a-real-family' } as never)),
    ).rejects.toBeInstanceOf(SchemaValidationError);

    expect(await ledger.count()).toBe(before);
  });
});

/**
 * R2 AC-1 — "Given a persisted ledger row, when an UPDATE or DELETE is
 * attempted, then the operation is rejected (append-only is enforced at the
 * database level)."
 *
 * Deliberately issued as raw SQL: the guarantee must hold against anything with
 * a connection, not merely against callers who go through the repository.
 */
describe('R2 AC-1 — the ledger is append-only in the database', () => {
  it('rejects UPDATE', async () => {
    const appended = await ledger.append(makeEvent());

    await expect(
      db.pool.query('UPDATE ledger_event SET type = $1 WHERE seq = $2', ['tampered', appended.seq]),
    ).rejects.toThrow(/append-only/i);
  });

  it('rejects DELETE', async () => {
    const appended = await ledger.append(makeEvent());

    await expect(
      db.pool.query('DELETE FROM ledger_event WHERE seq = $1', [appended.seq]),
    ).rejects.toThrow(/append-only/i);
  });

  // Distractor: a trigger that raises but still lets the write through would
  // pass the two tests above. Prove the row is untouched and still present.
  it('DISTRACTOR: leaves the row intact after the rejected attempts', async () => {
    const appended = await ledger.append(makeEvent({ type: 'original.type' }));

    await expect(
      db.pool.query('UPDATE ledger_event SET type = $1 WHERE seq = $2', ['tampered', appended.seq]),
    ).rejects.toThrow();
    await expect(
      db.pool.query('DELETE FROM ledger_event WHERE seq = $1', [appended.seq]),
    ).rejects.toThrow();

    const stillThere = await ledger.readSince(appended.seq - 1);
    const row = stillThere.find((e) => e.seq === appended.seq);
    expect(row).toBeDefined();
    expect(row?.type).toBe('original.type');
  });
});

/**
 * R2 AC-2 — "Given N events appended in a known order, when replayed by
 * ascending id, then they are returned in exactly that append order."
 */
describe('R2 AC-2 — replay returns exact append order', () => {
  it('replays a mission’s events in the order they were appended', async () => {
    const missionId = randomUUID();
    const appended = [];
    for (let index = 0; index < 12; index += 1) {
      appended.push(await ledger.append(makeEvent({ missionId, type: `step.${index}` })));
    }

    const replayed = await ledger.replay({ missionId });

    expect(replayed.map((e) => e.eventId)).toEqual(appended.map((e) => e.eventId));
    expect(replayed.map((e) => e.type)).toEqual(appended.map((e) => e.type));
  });

  // Distractor: kills an implementation with no ORDER BY that happens to come
  // back in insertion order on a small table. Interleaving a second mission
  // means "whatever the heap returns" is very unlikely to match.
  it('DISTRACTOR: ids are strictly ascending even with another mission interleaved', async () => {
    const missionId = randomUUID();
    const otherMissionId = randomUUID();
    const appended = [];
    for (let index = 0; index < 8; index += 1) {
      appended.push(await ledger.append(makeEvent({ missionId, type: `step.${index}` })));
      await ledger.append(makeEvent({ missionId: otherMissionId, type: 'noise' }));
    }

    const replayed = await ledger.replay({ missionId });
    const seqs = replayed.map((e) => e.seq);

    expect(replayed.map((e) => e.eventId)).toEqual(appended.map((e) => e.eventId));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(replayed.every((e) => e.missionId === missionId)).toBe(true);
  });

  it('readSince returns only events after the given id, in order', async () => {
    const missionId = randomUUID();
    const first = await ledger.append(makeEvent({ missionId }));
    const second = await ledger.append(makeEvent({ missionId }));
    const third = await ledger.append(makeEvent({ missionId }));

    const since = await ledger.readSince(first.seq);
    const ids = since.map((e) => e.eventId);

    expect(ids).toContain(second.eventId);
    expect(ids).toContain(third.eventId);
    expect(ids).not.toContain(first.eventId);
  });
});

describe('defect 8a6ee598 — the live tail must not skip a late-committing event', () => {
  /**
   * `seq` is handed out at INSERT, not at COMMIT. Two parallel writers can
   * therefore make seq 2 visible while seq 1 is still in flight, and a consumer
   * polling readSince(lastSeq) advances past 1 and never sees it. Reproduced
   * here with two real transactions, because this is a database behaviour and
   * mocking it would prove nothing.
   */
  it('readSince SKIPS a lower seq that commits later — the bug, reproduced', async () => {
    const mission = randomUUID();
    const before = await ledger.count();

    const slow = await db.pool.connect();
    const fast = await db.pool.connect();
    try {
      await slow.query('BEGIN');
      await fast.query('BEGIN');

      // slow takes the LOWER seq but has not committed.
      await slow.query(
        `INSERT INTO ledger_event (event_id, mission_id, task_id, family, type, actor, payload, occurred_at)
         VALUES ($1,$2,NULL,'execution','slow','{"kind":"worker","id":"w","displayName":null}'::jsonb,'{}'::jsonb, now())`,
        [randomUUID(), mission],
      );
      await fast.query(
        `INSERT INTO ledger_event (event_id, mission_id, task_id, family, type, actor, payload, occurred_at)
         VALUES ($1,$2,NULL,'execution','fast','{"kind":"worker","id":"w","displayName":null}'::jsonb,'{}'::jsonb, now())`,
        [randomUUID(), mission],
      );

      await fast.query('COMMIT');

      // The naive read sees "fast" and advances past the seq "slow" still holds.
      const naive = await ledger.readSince(before, { missionId: mission });
      expect(naive.map((e) => e.type)).toEqual(['fast']);

      // The horizon-aware read returns NOTHING while "slow" is still open —
      // it refuses to advance past a seq that is not yet safe.
      const safe = await ledger.readSinceCommitted(before, { missionId: mission });
      expect(safe).toEqual([]);

      await slow.query('COMMIT');
    } finally {
      slow.release();
      fast.release();
    }

    // Once both are committed, the horizon read returns BOTH, in seq order.
    const settled = await ledger.readSinceCommitted(before, { missionId: mission });
    expect(settled.map((e) => e.type)).toEqual(['slow', 'fast']);
  });

  it('DISTRACTOR: with no writer in flight, the horizon read returns events immediately', async () => {
    // Otherwise "always return nothing" would satisfy the test above, and the
    // live tail would simply never advance.
    const mission = randomUUID();
    const before = await ledger.count();
    await ledger.append(makeEvent({ missionId: mission, type: 'settled' }));

    expect((await ledger.readSinceCommitted(before, { missionId: mission })).map((e) => e.type)).toEqual([
      'settled',
    ]);
  });
});
