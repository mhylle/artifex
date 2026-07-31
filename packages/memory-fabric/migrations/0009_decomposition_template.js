/**
 * Decomposition templates (R31 AC-2) — the sixth store.
 *
 * "Reusable 'how to split this kind of work' recipes that are themselves
 * learnable assets." A template earns its place the same way a design does: it
 * accumulates observations and a score, it is down-weighted rather than deleted,
 * and it is only offered once it has evidence behind it.
 *
 * WHY A SEPARATE TABLE, rather than reusing `agent_design` with a
 * `decomposition.*` category — which was the first thing considered, since it
 * would have needed no migration:
 *
 *  - `role_instructions` is a WORKER PROMPT, and R26's fast loop patches exactly
 *    that column on exactly that table. A recipe stored there could be silently
 *    rewritten mid-mission by an optimiser that thinks it is tuning an agent.
 *  - `bestForCategory` would then bid templates as agents. A template has no
 *    `capabilities` and cannot execute anything; staffing one would fail at the
 *    point where it is hardest to diagnose.
 *  - The two are scored on different things. A design's score is Gate B pass
 *    rate; a template's is whether the SPLIT it guided survived Gate A. Sharing
 *    a column would average two unrelated measurements into one meaningless
 *    number.
 *
 * A template is keyed by CAPABILITY, the same taxonomy R38's clustering already
 * converges — so templates accumulate per kind of work rather than per task,
 * which is what makes them learnable at all.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function up(pgm) {
  pgm.createTable('decomposition_template', {
    template_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    /** The kind of work this recipe splits. R38's taxonomy, not free text. */
    capability: { type: 'text', notNull: true },
    /** The recipe itself — what the planner is shown. */
    recipe: { type: 'text', notNull: true },
    /** How many splits this template has guided. */
    observations: { type: 'integer', notNull: true, default: 0 },
    /**
     * Running mean of whether the guided split SURVIVED Gate A.
     *
     * Deliberately not the mission's success: a template's job is to produce a
     * well-formed decomposition, and blaming it for a worker that later failed
     * would score it on something it has no influence over.
     */
    score: { type: 'numeric', notNull: false },
    /** Down-weighted, never deleted — the same rule as the design registry. */
    active: { type: 'boolean', notNull: true, default: true },
    /** The mission whose verified split this recipe was distilled from. */
    source_mission_id: { type: 'uuid', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // One template per capability. A second would fragment the evidence the
  // template exists to accumulate — the same failure the category taxonomy has
  // when the planner invents a name per task.
  pgm.addConstraint('decomposition_template', 'decomposition_template_one_per_capability', {
    unique: ['capability'],
  });

  // A recipe nobody can read guides nothing.
  pgm.addConstraint('decomposition_template', 'decomposition_template_recipe_present', {
    check: "length(trim(recipe)) > 0",
  });

  // Scores are scores, and an unscored template is UNPROVEN rather than bad —
  // null until it has been graded at least once.
  pgm.addConstraint('decomposition_template', 'decomposition_template_score_is_a_rate', {
    check: 'score IS NULL OR (score >= 0 AND score <= 1)',
  });

  // Evidence and score stand or fall together: a score with no observations is a
  // number nobody measured, and observations with no score is a measurement
  // nobody recorded.
  pgm.addConstraint('decomposition_template', 'decomposition_template_score_needs_evidence', {
    check: '(score IS NULL) = (observations = 0)',
  });

  pgm.createIndex('decomposition_template', ['capability', 'active']);
}

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function down(pgm) {
  pgm.dropTable('decomposition_template');
}
