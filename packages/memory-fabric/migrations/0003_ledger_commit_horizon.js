/**
 * Close the `seq` gap for live consumers (defect `8a6ee598`).
 *
 * `GENERATED ALWAYS AS IDENTITY` hands out `seq` when the row is INSERTED, not
 * when its transaction COMMITS. With parallel writers that means seq 2 can
 * become visible while seq 1 is still in flight — so a consumer polling
 * `readSince(lastSeq)` advances past 1 and never sees it. Replay-from-zero was
 * always fine; only the live tail could skip.
 *
 * The fix records the inserting transaction id alongside the row. A consumer can
 * then ask Postgres which transactions are definitely finished — everything
 * below the current snapshot's xmin horizon — and read only up to there.
 *
 * This deliberately avoids the obvious alternative of "lag by N seconds", which
 * would be an invented number that is simultaneously too slow on a quiet system
 * and too fast on a busy one. The horizon is exact: it is Postgres's own answer
 * to "what is still in flight?".
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function up(pgm) {
  pgm.addColumn('ledger_event', {
    inserted_xid: {
      type: 'xid8',
      notNull: true,
      default: pgm.func('pg_current_xact_id()'),
      comment:
        'The inserting transaction id. Lets a consumer read only rows whose transaction is known committed (below the snapshot xmin horizon), so a late-committing lower seq is never skipped.',
    },
  });

  // The live-tail query filters on both, in this order.
  pgm.createIndex('ledger_event', ['inserted_xid', 'seq']);
}

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function down(pgm) {
  pgm.dropIndex('ledger_event', ['inserted_xid', 'seq']);
  pgm.dropColumn('ledger_event', 'inserted_xid');
}
