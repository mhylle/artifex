/**
 * The Memory Fabric's first two stores: the Audit Ledger and the Model Catalog.
 *
 * The append-only guarantee and the live-stream NOTIFY are implemented here, in
 * the database, on purpose — they must hold against anything holding a
 * connection, not only against callers polite enough to use the repository.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export async function up(pgm) {
  pgm.sql(`
    CREATE TABLE ledger_event (
      -- The monotonic id. Ordering, replay, and time-travel are all defined by
      -- this column; it is generated ALWAYS so no writer can supply its own.
      seq         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event_id    uuid        NOT NULL UNIQUE,
      mission_id  uuid        NOT NULL,
      task_id     uuid,
      family      text        NOT NULL,
      type        text        NOT NULL,
      actor       jsonb       NOT NULL,
      payload     jsonb       NOT NULL,
      occurred_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Replay is almost always "this mission, in order".
  pgm.sql(`CREATE INDEX ledger_event_mission_seq_idx ON ledger_event (mission_id, seq);`);

  // NOTE: deliberately no CHECK constraint on `family`. The vocabulary lives in
  // the shared TypeBox schema and is enforced on append; duplicating the list
  // here would create exactly the drift ADR-0004 exists to prevent.

  pgm.sql(`
    CREATE FUNCTION ledger_event_reject_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'ledger_event is append-only: % is not permitted', TG_OP
        USING ERRCODE = '42501',
              HINT = 'Append a corrective event instead of changing history.';
    END;
    $$;
  `);

  pgm.sql(`
    CREATE TRIGGER ledger_event_append_only
      BEFORE UPDATE OR DELETE ON ledger_event
      FOR EACH ROW EXECUTE FUNCTION ledger_event_reject_mutation();
  `);

  // Row-level triggers never see TRUNCATE, so it needs its own statement-level
  // guard — otherwise the whole ledger is one command away from erasure.
  pgm.sql(`
    CREATE TRIGGER ledger_event_no_truncate
      BEFORE TRUNCATE ON ledger_event
      FOR EACH STATEMENT EXECUTE FUNCTION ledger_event_reject_mutation();
  `);

  pgm.sql(`
    CREATE FUNCTION ledger_event_notify_append() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      -- A pointer, not the event: NOTIFY payloads are capped at 8000 bytes and
      -- an evidence bundle will blow past that. Listeners read the row by seq,
      -- which is exactly the replay path they already need.
      PERFORM pg_notify('artifex_ledger', json_build_object(
        'seq',       NEW.seq,
        'eventId',   NEW.event_id,
        'missionId', NEW.mission_id,
        'taskId',    NEW.task_id,
        'family',    NEW.family,
        'type',      NEW.type
      )::text);
      RETURN NULL;
    END;
    $$;
  `);

  pgm.sql(`
    CREATE TRIGGER ledger_event_notify
      AFTER INSERT ON ledger_event
      FOR EACH ROW EXECUTE FUNCTION ledger_event_notify_append();
  `);

  pgm.sql(`
    CREATE TABLE model_catalog (
      -- One row per logical tier: the catalog answers "tier -> which model".
      logical_tier   smallint    PRIMARY KEY,
      provider       text        NOT NULL,
      model          text        NOT NULL,
      params         jsonb       NOT NULL DEFAULT '{}'::jsonb,
      context_window integer     NOT NULL,
      cost_weight    numeric     NOT NULL,
      capabilities   text[]      NOT NULL DEFAULT '{}',
      quantization   text,
      -- Defaults to false: a model is not usable until it has cleared the
      -- structured-output admission gate (ADR-0002).
      admitted       boolean     NOT NULL DEFAULT false,
      version        integer     NOT NULL DEFAULT 1,
      updated_at     timestamptz NOT NULL DEFAULT now()
    );
  `);
}

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export async function down(pgm) {
  pgm.sql(`DROP TABLE IF EXISTS model_catalog;`);
  pgm.sql(`DROP TRIGGER IF EXISTS ledger_event_notify ON ledger_event;`);
  pgm.sql(`DROP TRIGGER IF EXISTS ledger_event_no_truncate ON ledger_event;`);
  pgm.sql(`DROP TRIGGER IF EXISTS ledger_event_append_only ON ledger_event;`);
  pgm.sql(`DROP FUNCTION IF EXISTS ledger_event_notify_append();`);
  pgm.sql(`DROP FUNCTION IF EXISTS ledger_event_reject_mutation();`);
  pgm.sql(`DROP TABLE IF EXISTS ledger_event;`);
}
