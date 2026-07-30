/**
 * Earned permanence (R28) — lineage, cost, and measurability.
 *
 * `agent_design.clade_score` has carried the comment *"how this LINEAGE has
 * performed, not one audition"* since P6, while the table had no ancestry at
 * all. It was a per-design running mean: not one lucky audition, but not a clade
 * either. These three columns are what the comment always described.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function up(pgm) {
  pgm.addColumns('agent_design', {
    /**
     * The design this one descends from. Nullable — a root design has no
     * ancestor, which is different from having a lost one.
     *
     * `ON DELETE RESTRICT` mirrors the registry's rule that nothing is ever
     * hard-deleted: a parent cannot be removed out from under its lineage,
     * because that would silently rewrite a clade score's basis.
     */
    parent_design_id: {
      type: 'uuid',
      notNull: false,
      references: 'agent_design',
      onDelete: 'RESTRICT',
    },
    /**
     * Mean effort per verified run — the COST axis of the Pareto front.
     *
     * Derived from `effortSpent`, which the ledger already records on every
     * `task.executed`, rather than from an invented price list. Null until the
     * design has run: unmeasured cost is not zero cost.
     */
    mean_effort: { type: 'numeric', notNull: false },
    /**
     * The checks this design's work is graded against.
     *
     * "A design without a validation harness cannot earn permanence, by rule."
     * Nullable precisely so that rule has something to test: a design whose
     * performance cannot be measured must be distinguishable from one that
     * simply has not run yet.
     */
    validation_harness: { type: 'jsonb', notNull: false },
  });

  // The Pareto front is read per category, and only proven designs are on it.
  pgm.createIndex('agent_design', ['category', 'clade_score', 'mean_effort']);
  // Walking a lineage is a recursive join on this column.
  pgm.createIndex('agent_design', ['parent_design_id']);
}

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function down(pgm) {
  pgm.dropIndex('agent_design', ['parent_design_id']);
  pgm.dropIndex('agent_design', ['category', 'clade_score', 'mean_effort']);
  pgm.dropColumns('agent_design', ['parent_design_id', 'mean_effort', 'validation_harness']);
}
