/**
 * The replay bench (R25) — the fourth store, and the one that must resist its
 * own owner.
 *
 * A benchmark exists to score candidate improvements against known ground truth
 * at fixed cost. That only works while the benchmark is *honest*, and the thing
 * most motivated to make it dishonest is the component being scored: "nothing
 * that optimizes against a benchmark may also own it."
 *
 * So the bench is split in two, and the split is enforced by the database rather
 * than by a repository method:
 *
 *  - **open** — visible to everyone, including the Learning Agent. Optimising
 *    against it is expected and fine; that is what it is for.
 *  - **sealed** — used to evaluate amendment petitions and to calibrate the
 *    Reviewer. Structurally unreachable by the Learning Agent.
 *
 * The enforcement is a VIEW (`benchmark_case_open`) that exposes only the open
 * slice, with the learning-side reader bound to the view and never to the table.
 * A repository method checking a caller-supplied role would be a convention an
 * optimiser can simply not pass — reading sealed cases has to be a *missing
 * grant*, not a forgotten check.
 *
 * Two constraints beyond that, in the same spirit as the commons:
 *  - **Grounded.** A case must carry a contract, its inputs and a VERIFIED
 *    outcome. A case with no recorded verdict is a guess about ground truth, and
 *    scoring against a guess is worse than not scoring.
 *  - **Curated.** `retired_at` exists so the bench ages out rather than
 *    accumulating — curated like the commons, not accumulated like the ledger.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function up(pgm) {
  pgm.createTable('benchmark_case', {
    case_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    /** Which slice. Closed set: there is no third bench to hide a case in. */
    slice: { type: 'text', notNull: true },
    /** The task this case was distilled from, for traceability back to the trail. */
    source_task_id: { type: 'uuid', notNull: true },
    source_mission_id: { type: 'uuid', notNull: true },
    /** What the capability was, so drift can be measured against the mission mix. */
    capability: { type: 'text', notNull: true },
    /** The whole contract — a case that cannot be re-contracted cannot be replayed. */
    contract: { type: 'jsonb', notNull: true },
    /** What the task was given. */
    inputs: { type: 'jsonb', notNull: true, default: pgm.func(`'{}'::jsonb`) },
    /** The ground truth: what a verified run actually produced. */
    verified_outcome: { type: 'jsonb', notNull: true },
    /** Ledger event ids proving the outcome was verified, not assumed. */
    evidence: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    /** Non-null once the case no longer represents the work. Never deleted. */
    retired_at: { type: 'timestamptz', notNull: false },
    retired_reason: { type: 'text', notNull: false },
  });

  // A closed set, so nothing can be filed under a slice nobody audits.
  pgm.addConstraint('benchmark_case', 'benchmark_case_slice_known', {
    check: "slice IN ('open', 'sealed')",
  });

  // Grounded: evidence is what separates recorded ground truth from a guess.
  pgm.addConstraint('benchmark_case', 'benchmark_case_evidence_present', {
    check: "jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) > 0",
  });

  // A retirement must say why. "It aged out" with no reason is indistinguishable
  // from someone quietly removing a case they kept failing.
  pgm.addConstraint('benchmark_case', 'benchmark_case_retirement_explained', {
    check: '(retired_at IS NULL) = (retired_reason IS NULL)',
  });

  // One case per source task per slice: replaying the same task twice would
  // weight it twice in every score.
  pgm.createIndex('benchmark_case', ['slice', 'source_task_id'], {
    unique: true,
    name: 'benchmark_case_one_per_task_per_slice',
  });

  pgm.createIndex('benchmark_case', ['slice', 'retired_at']);

  /**
   * The open slice, and ONLY the open slice.
   *
   * This is the structural half of R25 AC-1. A reader bound to this view cannot
   * see a sealed case however it phrases its query — there is no predicate to
   * forget and no flag to omit.
   */
  pgm.createView('benchmark_case_open', {}, `
    SELECT case_id, slice, source_task_id, source_mission_id, capability,
           contract, inputs, verified_outcome, evidence,
           created_at, retired_at, retired_reason
      FROM benchmark_case
     WHERE slice = 'open'
  `);
}

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function down(pgm) {
  pgm.dropView('benchmark_case_open');
  pgm.dropTable('benchmark_case');
}
