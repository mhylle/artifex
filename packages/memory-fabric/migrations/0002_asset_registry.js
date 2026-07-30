/**
 * The Asset Registry — versioned agent designs and their clade scores.
 *
 * This is the substrate for "permanence is earned" (invariant #5). Designs are
 * ephemeral by default; only measured, replicated wins get promoted, and losers
 * are DOWN-WEIGHTED rather than deleted — a design that lost on one task class
 * may be the right answer for another, and hard-deleting it destroys the evidence
 * the Learning Agent reasons over. Hence `active`, not `DELETE`.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function up(pgm) {
  pgm.createTable('agent_design', {
    design_id: { type: 'uuid', primaryKey: true },
    category: { type: 'text', notNull: true },
    version: { type: 'integer', notNull: true, default: 1 },
    role_instructions: { type: 'text', notNull: true },
    capabilities: { type: 'jsonb', notNull: true },
    /**
     * Clade metaproductivity: how this LINEAGE has performed, not one audition.
     * Null until it has earned evidence — an unproven design must be
     * distinguishable from one measured at zero.
     */
    clade_score: { type: 'numeric', notNull: false },
    /** How many verified tasks the score rests on. One win is not a track record. */
    observations: { type: 'integer', notNull: true, default: 0 },
    active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Staffing is reuse-first, so the hot path is "best active design for this
  // category" — ordered by the evidence, not by recency.
  pgm.createIndex('agent_design', ['category', 'active']);

  pgm.addConstraint('agent_design', 'agent_design_clade_score_range', {
    check: 'clade_score IS NULL OR (clade_score >= 0 AND clade_score <= 1)',
  });
}

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function down(pgm) {
  pgm.dropTable('agent_design');
}
