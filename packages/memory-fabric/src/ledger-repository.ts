/**
 * The Audit Ledger — the one substrate.
 *
 * Everything the system does lands here, and nothing is ever changed: there is
 * no update path in this class by design, and the database rejects one anyway.
 * To correct the record you append a corrective event, which keeps the history
 * of the correction as auditable as the mistake.
 */
import {
  assertValid,
  LedgerEventInputSchema,
  type Actor,
  type LedgerEvent,
  type LedgerEventFamily,
  type LedgerEventInput,
} from '@artifex/shared-types';
import type { Pool } from 'pg';

/** The `LISTEN/NOTIFY` channel the live dashboard stream rides on. */
export const LEDGER_CHANNEL = 'artifex_ledger';

const RETURNED_COLUMNS = `
  seq, event_id, mission_id, task_id, family, type, actor, payload, occurred_at, recorded_at
`;

interface LedgerEventRow {
  /** `bigint` arrives from pg as a string. */
  seq: string;
  event_id: string;
  mission_id: string;
  task_id: string | null;
  family: string;
  type: string;
  actor: Actor;
  payload: Record<string, unknown>;
  occurred_at: Date;
  recorded_at: Date;
}

function toLedgerEvent(row: LedgerEventRow): LedgerEvent {
  return {
    seq: Number(row.seq),
    eventId: row.event_id,
    missionId: row.mission_id,
    taskId: row.task_id,
    // Safe: every row was validated against the shared schema before insert,
    // and the table is append-only, so the stored value cannot have drifted.
    family: row.family as LedgerEventFamily,
    type: row.type,
    actor: row.actor,
    payload: row.payload,
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(),
  };
}

export interface ReplayFilter {
  missionId?: string;
}

export class LedgerRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Append one typed event.
   *
   * Validation happens *before* the write: an event that doesn't satisfy the
   * shared schema must never reach the table, because nothing can delete it
   * afterwards.
   */
  async append(input: LedgerEventInput): Promise<LedgerEvent> {
    const event = assertValid(LedgerEventInputSchema, input);

    const result = await this.pool.query<LedgerEventRow>(
      `INSERT INTO ledger_event
         (event_id, mission_id, task_id, family, type, actor, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${RETURNED_COLUMNS}`,
      [
        event.eventId,
        event.missionId,
        event.taskId,
        event.family,
        event.type,
        JSON.stringify(event.actor),
        JSON.stringify(event.payload),
        event.occurredAt,
      ],
    );

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('ledger append returned no row');
    }
    return toLedgerEvent(row);
  }

  /** Every event, oldest first — the time-travel replay order. */
  async replay(filter: ReplayFilter = {}): Promise<LedgerEvent[]> {
    const result =
      filter.missionId === undefined
        ? await this.pool.query<LedgerEventRow>(
            `SELECT ${RETURNED_COLUMNS} FROM ledger_event ORDER BY seq ASC`,
          )
        : await this.pool.query<LedgerEventRow>(
            `SELECT ${RETURNED_COLUMNS} FROM ledger_event
             WHERE mission_id = $1 ORDER BY seq ASC`,
            [filter.missionId],
          );

    return result.rows.map(toLedgerEvent);
  }

  /**
   * Events after `seq`, oldest first — how a stream consumer catches up after a
   * disconnect, and how a NOTIFY listener fetches what it was told about.
   */
  async readSince(seq: number, filter: ReplayFilter = {}): Promise<LedgerEvent[]> {
    const result =
      filter.missionId === undefined
        ? await this.pool.query<LedgerEventRow>(
            `SELECT ${RETURNED_COLUMNS} FROM ledger_event
             WHERE seq > $1 ORDER BY seq ASC`,
            [seq],
          )
        : await this.pool.query<LedgerEventRow>(
            `SELECT ${RETURNED_COLUMNS} FROM ledger_event
             WHERE seq > $1 AND mission_id = $2 ORDER BY seq ASC`,
            [seq, filter.missionId],
          );

    return result.rows.map(toLedgerEvent);
  }

  async count(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM ledger_event',
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
