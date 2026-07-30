/**
 * The ratchet's audit trail (R23).
 *
 * The Asset Registry already held versioned designs and their clade scores, but
 * a version number alone cannot answer the only questions that matter about an
 * earned asset: *what* changed, and *what evidence* justified it. Without those,
 * "permanence is earned" is a claim rather than a record — and a rejected
 * candidate leaves no trace at all, so the Learning Agent would re-propose the
 * same losing change forever.
 *
 * Every proposal lands here, adopted or reverted. A reverted delta is evidence
 * too: it is how the registry can explain why an asset stopped moving.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function up(pgm) {
  pgm.createTable('agent_design_delta', {
    delta_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    design_id: {
      type: 'uuid',
      notNull: true,
      references: 'agent_design',
      onDelete: 'RESTRICT',
    },
    /** The version this delta was proposed against. */
    from_version: { type: 'integer', notNull: true },
    /** The version it produced, or NULL when it was reverted and nothing moved. */
    to_version: { type: 'integer', notNull: false },
    /**
     * The itemized change: `[{ field, to }]`. Deliberately a list of fields
     * rather than a replacement asset — an asset advances one validated delta at
     * a time, and a wholesale rewrite cannot be attributed to evidence
     * field-by-field or reasoned about afterwards.
     */
    changes: { type: 'jsonb', notNull: true },
    /**
     * Ledger event ids. "Every version keyed to the ledger evidence that
     * justified it" — so a version can always be traced back to the runs that
     * earned it. Enforced non-empty: only measured wins enter.
     */
    justified_by: { type: 'jsonb', notNull: true },
    candidate_score: { type: 'numeric', notNull: true },
    /** NULL when the incumbent had never been measured — not the same as zero. */
    incumbent_score: { type: 'numeric', notNull: false },
    candidate_simplicity: { type: 'integer', notNull: true },
    incumbent_simplicity: { type: 'integer', notNull: true },
    outcome: { type: 'text', notNull: true },
    reason: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('agent_design_delta', 'agent_design_delta_outcome', {
    check: "outcome IN ('adopted', 'reverted')",
  });

  // "Only measured wins enter" as a database guarantee rather than a convention,
  // matching how the ledger enforces append-only.
  pgm.addConstraint('agent_design_delta', 'agent_design_delta_has_evidence', {
    check: "jsonb_typeof(justified_by) = 'array' AND jsonb_array_length(justified_by) > 0",
  });

  pgm.addConstraint('agent_design_delta', 'agent_design_delta_score_range', {
    check: 'candidate_score >= 0 AND candidate_score <= 1',
  });

  // The hot read is "how has this asset moved", newest first.
  pgm.createIndex('agent_design_delta', ['design_id', 'created_at']);
}

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function down(pgm) {
  pgm.dropTable('agent_design_delta');
}
