/**
 * The fast loop's hot-fix log (R26).
 *
 * Thin on purpose. The decisions — when to fire, what to patch, what the window
 * is, whether to revert — all live in `packages/worker/src/fast-loop.ts` as pure
 * functions, and the bounds live in the table's CHECK constraints. This class
 * carries rows between the two and does no thinking of its own.
 *
 * What it does NOT do is decide whether a target is in reach. That is
 * `checkFastLoopReach`'s job worker-side and the `hot_fix_worker_layer_only`
 * constraint's job here; a third opinion in the middle would be a fourth place
 * to forget.
 */
import type { Pool } from 'pg';

export interface HotFixRecord {
  readonly hotFixId: string;
  readonly missionId: string;
  readonly category: string;
  readonly criterionId: string;
  readonly targetAssetId: string;
  readonly targetKind: string;
  readonly previousValue: string;
  readonly patchedValue: string;
  readonly windowObservations: number;
  readonly baselineFailureRate: number;
  readonly predictedFailureRate: number;
  readonly predictionBasis: string;
}

export interface ApplyHotFix {
  readonly missionId: string;
  readonly category: string;
  readonly criterionId: string;
  readonly target: { readonly layer: string; readonly kind: string; readonly assetId: string };
  readonly previousValue: string;
  readonly patchedValue: string;
  readonly windowObservations: number;
  readonly baselineFailureRate: number;
  readonly predictedFailureRate: number;
  readonly predictionBasis: string;
}

export class HotFixRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  /**
   * Log the experiment. Returns its id, or null if this mission already has one
   * unresolved.
   *
   * The null is the partial unique index talking, and it is deliberately not an
   * exception: "one change at a time" is a normal state of affairs, not an
   * error. A mission that already has a live experiment simply does not start a
   * second — attributing a window with two changes in flight is impossible, so
   * the second change would make the first one's verdict meaningless.
   */
  async apply(input: ApplyHotFix): Promise<string | null> {
    const { rows } = await this.#pool.query<{ hot_fix_id: string }>(
      `INSERT INTO hot_fix (
         mission_id, category, criterion_id,
         target_layer, target_kind, target_asset_id,
         previous_value, patched_value,
         window_observations, baseline_failure_rate, predicted_failure_rate, prediction_basis
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT DO NOTHING
       RETURNING hot_fix_id`,
      [
        input.missionId, input.category, input.criterionId,
        input.target.layer, input.target.kind, input.target.assetId,
        input.previousValue, input.patchedValue,
        input.windowObservations, input.baselineFailureRate,
        input.predictedFailureRate, input.predictionBasis,
      ],
    );

    return rows.length === 0 ? null : rows[0]!.hot_fix_id;
  }

  /** The mission's live experiment, if it has one. */
  async unresolvedFor(missionId: string): Promise<HotFixRecord | null> {
    const { rows } = await this.#pool.query(
      `SELECT hot_fix_id, mission_id, category, criterion_id, target_kind, target_asset_id,
              previous_value, patched_value, window_observations,
              baseline_failure_rate, predicted_failure_rate, prediction_basis
         FROM hot_fix
        WHERE mission_id = $1 AND resolved_at IS NULL`,
      [missionId],
    );

    const r = rows[0];
    if (r === undefined) return null;

    return {
      hotFixId: r.hot_fix_id,
      missionId: r.mission_id,
      category: r.category,
      criterionId: r.criterion_id,
      targetKind: r.target_kind,
      targetAssetId: r.target_asset_id,
      previousValue: r.previous_value,
      patchedValue: r.patched_value,
      windowObservations: Number(r.window_observations),
      baselineFailureRate: Number(r.baseline_failure_rate),
      predictedFailureRate: Number(r.predicted_failure_rate),
      predictionBasis: r.prediction_basis,
    };
  }

  /**
   * Close the experiment with a verdict.
   *
   * `outcome` and `reason` are both required by the store, so there is no way to
   * close one silently — that is the shape by which an unevaluated change
   * becomes permanent.
   */
  async resolve(input: {
    readonly hotFixId: string;
    readonly revert: boolean;
    readonly reason: string;
    readonly observedFailureRate: number | null;
  }): Promise<void> {
    await this.#pool.query(
      `UPDATE hot_fix
          SET resolved_at = now(), outcome = $2, outcome_reason = $3, observed_failure_rate = $4
        WHERE hot_fix_id = $1 AND resolved_at IS NULL`,
      [input.hotFixId, input.revert ? 'reverted' : 'kept', input.reason, input.observedFailureRate],
    );
  }
}
