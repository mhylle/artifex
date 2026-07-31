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

import { HotFixRepository } from './hot-fix-repository.js';
import { startTestDatabase, type TestDatabase } from './__fixtures__/test-db.js';

let db: TestDatabase;
let repo: HotFixRepository;

let seq = 0;
const nextId = () => `dddddddd-eeee-4fff-8aaa-${(seq += 1).toString(16).padStart(12, '0')}`;

beforeAll(async () => {
  db = await startTestDatabase();
  repo = new HotFixRepository(db.pool);
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

describe('R26 — the repository carries rows between the pure decisions and the store', () => {
  const plan = (over: Record<string, unknown> = {}) => ({
    missionId: nextId(),
    category: 'summarising',
    criterionId: 'c-1',
    target: { layer: 'worker', kind: 'role_instructions', assetId: 'design-1' },
    previousValue: 'Summarise it.',
    patchedValue: 'Summarise it. Check c-1.',
    windowObservations: 4,
    baselineFailureRate: 0.75,
    predictedFailureRate: 0.75,
    predictionBasis: 'strict_improvement',
    ...over,
  });

  it('applies, then reads back exactly what it stored', async () => {
    const p = plan();

    const id = await repo.apply(p);
    const live = await repo.unresolvedFor(p.missionId);

    expect(id).not.toBeNull();
    expect(live?.hotFixId).toBe(id);
    // The revert value is the one that matters — everything else is bookkeeping.
    expect(live?.previousValue).toBe('Summarise it.');
    expect(live?.windowObservations).toBe(4);
    expect(live?.baselineFailureRate).toBeCloseTo(0.75, 5);
  });

  it('returns null rather than throwing when the mission already has a live fix', async () => {
    // "One change at a time" is a normal state of affairs, not an error. A
    // throw here would make the mission loop treat an ordinary bound as a
    // failure and would need a try/catch at every call site.
    const missionId = nextId();
    await repo.apply(plan({ missionId }));

    await expect(repo.apply(plan({ missionId }))).resolves.toBeNull();
  });

  it('resolving frees the mission to hot-fix again', async () => {
    const missionId = nextId();
    const id = await repo.apply(plan({ missionId }));

    await repo.resolve({ hotFixId: id!, revert: true, reason: 'no movement', observedFailureRate: 0.75 });

    expect(await repo.unresolvedFor(missionId), 'a resolved fix still reads as live').toBeNull();
    expect(await repo.apply(plan({ missionId })), 'the mission stayed blocked after resolution').not.toBeNull();
  });

  it('records WHICH way it went, not merely that it closed', async () => {
    const missionId = nextId();
    const id = await repo.apply(plan({ missionId }));

    await repo.resolve({ hotFixId: id!, revert: false, reason: 'rate fell to 0.20', observedFailureRate: 0.2 });

    const { rows } = await db.pool.query(
      'SELECT outcome, outcome_reason, observed_failure_rate FROM hot_fix WHERE hot_fix_id = $1',
      [id],
    );
    expect(rows[0]?.outcome).toBe('kept');
    expect(rows[0]?.outcome_reason).toBe('rate fell to 0.20');
    expect(Number(rows[0]?.observed_failure_rate)).toBeCloseTo(0.2, 5);
  });

  it('records a REVERT as a revert — AC-1 asks for the revert to be recorded', async () => {
    // Found by a mutant, not by review: hard-coding `outcome = 'kept'` passed
    // all 134 tests, because the only test reading the column resolved with
    // `revert: false` and the revert test checked merely that the row closed.
    // "The revert is recorded" is half of AC-1's sentence, and a log that says
    // every experiment was kept is worse than no log — the fast loop's whole
    // claim is that it undoes itself.
    const missionId = nextId();
    const id = await repo.apply(plan({ missionId }));

    await repo.resolve({
      hotFixId: id!, revert: true, reason: 'failure rate did not improve on 0.75', observedFailureRate: 0.75,
    });

    const { rows } = await db.pool.query('SELECT outcome FROM hot_fix WHERE hot_fix_id = $1', [id]);
    expect(rows[0]?.outcome).toBe('reverted');
  });

  it('DISTRACTOR: resolving twice does not overwrite the first verdict', async () => {
    // The window closes once. A second resolution — a late revert arriving after
    // a keep, say — would rewrite history, which the ledger forbids and which
    // would make the hot-fix log disagree with the events that produced it.
    const missionId = nextId();
    const id = await repo.apply(plan({ missionId }));
    await repo.resolve({ hotFixId: id!, revert: false, reason: 'kept first', observedFailureRate: 0.2 });

    await repo.resolve({ hotFixId: id!, revert: true, reason: 'reverted second', observedFailureRate: 0.9 });

    const { rows } = await db.pool.query('SELECT outcome, outcome_reason FROM hot_fix WHERE hot_fix_id = $1', [id]);
    expect(rows[0]?.outcome, 'the second resolution overwrote the first').toBe('kept');
    expect(rows[0]?.outcome_reason).toBe('kept first');
  });

  /**
   * The science loop's candidate queue (ADR-0017).
   *
   * R26 says fast-loop results become science-loop hypotheses, and this is the
   * read that makes that sentence executable: a hot-fix is already a worker-layer
   * change to one concrete asset, so it is a candidate the bench can re-test.
   */
  it('offers RESOLVED hot-fixes as candidates, oldest first', async () => {
    const first = await repo.apply(plan({ missionId: nextId() }));
    await repo.resolve({ hotFixId: first!, revert: true, reason: 'first', observedFailureRate: 0.9 });
    const second = await repo.apply(plan({ missionId: nextId() }));
    await repo.resolve({ hotFixId: second!, revert: false, reason: 'second', observedFailureRate: 0.1 });

    const candidates = await repo.resolvedCandidates(10);
    const ids = candidates.map((c) => c.hotFixId);

    expect(ids.indexOf(first!), 'the queue is not draining oldest-first').toBeLessThan(ids.indexOf(second!));
  });

  it('carries the PATCH, which is the only thing that makes a candidate runnable', async () => {
    // The ledger event records which asset was patched and not what it was
    // patched to (defect `aa6948ee`), so this store is where the runnable change
    // actually lives. A candidate without its patched value cannot be executed
    // against a bench case at all.
    const id = await repo.apply(plan({ missionId: nextId() }));
    await repo.resolve({ hotFixId: id!, revert: true, reason: 'r', observedFailureRate: 0.9 });

    const mine = (await repo.resolvedCandidates(50)).find((c) => c.hotFixId === id);

    expect(mine?.patchedValue).toBeTruthy();
    expect(mine?.previousValue).toBeTruthy();
    expect(mine?.patchedValue).not.toBe(mine?.previousValue);
  });

  it('DISTRACTOR: an UNRESOLVED hot-fix is not a candidate', async () => {
    // It is still being measured in its own mission. Re-testing a change while
    // its first verdict is open would make both measurements meaningless.
    const live = await repo.apply(plan({ missionId: nextId() }));

    const ids = (await repo.resolvedCandidates(50)).map((c) => c.hotFixId);

    expect(ids, 'an in-flight experiment was offered for re-testing').not.toContain(live);
  });

  it('DISTRACTOR: a REVERTED hot-fix IS a candidate — that is the point', async () => {
    // Both sides of the discriminator. The fast loop reverts on a window as
    // small as two observations, which is right in-mission and far too little to
    // conclude the change is bad. Filtering reverts out here would quietly
    // answer the question the science loop exists to ask.
    const id = await repo.apply(plan({ missionId: nextId() }));
    await repo.resolve({ hotFixId: id!, revert: true, reason: 'window did not move', observedFailureRate: 0.9 });

    expect((await repo.resolvedCandidates(50)).map((c) => c.hotFixId)).toContain(id);
  });

  it('respects the limit, so one pass cannot drain an unbounded backlog', async () => {
    // Each candidate costs real model calls per case per replication. Without a
    // bound, mission latency would become a function of research backlog.
    for (let i = 0; i < 3; i += 1) {
      const id = await repo.apply(plan({ missionId: nextId() }));
      await repo.resolve({ hotFixId: id!, revert: true, reason: 'r', observedFailureRate: 0.9 });
    }

    expect(await repo.resolvedCandidates(2)).toHaveLength(2);
  });

  it('DISTRACTOR: one mission live fix does not block a DIFFERENT mission', async () => {
    // The bound is per mission. If it were global the fast loop would serialise
    // across the whole swarm and effectively never fire.
    const a = nextId();
    const b = nextId();
    await repo.apply(plan({ missionId: a }));

    expect(await repo.apply(plan({ missionId: b }))).not.toBeNull();
  });
});
