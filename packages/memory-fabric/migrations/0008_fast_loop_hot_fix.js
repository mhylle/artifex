/**
 * The fast loop's hot-fix log (R26) — the fifth store, and the one whose job is
 * to make a change hard to keep.
 *
 * The fast loop patches worker-layer assets *while a mission runs*. There is no
 * human in the way and no between-missions pause in which to notice a mistake,
 * so every bound the dossier states — "worker layer only, one change at a time,
 * logged as an experiment, auto-reverted if the failure rate doesn't move" — has
 * to hold without anyone remembering to check it.
 *
 * AC-2 asks for reach bounded "by construction, not by convention", and this
 * table is the third of three independent bars. The first is the type
 * (`HotFixTarget.layer` is the literal `'worker'`); the second is the
 * constitutional guard `checkFastLoopReach`. Both live in the worker process. A
 * CHECK constraint here is the one that still holds when code bypasses the guard
 * — a replay, a repair script, a future call site nobody has written yet.
 *
 * The constraints, and why each is a constraint rather than a repository rule:
 *
 *  - **Worker layer only.** The whole criterion. A convention that lives in one
 *    function is one refactor away from being optional.
 *  - **Exactly one patch.** "One change at a time" is what makes the auto-revert
 *    mean anything: three simultaneous changes cannot be attributed, so reverting
 *    on a flat failure rate would discard two innocent changes and one guilty
 *    one with equal confidence.
 *  - **A prediction is required, and it must be beatable.** An experiment whose
 *    predicted rate is not below its baseline cannot be falsified, and an
 *    unfalsifiable experiment is a change with paperwork.
 *  - **A resolution must say what happened.** `resolved_at` and `outcome` stand
 *    or fall together, so a hot-fix cannot be quietly closed with no verdict —
 *    the same shape as the bench's `retirement_explained`.
 *  - **The original is kept.** `previous_value` is NOT NULL, which is what makes
 *    revert an operation rather than an intention. A patch that did not record
 *    what it replaced cannot be undone, and AC-1 requires it be undone
 *    automatically, with no human to reconstruct it.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function up(pgm) {
  pgm.createTable('hot_fix', {
    hot_fix_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    /** The mission that was running when this fired. The fast loop is in-mission by definition. */
    mission_id: { type: 'uuid', notNull: true },
    /** The pattern it was aimed at — a category failing Gate B repeatedly on ONE criterion. */
    category: { type: 'text', notNull: true },
    criterion_id: { type: 'text', notNull: true },

    /** Which layer the patch touches. Constrained below to the worker layer alone. */
    target_layer: { type: 'text', notNull: true },
    /** Which kind of worker-layer asset. Also a closed set. */
    target_kind: { type: 'text', notNull: true },
    target_asset_id: { type: 'text', notNull: true },

    /** What the asset held before the patch — the revert, stored rather than derived. */
    previous_value: { type: 'text', notNull: true },
    /** What the patch put there. */
    patched_value: { type: 'text', notNull: true },
    /** How many patches this hot-fix applied. Constrained to exactly one. */
    patch_count: { type: 'integer', notNull: true, default: 1 },

    /** The bounds it declared: how many observations of this pair before judging. */
    window_observations: { type: 'integer', notNull: true },
    /** The measured rate it is trying to beat. */
    baseline_failure_rate: { type: 'numeric', notNull: true },
    /** The rate it predicts, and how that prediction was arrived at. */
    predicted_failure_rate: { type: 'numeric', notNull: true },
    prediction_basis: { type: 'text', notNull: true },

    applied_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    /** Non-null once the window closed and a verdict was reached. */
    resolved_at: { type: 'timestamptz', notNull: false },
    /** 'kept' or 'reverted'. Never null while resolved, never set while unresolved. */
    outcome: { type: 'text', notNull: false },
    outcome_reason: { type: 'text', notNull: false },
    /** What the rate actually turned out to be. Null when the window closed with no data. */
    observed_failure_rate: { type: 'numeric', notNull: false },
  });

  // AC-2, by construction. The fast loop's reach stops at the worker layer, and
  // the database is where that stops being a promise.
  pgm.addConstraint('hot_fix', 'hot_fix_worker_layer_only', {
    check: "target_layer = 'worker'",
  });

  // ...and within it, a closed set of assets. A worker's budget and its contract
  // are not its prompt, and neither is the fast loop's to rewrite.
  pgm.addConstraint('hot_fix', 'hot_fix_target_kind_known', {
    check: "target_kind IN ('role_instructions', 'knowledge')",
  });

  // "One change at a time" — the bound that makes attribution possible.
  pgm.addConstraint('hot_fix', 'hot_fix_exactly_one_patch', {
    check: 'patch_count = 1',
  });

  // A window of zero would close instantly and judge on nothing.
  pgm.addConstraint('hot_fix', 'hot_fix_window_positive', {
    check: 'window_observations > 0',
  });

  // Rates are rates.
  pgm.addConstraint('hot_fix', 'hot_fix_rates_are_rates', {
    check:
      'baseline_failure_rate >= 0 AND baseline_failure_rate <= 1 ' +
      'AND predicted_failure_rate >= 0 AND predicted_failure_rate <= 1 ' +
      'AND (observed_failure_rate IS NULL OR (observed_failure_rate >= 0 AND observed_failure_rate <= 1))',
  });

  // A prediction must be beatable or it is not a prediction. `strict_improvement`
  // is the honest degenerate case — no peer evidence existed, so the claim is
  // only "better than baseline" and predicted is carried equal to it.
  pgm.addConstraint('hot_fix', 'hot_fix_prediction_falsifiable', {
    check:
      "(prediction_basis = 'peer_criteria' AND predicted_failure_rate < baseline_failure_rate) " +
      "OR (prediction_basis = 'strict_improvement' AND predicted_failure_rate = baseline_failure_rate)",
  });

  // A resolution says what happened, or there is no resolution. Closing a
  // hot-fix with no verdict is how an unevaluated change becomes permanent.
  pgm.addConstraint('hot_fix', 'hot_fix_resolution_explained', {
    check:
      "(resolved_at IS NULL AND outcome IS NULL AND outcome_reason IS NULL) " +
      "OR (resolved_at IS NOT NULL AND outcome IN ('kept', 'reverted') AND outcome_reason IS NOT NULL)",
  });

  // One live hot-fix per mission — "one change at a time" across the mission,
  // not merely within a single row. Two concurrent unresolved fixes would make
  // either one's window unattributable, which is the same failure the
  // per-row patch_count bound prevents one level down.
  pgm.createIndex('hot_fix', ['mission_id'], {
    unique: true,
    where: 'resolved_at IS NULL',
    name: 'hot_fix_one_unresolved_per_mission',
  });

  pgm.createIndex('hot_fix', ['category', 'criterion_id']);
}

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function down(pgm) {
  pgm.dropTable('hot_fix');
}
