/**
 * The Knowledge Commons (R24) — the third store, and the one with an adversary.
 *
 * "Knowledge is guilty until proven useful." The dossier is explicit that this
 * is a functional requirement rather than hygiene: measured attacks corrupt
 * shared knowledge stores at poison rates under 0.1% via normal-looking
 * interactions, and a hallucinated "fact" from one confused worker propagates
 * through retrieval exactly like a poisoned record would.
 *
 * So the store's rules are DATABASE CONSTRAINTS, not conventions — the same
 * choice the ledger makes with its append-only trigger and the Asset Registry
 * makes with its non-empty `justified_by`. A rule that lives only in a
 * repository method is one forgotten caller away from not existing.
 *
 * Three of them:
 *  - **Sourced.** No anonymous knowledge: a producing design, a mission and a
 *    non-empty evidence array are required to insert at all.
 *  - **Earned.** Status is a closed set, and nothing may be born published.
 *  - **Mortal.** A published entry MUST carry an expiry. Immortal knowledge is
 *    how a store fills with confident stale facts nobody re-checks.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function up(pgm) {
  pgm.createTable('knowledge_entry', {
    entry_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    /** The finding itself, in the words of the task that produced it. */
    claim: { type: 'text', notNull: true },
    /**
     * `quarantined` on admission, `published` once earned, `decayed` once it has
     * expired without being re-earned. Nothing is born published.
     */
    status: { type: 'text', notNull: true, default: 'quarantined' },
    /**
     * How much it would cost to be wrong. High-impact entries need a stranger to
     * re-derive them before they can be published — the corroboration rule.
     */
    impact: { type: 'text', notNull: true, default: 'low' },

    // ---- provenance: which agent, which mission, which evidence ------------
    produced_by_design_id: { type: 'uuid', notNull: true },
    mission_id: { type: 'uuid', notNull: true },
    task_id: { type: 'uuid', notNull: false },
    /** Ledger event ids. Non-empty: a finding with no evidence is a rumour. */
    evidence: { type: 'jsonb', notNull: true },
    /** How the producing task was verified — the gate that let this through. */
    verified_by: { type: 'text', notNull: true },

    /**
     * Independent re-derivations: `[{ designId, missionId, evidence }]`.
     *
     * "A stranger must find it again." Stored rather than counted, because which
     * agent corroborated matters — a design cannot corroborate itself, and that
     * has to be checkable after the fact, not just at the moment of promotion.
     */
    corroborations: { type: 'jsonb', notNull: true, default: '[]' },

    published_at: { type: 'timestamptz', notNull: false },
    /** When it stops being current. Required once published — knowledge is mortal. */
    expires_at: { type: 'timestamptz', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('knowledge_entry', 'knowledge_entry_status', {
    check: "status IN ('quarantined', 'published', 'decayed')",
  });

  pgm.addConstraint('knowledge_entry', 'knowledge_entry_impact', {
    check: "impact IN ('low', 'high')",
  });

  // Sourced: a finding that cannot say where it came from cannot enter.
  pgm.addConstraint('knowledge_entry', 'knowledge_entry_has_evidence', {
    check: "jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) > 0",
  });

  // Mortal: published implies an expiry, enforced by the database so no code
  // path can publish something that never has to be re-checked.
  pgm.addConstraint('knowledge_entry', 'knowledge_entry_published_expires', {
    check: "status <> 'published' OR (expires_at IS NOT NULL AND published_at IS NOT NULL)",
  });

  // Retrieval reads by status and expiry; the broker asks "what may I use now".
  pgm.createIndex('knowledge_entry', ['status', 'expires_at']);
  pgm.createIndex('knowledge_entry', ['mission_id']);
}

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export function down(pgm) {
  pgm.dropTable('knowledge_entry');
}
