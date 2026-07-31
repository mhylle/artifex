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

/**
 * One row of the fleet view (R21) — a mission as the operator sees it in the rail.
 *
 * Every field is DERIVED from the ledger by aggregation; nothing here is stored.
 * That is the invariant the dashboard rests on ("a view, never a second truth"):
 * there is no mission table to fall out of step with the trail, and a mission
 * exists in the fleet exactly when it has events.
 */
/**
 * One item waiting on a human (R18).
 *
 * Everything an operator needs to decide travels with the item — objective,
 * criteria, what the reviewer found, which rung it stopped at, the dial in force
 * — because "deciding never requires an investigation". A queue that only
 * carries ids would send the operator hunting through the trail, which is the
 * cost this design exists to remove.
 */
export interface AttentionItem {
  readonly missionId: string;
  readonly taskId: string;
  readonly objective: string;
  readonly rung: string;
  readonly autonomyDial: string | null;
  readonly findings: readonly string[];
  readonly acceptanceCriteria: readonly { criterionId: string; statement: string }[];
  readonly waitingSince: string;
}

interface AttentionRow {
  mission_id: string;
  task_id: string;
  objective: string | null;
  rung: string | null;
  autonomy_dial: string | null;
  findings: unknown;
  acceptance_criteria: unknown;
  waiting_since: Date;
}

export interface MissionSummary {
  readonly missionId: string;
  /** From the `mission.started` event; null until the runtime picks it up. */
  readonly objective: string | null;
  readonly status: 'running' | 'delivered' | 'surrendered';
  readonly eventCount: number;
  readonly escalations: number;
  /** Specialists staffed for this mission — the fleet's "agents active" total. */
  readonly agentsStaffed: number;
  /** Tasks contracted since local midnight — the fleet's "tasks today" total. */
  readonly tasksToday: number;
  readonly lastEventAt: string;
}

interface MissionSummaryRow {
  mission_id: string;
  objective: string | null;
  delivered: boolean;
  surrendered: boolean;
  event_count: string;
  escalations: string;
  agents_staffed: string;
  tasks_today: string;
  last_event_at: Date;
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

  /**
   * Read forward from `seq`, stopping at the commit horizon (defect `8a6ee598`).
   *
   * `seq` is handed out at INSERT, not at COMMIT. With parallel writers, seq 2
   * can therefore become visible while seq 1 is still in flight — and a consumer
   * polling {@link readSince} would advance past 1 and never see it. Replay from
   * zero was always safe; only the live tail could skip.
   *
   * This returns only rows whose inserting transaction is *definitely* finished:
   * everything below the current snapshot's xmin. Postgres already knows exactly
   * what is still in flight, so no guessing is required.
   *
   * Note what this deliberately is NOT: a "lag by N seconds" window. That number
   * would be simultaneously too slow on a quiet system and too fast on a busy
   * one, and it would turn a correctness property into a tuning parameter. The
   * horizon is exact — the cost is latency measured in the lifetime of the
   * oldest open write transaction, which is the true bound on when an event
   * *can* be known safe.
   */
  async readSinceCommitted(seq: number, filter: ReplayFilter = {}): Promise<LedgerEvent[]> {
    const horizon = `inserted_xid < pg_snapshot_xmin(pg_current_snapshot())`;

    const result =
      filter.missionId === undefined
        ? await this.pool.query<LedgerEventRow>(
            `SELECT ${RETURNED_COLUMNS} FROM ledger_event
             WHERE seq > $1 AND ${horizon} ORDER BY seq ASC`,
            [seq],
          )
        : await this.pool.query<LedgerEventRow>(
            `SELECT ${RETURNED_COLUMNS} FROM ledger_event
             WHERE seq > $1 AND mission_id = $2 AND ${horizon} ORDER BY seq ASC`,
            [seq, filter.missionId],
          );

    return result.rows.map(toLedgerEvent);
  }

  /**
   * Every mission the ledger knows about, newest activity first (R21).
   *
   * Aggregated in one pass rather than replaying each mission and folding in
   * TypeScript: the fleet view is the first screen an operator sees, and it must
   * not cost one query per mission — that is the shape that stops working
   * exactly when the system starts being used.
   *
   * `objective` is picked from `mission.started` rather than intake, because
   * intake's event belongs to the control plane and the runtime is what proves a
   * mission actually began.
   */
  async listMissions(): Promise<MissionSummary[]> {
    const result = await this.pool.query<MissionSummaryRow>(`
      SELECT
        mission_id,
        (ARRAY_AGG(payload->>'objective') FILTER (WHERE type = 'mission.started'))[1] AS objective,
        BOOL_OR(type = 'mission.folded')      AS delivered,
        BOOL_OR(type = 'mission.surrendered') AS surrendered,
        COUNT(*)                              AS event_count,
        COUNT(*) FILTER (WHERE type = 'escalation.rung_climbed') AS escalations,
        COUNT(*) FILTER (WHERE type = 'agent.staffed')           AS agents_staffed,
        -- "Today" is the calendar day, not a rolling window: an operator reading
        -- a dashboard means today, and a rolling N hours would be a number
        -- nobody asked for.
        COUNT(*) FILTER (
          WHERE type = 'task.contracted' AND occurred_at >= date_trunc('day', now())
        )                                     AS tasks_today,
        MAX(occurred_at)                      AS last_event_at
      FROM ledger_event
      GROUP BY mission_id
      ORDER BY MAX(seq) DESC
    `);

    return result.rows.map((row) => ({
      missionId: row.mission_id,
      objective: row.objective,
      // Surrender wins a tie: a mission that folded AND surrendered has not
      // delivered, and reporting the cheerier of two outcomes is how a dashboard
      // starts lying.
      status: row.surrendered ? 'surrendered' : row.delivered ? 'delivered' : 'running',
      eventCount: Number(row.event_count),
      escalations: Number(row.escalations),
      agentsStaffed: Number(row.agents_staffed),
      tasksToday: Number(row.tasks_today),
      lastEventAt: row.last_event_at.toISOString(),
    }));
  }

  /**
   * Everything waiting on a human, newest first (R18).
   *
   * An item is open because the trail says a task reached the human rung and no
   * decision followed it — there is no queue table, so the queue cannot drift
   * from the ledger about what is actually waiting.
   *
   * The contract's criteria are joined in from `task.contracted` rather than
   * duplicated onto the escalation event: one fact, recorded once, read where
   * it is needed.
   */
  async listAttentionItems(): Promise<AttentionItem[]> {
    const result = await this.pool.query<AttentionRow>(`
      WITH waiting AS (
        SELECT DISTINCT ON (task_id)
          mission_id, task_id, payload, occurred_at
        FROM ledger_event
        WHERE type = 'escalation.awaiting_human' AND task_id IS NOT NULL
        ORDER BY task_id, seq DESC
      ),
      answered AS (
        -- The task_id IS NOT NULL filter is load-bearing, not tidiness.
        -- Petition decisions (R29) are operator.decided rows with a NULL
        -- task_id, and a single NULL in this set makes the outer NOT IN
        -- evaluate to NULL for EVERY task -- emptying the entire attention
        -- queue. Caught by the distractor asserting ordinary task escalations
        -- still appear alongside petitions.
        -- (No backticks in here: this block sits inside a TS template literal.)
        SELECT DISTINCT task_id FROM ledger_event
         WHERE type = 'operator.decided' AND task_id IS NOT NULL
      ),
      -- Petitions wait here too (R29 AC-1). A petition is about the system's
      -- RULES rather than a unit of work, so it has no task_id and the query
      -- above cannot see it — and a petition recorded somewhere nobody looks is
      -- not "surfaced for an out-of-band human decision", it is filed and
      -- forgotten. Keyed on the petition's own id, and ADDITIVE: the task branch
      -- is untouched.
      petitions AS (
        SELECT DISTINCT ON (payload->>'petitionId')
          mission_id, payload, occurred_at
        FROM ledger_event
        WHERE type = 'escalation.awaiting_human'
          AND task_id IS NULL
          AND payload->>'petitionId' IS NOT NULL
        ORDER BY payload->>'petitionId', seq DESC
      ),
      -- Answered per PETITION, not "any decision happened". One ratification
      -- clearing the whole queue is how a rule change slips through attached to
      -- an unrelated approval.
      petitions_answered AS (
        SELECT DISTINCT payload->>'petitionId' AS petition_id
        FROM ledger_event
        WHERE type = 'operator.decided' AND payload->>'petitionId' IS NOT NULL
      ),
      contracted AS (
        SELECT DISTINCT ON (task_id)
          task_id, payload AS contract_payload
        FROM ledger_event
        WHERE type = 'task.contracted' AND task_id IS NOT NULL
        ORDER BY task_id, seq DESC
      )
      SELECT
        w.mission_id,
        w.task_id,
        w.payload->>'objective'          AS objective,
        w.payload->>'rung'               AS rung,
        w.payload->>'autonomyDial'       AS autonomy_dial,
        w.payload->'findings'            AS findings,
        c.contract_payload->'acceptanceCriteria' AS acceptance_criteria,
        w.occurred_at                    AS waiting_since
      FROM waiting w
      LEFT JOIN contracted c ON c.task_id = w.task_id
      WHERE w.task_id NOT IN (SELECT task_id FROM answered)
      UNION ALL
      SELECT
        p.mission_id,
        (p.payload->>'petitionId')::uuid  AS task_id,
        p.payload->>'objective'           AS objective,
        p.payload->>'rung'                AS rung,
        p.payload->>'autonomyDial'        AS autonomy_dial,
        p.payload->'findings'             AS findings,
        NULL::jsonb                       AS acceptance_criteria,
        p.occurred_at                     AS waiting_since
      FROM petitions p
      WHERE p.payload->>'petitionId' NOT IN (SELECT petition_id FROM petitions_answered)
      ORDER BY waiting_since DESC
    `);

    return result.rows.map((row) => ({
      missionId: row.mission_id,
      taskId: row.task_id,
      objective: row.objective ?? '',
      rung: row.rung ?? 'human_review',
      autonomyDial: row.autonomy_dial,
      findings: Array.isArray(row.findings) ? row.findings.map(String) : [],
      acceptanceCriteria: Array.isArray(row.acceptance_criteria)
        ? (row.acceptance_criteria as Array<{ criterionId?: unknown; statement?: unknown }>).map((c) => ({
            criterionId: String(c.criterionId ?? ''),
            statement: String(c.statement ?? ''),
          }))
        : [],
      waitingSince: row.waiting_since.toISOString(),
    }));
  }

  async count(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM ledger_event',
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
