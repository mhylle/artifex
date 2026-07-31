/**
 * R26 — the fast loop's hot-fix log, against a real PostgreSQL.
 *
 * AC-2 asks that the fast loop's reach be bounded "by construction, not by
 * convention", and this file tests the only bar that survives code bypassing the
 * others: the database's own CHECK constraints. Every test here PLANTS a row and
 * watches Postgres refuse it, because that is the only way to test a claim about
 * the database — a repository method that throws proves the method throws.
 *
 * The worker-side bars (the type and the constitutional guard) are covered in
 * `packages/worker/src/fast-loop-reach.test.ts`. Three bars, three failure modes,
 * no single point where forgetting a check lets a patch through.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestDatabase, type TestDatabase } from './__fixtures__/test-db.js';

let db: TestDatabase;

let seq = 0;
const nextId = () => `dddddddd-eeee-4fff-8aaa-${(seq += 1).toString(16).padStart(12, '0')}`;

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db?.stop();
});

/** A row that satisfies every constraint, so each test can break exactly one. */
function row(over: Record<string, unknown> = {}) {
  return {
    mission_id: nextId(),
    category: 'summarising',
    criterion_id: 'c-1',
    target_layer: 'worker',
    target_kind: 'role_instructions',
    target_asset_id: 'design-1',
    previous_value: 'Summarise it.',
    patched_value: 'Summarise it. Check c-1.',
    patch_count: 1,
    window_observations: 4,
    baseline_failure_rate: 0.75,
    predicted_failure_rate: 0.75,
    prediction_basis: 'strict_improvement',
    ...over,
  };
}

async function insert(over: Record<string, unknown> = {}) {
  const r = row(over);
  const cols = Object.keys(r);
  const params = cols.map((_, i) => `$${i + 1}`).join(', ');
  return db.pool.query(
    `INSERT INTO hot_fix (${cols.join(', ')}) VALUES (${params}) RETURNING hot_fix_id`,
    Object.values(r),
  );
}

describe('R26 AC-2 — the store refuses reach above the worker layer', () => {
  it('accepts a worker-layer role-instruction patch', async () => {
    // The rule must be able to say yes. A constraint that refuses everything
    // would pass every refusal test below and make the store useless.
    const { rows } = await insert();

    expect(rows[0]?.hot_fix_id).toBeDefined();
  });

  it('accepts a worker-layer knowledge patch', async () => {
    const { rows } = await insert({ target_kind: 'knowledge', target_asset_id: 'k-1' });

    expect(rows[0]?.hot_fix_id).toBeDefined();
  });

  it('REFUSES a meta-layer patch — a playbook', async () => {
    await expect(
      insert({ target_layer: 'meta', target_kind: 'playbook' }),
    ).rejects.toThrow(/hot_fix_worker_layer_only|hot_fix_target_kind_known/);
  });

  it('REFUSES the constitutional core', async () => {
    await expect(
      insert({ target_layer: 'core', target_kind: 'constitution' }),
    ).rejects.toThrow(/hot_fix_worker_layer_only|hot_fix_target_kind_known/);
  });

  it('REFUSES an unknown layer even with a PERMITTED kind', async () => {
    // The mirror of the worker-side distractor, and the one that separates an
    // allow-list from a blocklist. The Orchestrator has role instructions too,
    // and they are above the worker layer.
    await expect(
      insert({ target_layer: 'orchestration', target_kind: 'role_instructions' }),
    ).rejects.toThrow(/hot_fix_worker_layer_only/);
  });

  it('REFUSES an unknown KIND inside the worker layer', async () => {
    // "Worker layer" is not a blank cheque over everything a worker touches.
    await expect(
      insert({ target_kind: 'budget_ceiling' }),
    ).rejects.toThrow(/hot_fix_target_kind_known/);
  });
});

describe('R26 AC-0 — one change at a time, with bounds and a falsifiable prediction', () => {
  it('REFUSES more than one patch in a hot-fix', async () => {
    // "One change at a time" is what makes the auto-revert attributable. Three
    // simultaneous changes reverted on a flat rate discards two innocent
    // changes and one guilty one with equal confidence.
    await expect(insert({ patch_count: 2 })).rejects.toThrow(/hot_fix_exactly_one_patch/);
  });

  it('REFUSES a second unresolved hot-fix on the same mission', async () => {
    // The same bound one level up. Two live experiments on one mission make
    // either one's window unattributable.
    const missionId = nextId();
    await insert({ mission_id: missionId });

    await expect(insert({ mission_id: missionId })).rejects.toThrow(
      /hot_fix_one_unresolved_per_mission/,
    );
  });

  it('DISTRACTOR: a RESOLVED hot-fix does not block the next one on that mission', async () => {
    // The partial index has to be partial. If it were a plain unique index a
    // mission could hot-fix exactly once ever, and the fast loop would stop
    // being a loop.
    const missionId = nextId();
    await insert({ mission_id: missionId });
    await db.pool.query(
      `UPDATE hot_fix SET resolved_at = now(), outcome = 'reverted', outcome_reason = 'no movement'
        WHERE mission_id = $1`,
      [missionId],
    );

    const { rows } = await insert({ mission_id: missionId });
    expect(rows[0]?.hot_fix_id).toBeDefined();
  });

  it('REFUSES a window of zero observations', async () => {
    // A window that closes instantly judges on nothing.
    await expect(insert({ window_observations: 0 })).rejects.toThrow(/hot_fix_window_positive/);
  });

  it('REFUSES a peer-based prediction that is not below its baseline', async () => {
    // An experiment whose predicted rate does not beat its baseline cannot be
    // falsified, and an unfalsifiable experiment is a change with paperwork.
    await expect(
      insert({ prediction_basis: 'peer_criteria', predicted_failure_rate: 0.75 }),
    ).rejects.toThrow(/hot_fix_prediction_falsifiable/);
  });

  it('accepts a peer-based prediction that IS below its baseline', async () => {
    const { rows } = await insert({
      prediction_basis: 'peer_criteria', predicted_failure_rate: 0.1,
    });

    expect(rows[0]?.hot_fix_id).toBeDefined();
  });

  it('DISTRACTOR: the strict_improvement basis REQUIRES predicted == baseline', async () => {
    // The degenerate basis is the honest one — no peer evidence existed, so the
    // claim is only "better than baseline". Letting it carry an arbitrary lower
    // number would smuggle in the invented threshold the design avoids, and
    // downstream nothing could tell it from a measured prediction.
    await expect(
      insert({ prediction_basis: 'strict_improvement', predicted_failure_rate: 0.3 }),
    ).rejects.toThrow(/hot_fix_prediction_falsifiable/);
  });

  it('REFUSES a prediction basis nobody audits', async () => {
    await expect(
      insert({ prediction_basis: 'vibes', predicted_failure_rate: 0.1 }),
    ).rejects.toThrow(/hot_fix_prediction_falsifiable/);
  });
});

describe('R26 AC-1 — a resolution must say what happened', () => {
  it('REFUSES closing a hot-fix with no verdict', async () => {
    // The shape that lets an unevaluated change become permanent: resolved, but
    // with nothing recorded about why.
    const { rows } = await insert();

    await expect(
      db.pool.query('UPDATE hot_fix SET resolved_at = now() WHERE hot_fix_id = $1', [
        rows[0]!.hot_fix_id,
      ]),
    ).rejects.toThrow(/hot_fix_resolution_explained/);
  });

  it('REFUSES a verdict with no reason', async () => {
    const { rows } = await insert();

    await expect(
      db.pool.query(
        `UPDATE hot_fix SET resolved_at = now(), outcome = 'reverted' WHERE hot_fix_id = $1`,
        [rows[0]!.hot_fix_id],
      ),
    ).rejects.toThrow(/hot_fix_resolution_explained/);
  });

  it('REFUSES an outcome outside {kept, reverted}', async () => {
    const { rows } = await insert();

    await expect(
      db.pool.query(
        `UPDATE hot_fix SET resolved_at = now(), outcome = 'partially kept', outcome_reason = 'x'
          WHERE hot_fix_id = $1`,
        [rows[0]!.hot_fix_id],
      ),
    ).rejects.toThrow(/hot_fix_resolution_explained/);
  });

  it('REFUSES a patch that did not record what it replaced', async () => {
    // Found by a mutant, not by review: making `previous_value` nullable passed
    // all 127 tests, because every fixture supplied one. The column is the
    // entire reason a revert can happen with no human action — a hot-fix that
    // did not store the original leaves reconstructing it to a person, which is
    // exactly what AC-1 forbids. So the store has to refuse the row, not merely
    // never receive it.
    await expect(insert({ previous_value: null })).rejects.toThrow(
      /previous_value|not-null|violates not-null/i,
    );
  });

  it('accepts a complete resolution, and the revert value was there all along', async () => {
    // `previous_value` is NOT NULL precisely so that reverting is an operation
    // rather than an intention. AC-1 requires the revert happen with no human
    // action, and a human is exactly what reconstructing a lost original needs.
    const { rows } = await insert();

    await db.pool.query(
      `UPDATE hot_fix
          SET resolved_at = now(), outcome = 'reverted',
              outcome_reason = 'failure rate did not improve on 0.75', observed_failure_rate = 0.75
        WHERE hot_fix_id = $1`,
      [rows[0]!.hot_fix_id],
    );

    const { rows: after } = await db.pool.query(
      'SELECT outcome, previous_value FROM hot_fix WHERE hot_fix_id = $1',
      [rows[0]!.hot_fix_id],
    );

    expect(after[0]?.outcome).toBe('reverted');
    expect(after[0]?.previous_value, 'nothing to revert TO').toBe('Summarise it.');
  });
});
