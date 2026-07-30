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

/**
 * R21 — the fleet view. Mission Control opened on an empty box demanding a
 * UUID, which makes it unusable to anyone who does not already know what to
 * type. The rail is derived from the ledger by aggregation: there is no mission
 * table, so the fleet cannot fall out of step with the trail.
 */
describe('R21 — listMissions projects the fleet out of the ledger', () => {
  it('summarises each mission with its objective, status and counts', async () => {
    const missionId = randomUUID();
    await ledger.append(makeEvent({ missionId, type: 'mission.started', payload: { objective: 'Explain heat pumps.' } }));
    await ledger.append(makeEvent({ missionId, type: 'task.contracted' }));
    await ledger.append(makeEvent({ missionId, type: 'escalation.rung_climbed' }));
    await ledger.append(makeEvent({ missionId, type: 'mission.folded' }));

    const found = (await ledger.listMissions()).find((m) => m.missionId === missionId);

    expect(found).toBeDefined();
    expect(found?.objective).toBe('Explain heat pumps.');
    expect(found?.status).toBe('delivered');
    expect(found?.eventCount).toBe(4);
    expect(found?.escalations).toBe(1);
  });

  it('reports a mission with no terminal event as still running', async () => {
    const missionId = randomUUID();
    await ledger.append(makeEvent({ missionId, type: 'mission.started', payload: { objective: 'In flight.' } }));

    const found = (await ledger.listMissions()).find((m) => m.missionId === missionId);

    expect(found?.status).toBe('running');
  });

  it('DISTRACTOR: surrender wins over fold — the cheerier outcome is not reported', async () => {
    // A dashboard that resolves this tie the other way tells the operator a
    // mission delivered when it did not.
    const missionId = randomUUID();
    await ledger.append(makeEvent({ missionId, type: 'mission.started', payload: { objective: 'Both.' } }));
    await ledger.append(makeEvent({ missionId, type: 'mission.folded' }));
    await ledger.append(makeEvent({ missionId, type: 'mission.surrendered' }));

    const found = (await ledger.listMissions()).find((m) => m.missionId === missionId);

    expect(found?.status).toBe('surrendered');
  });

  it('DISTRACTOR: counts belong to their own mission, not the whole table', async () => {
    // Without GROUP BY this passes trivially on a one-mission table and is
    // catastrophically wrong the moment a second mission exists.
    const a = randomUUID();
    const b = randomUUID();
    await ledger.append(makeEvent({ missionId: a, type: 'mission.started', payload: { objective: 'A' } }));
    await ledger.append(makeEvent({ missionId: b, type: 'mission.started', payload: { objective: 'B' } }));
    await ledger.append(makeEvent({ missionId: b, type: 'task.contracted' }));

    const missions = await ledger.listMissions();
    const summaryA = missions.find((m) => m.missionId === a);
    const summaryB = missions.find((m) => m.missionId === b);

    expect(summaryA?.eventCount).toBe(1);
    expect(summaryB?.eventCount).toBe(2);
    expect(summaryA?.objective).toBe('A');
    expect(summaryB?.objective).toBe('B');
  });

  it('orders by most recent activity, so the rail opens on what is happening now', async () => {
    const older = randomUUID();
    const newer = randomUUID();
    await ledger.append(makeEvent({ missionId: older, type: 'mission.started', payload: { objective: 'Older' } }));
    await ledger.append(makeEvent({ missionId: newer, type: 'mission.started', payload: { objective: 'Newer' } }));

    const missions = await ledger.listMissions();
    const indexOfOlder = missions.findIndex((m) => m.missionId === older);
    const indexOfNewer = missions.findIndex((m) => m.missionId === newer);

    expect(indexOfNewer).toBeLessThan(indexOfOlder);
  });
});

describe('R21 — fleet totals come from the ledger too', () => {
  it('counts staffed agents and tasks contracted today', async () => {
    // `makeEvent` dates its fixtures in the past, so "today" must be explicit —
    // which is the point: the count is about when the work happened, not when
    // the row was written.
    const today = new Date().toISOString();
    const missionId = randomUUID();
    await ledger.append(makeEvent({ missionId, type: 'mission.started', payload: { objective: 'Totals.' } }));
    await ledger.append(makeEvent({ missionId, type: 'task.contracted', occurredAt: today }));
    await ledger.append(makeEvent({ missionId, type: 'task.contracted', occurredAt: today }));
    await ledger.append(makeEvent({ missionId, type: 'agent.staffed' }));

    const found = (await ledger.listMissions()).find((m) => m.missionId === missionId);

    expect(found?.agentsStaffed).toBe(1);
    expect(found?.tasksToday).toBe(2);
  });

  it('DISTRACTOR: a task contracted before today is not counted as today', async () => {
    // Without the date filter this is just a total, and the operator reads a
    // number that never resets as "how busy is the swarm right now".
    const missionId = randomUUID();
    const today = new Date().toISOString();
    await ledger.append(makeEvent({ missionId, type: 'task.contracted', occurredAt: '2020-01-01T00:00:00.000Z' }));
    await ledger.append(makeEvent({ missionId, type: 'task.contracted', occurredAt: today }));

    const found = (await ledger.listMissions()).find((m) => m.missionId === missionId);

    // One of the two is old: a plain COUNT would say 2.
    expect(found?.tasksToday).toBe(1);
  });
});

/**
 * R18 — the attention queue. "Each item shows its full context inline — the
 * contract, the verdicts, what was tried — so deciding never requires an
 * investigation."
 *
 * Derived, like everything else: an item is open because the trail says a task
 * reached the human rung and nothing has answered it. There is no queue table,
 * so the queue cannot disagree with the ledger about what is waiting.
 */
describe('R18 — the attention queue is folded out of the ledger', () => {
  it('lists a task that reached the human rung, with the context to decide on', async () => {
    const missionId = randomUUID();
    const taskId = randomUUID();
    await ledger.append(makeEvent({ missionId, type: 'mission.started', payload: { objective: 'Root' } }));
    await ledger.append(makeEvent({
      missionId, taskId, type: 'task.contracted',
      payload: { objective: 'Count the sand.', acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'Exact count.' }] },
    }));
    await ledger.append(makeEvent({
      missionId, taskId, type: 'escalation.awaiting_human',
      payload: { objective: 'Count the sand.', rung: 'human_review', autonomyDial: 'checkpointed', findings: ['no census exists'] },
    }));

    const items = await ledger.listAttentionItems();
    const item = items.find((i) => i.taskId === taskId);

    expect(item).toBeDefined();
    expect(item?.objective).toBe('Count the sand.');
    expect(item?.rung).toBe('human_review');
    expect(item?.findings).toEqual(['no census exists']);
    expect(item?.missionId).toBe(missionId);
  });

  it('DISTRACTOR: an ANSWERED item leaves the queue', async () => {
    // A queue that only grows is a list, not a queue — and an operator would
    // re-decide the same thing forever.
    const missionId = randomUUID();
    const taskId = randomUUID();
    await ledger.append(makeEvent({ missionId, taskId, type: 'escalation.awaiting_human', payload: { objective: 'X', rung: 'human_review' } }));
    await ledger.append(makeEvent({ missionId, taskId, type: 'operator.decided', payload: { decision: 'approve' } }));

    const items = await ledger.listAttentionItems();

    expect(items.some((i) => i.taskId === taskId)).toBe(false);
  });

  it('DISTRACTOR: answering ONE task does not clear another', async () => {
    const missionId = randomUUID();
    const answered = randomUUID();
    const waiting = randomUUID();
    await ledger.append(makeEvent({ missionId, taskId: answered, type: 'escalation.awaiting_human', payload: { objective: 'A', rung: 'human_review' } }));
    await ledger.append(makeEvent({ missionId, taskId: waiting, type: 'escalation.awaiting_human', payload: { objective: 'B', rung: 'human_review' } }));
    await ledger.append(makeEvent({ missionId, taskId: answered, type: 'operator.decided', payload: { decision: 'approve' } }));

    const items = await ledger.listAttentionItems();

    expect(items.some((i) => i.taskId === answered)).toBe(false);
    expect(items.some((i) => i.taskId === waiting)).toBe(true);
  });

  it('carries the acceptance criteria so the decision needs no second lookup', async () => {
    const missionId = randomUUID();
    const taskId = randomUUID();
    await ledger.append(makeEvent({
      missionId, taskId, type: 'task.contracted',
      payload: { objective: 'Y', acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'Cites a source.' }] },
    }));
    await ledger.append(makeEvent({ missionId, taskId, type: 'escalation.awaiting_human', payload: { objective: 'Y', rung: 'human_review' } }));

    const item = (await ledger.listAttentionItems()).find((i) => i.taskId === taskId);

    expect(item?.acceptanceCriteria.map((c) => c.statement)).toEqual(['Cites a source.']);
  });

  it('DISTRACTOR: a mission with nothing waiting contributes no items', async () => {
    const missionId = randomUUID();
    await ledger.append(makeEvent({ missionId, type: 'mission.started', payload: { objective: 'Fine' } }));
    await ledger.append(makeEvent({ missionId, type: 'mission.folded', payload: {} }));

    const items = await ledger.listAttentionItems();

    expect(items.some((i) => i.missionId === missionId)).toBe(false);
  });
});

/**
 * R34 AC-3 — "given a verdict that has been issued, when any component attempts
 * to amend or withdraw it, then the attempt fails — verdicts are immutable once
 * issued, and a later correction is a new verdict, not an edit."
 *
 * The general append-only guarantee above is about ledger rows. This is about
 * VERDICTS specifically, and it is a different claim: a reviewer that could
 * revise its own past judgement would make the audit trail a record of current
 * opinion rather than of what was actually decided, and every downstream
 * decision that cited the old verdict would silently refer to something else.
 *
 * Raw SQL on purpose — the guarantee must hold against anything holding a
 * connection, not merely against callers who go through a repository.
 */
describe('R34 AC-3 — an issued verdict cannot be amended or withdrawn', () => {
  const verdict = (outcome: 'pass' | 'fail', taskId: string) =>
    makeEvent({
      taskId,
      family: 'verification',
      type: 'gate_b.verdict_issued',
      actor: { kind: 'reviewer', id: randomUUID(), displayName: 'Reviewer' },
      payload: { gate: 'B', outcome, findings: [], redFlags: [], verificationDepth: 'single' },
    });

  it('refuses to AMEND the outcome of an issued verdict', async () => {
    const issued = await ledger.append(verdict('fail', randomUUID()));

    await expect(
      db.pool.query(
        `UPDATE ledger_event SET payload = jsonb_set(payload, '{outcome}', '"pass"') WHERE seq = $1`,
        [issued.seq],
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it('refuses to WITHDRAW an issued verdict', async () => {
    const issued = await ledger.append(verdict('fail', randomUUID()));

    await expect(
      db.pool.query('DELETE FROM ledger_event WHERE seq = $1', [issued.seq]),
    ).rejects.toThrow(/append-only/i);
  });

  it('a later correction is a NEW verdict — and BOTH remain in the trail', async () => {
    // The positive half. Immutability that made correction impossible would be
    // a system that cannot be wrong out loud, so the trail must carry the
    // reversal AND what it reversed.
    const taskId = randomUUID();
    const missionId = randomUUID();
    await ledger.append({ ...verdict('fail', taskId), missionId });
    await ledger.append({ ...verdict('pass', taskId), missionId });

    const replayed = await ledger.replay({ missionId });
    const verdicts = replayed.filter((e) => e.type === 'gate_b.verdict_issued');

    expect(verdicts).toHaveLength(2);
    expect(verdicts.map((v) => (v.payload as { outcome: string }).outcome)).toEqual(['fail', 'pass']);
  });

  it('DISTRACTOR: the correction does not erase the original — replay still shows the fail', async () => {
    // If a correction quietly replaced its predecessor, time travel would
    // reconstruct a past that never happened: a moment when the task had always
    // passed. The whole point of an append-only trail is that the earlier
    // judgement is still there to be found.
    const taskId = randomUUID();
    const missionId = randomUUID();
    await ledger.append({ ...verdict('fail', taskId), missionId });
    await ledger.append({ ...verdict('pass', taskId), missionId });

    const replayed = await ledger.replay({ missionId });

    expect(
      replayed.some((e) => (e.payload as { outcome?: string }).outcome === 'fail'),
      'the reversed verdict must still be in the trail',
    ).toBe(true);
  });
});
