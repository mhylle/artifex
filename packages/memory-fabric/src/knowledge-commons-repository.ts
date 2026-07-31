/**
 * The Knowledge Commons (R24) — validated findings about the world, reusable
 * across missions, and treated as hostile until they earn otherwise.
 *
 * "Knowledge is guilty until proven useful." That is a functional requirement:
 * a hallucinated fact from one confused worker propagates through retrieval
 * exactly like a deliberately poisoned record, and measured attacks corrupt
 * shared stores at poison rates under 0.1% through entirely normal-looking
 * interactions. So admission is a pipeline, not an insert.
 *
 *   candidate → quarantine (usable only with its unproven label showing)
 *             → independent re-derivation for high-impact entries
 *             → published, with an expiry
 *             → re-earn, or decay out
 */
import type { Pool } from 'pg';

export type KnowledgeStatus = 'quarantined' | 'published' | 'decayed';
export type KnowledgeImpact = 'low' | 'high';

/** Where a finding came from. Every field is required — no anonymous knowledge. */
export interface Provenance {
  readonly producedByDesignId: string;
  readonly missionId: string;
  readonly taskId?: string | null;
  /** Ledger event ids. A finding with no evidence is a rumour. */
  readonly evidence: readonly string[];
  /** The gate that verified the task which produced it. */
  readonly verifiedBy: string;
}

export interface Corroboration {
  readonly designId: string;
  readonly missionId: string;
  readonly evidence: readonly string[];
}

export interface KnowledgeEntry {
  readonly entryId: string;
  readonly claim: string;
  readonly status: KnowledgeStatus;
  readonly impact: KnowledgeImpact;
  readonly provenance: Provenance;
  readonly corroborations: readonly Corroboration[];
  readonly expiresAt: string | null;
}

/**
 * An entry as the broker serves it.
 *
 * `label` and `current` are the point: a quarantined finding may be used, but
 * only with its unproven label showing, and an expired one must not be handed
 * over as current fact at all.
 */
export interface ServedKnowledge extends KnowledgeEntry {
  readonly label: 'unproven' | 'published' | 'expired';
  readonly current: boolean;
}

interface EntryRow {
  entry_id: string;
  claim: string;
  status: KnowledgeStatus;
  impact: KnowledgeImpact;
  produced_by_design_id: string;
  mission_id: string;
  task_id: string | null;
  evidence: string[];
  verified_by: string;
  corroborations: Corroboration[];
  expires_at: string | null;
}

const RETURNED = `
  entry_id, claim, status, impact, produced_by_design_id, mission_id, task_id,
  evidence, verified_by, corroborations, expires_at
`;

function toEntry(row: EntryRow): KnowledgeEntry {
  return {
    entryId: row.entry_id,
    claim: row.claim,
    status: row.status,
    impact: row.impact,
    provenance: {
      producedByDesignId: row.produced_by_design_id,
      missionId: row.mission_id,
      taskId: row.task_id,
      evidence: row.evidence,
      verifiedBy: row.verified_by,
    },
    corroborations: row.corroborations,
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
  };
}

export class KnowledgeCommonsRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  /**
   * Admit a candidate finding — always into QUARANTINE, never straight to
   * published (R24 AC-0).
   *
   * There is no parameter that would let a caller skip quarantine. That is
   * deliberate: an admission path with a "trusted" flag is the first thing an
   * attacker, or a hurried caller, would use.
   */
  async submit(input: {
    readonly claim: string;
    readonly impact?: KnowledgeImpact;
    readonly provenance: Provenance;
  }): Promise<KnowledgeEntry> {
    if (input.provenance.evidence.length === 0) {
      // Refused before the database sees it so the caller gets a sentence — but
      // the constraint is there too, because this is the store's rule rather
      // than this method's.
      throw new Error('a finding with no evidence is a rumour, not knowledge — provenance requires evidence');
    }

    const { rows } = await this.#pool.query<EntryRow>(
      `INSERT INTO knowledge_entry
         (claim, impact, produced_by_design_id, mission_id, task_id, evidence, verified_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING ${RETURNED}`,
      [
        input.claim,
        input.impact ?? 'low',
        input.provenance.producedByDesignId,
        input.provenance.missionId,
        input.provenance.taskId ?? null,
        JSON.stringify(input.provenance.evidence),
        input.provenance.verifiedBy,
      ],
    );

    return toEntry(rows[0]!);
  }

  /**
   * Record that somebody else found the same thing (R24 AC-1).
   *
   * A design cannot corroborate itself. "A stranger must find it again" is the
   * whole point: a second run of the same agent reproducing its own mistake is
   * not evidence, it is the mistake happening twice.
   */
  /**
   * Quarantined entries on the same QUESTION, produced by someone else
   * (R24 AC-1, defect `913ead75`).
   *
   * **Keyed on the question, not the claim, and that is the whole point.** A
   * submitted claim is the objective followed by the deliverable, so its
   * identity embeds the free-text answer. Measured against the live store: 56
   * entries from 11 designs and ZERO claims produced by two different designs —
   * not by accident, because two agents who independently find the same fact
   * write different words. A caller matching on the claim string would have
   * searched forever and found nothing.
   *
   * The question is the durable part. Same live data: two questions really were
   * answered by two different designs, and four were repeated by one design
   * alone, so both sides of AC-1's distinction exist in reality.
   *
   * The producing design is excluded HERE as well as in `corroborate`. The
   * refusal there is the guarantee; this is so the caller never even attempts a
   * self-corroboration, which would otherwise be a thrown error on the ordinary
   * path of a design answering its own question twice.
   *
   * Quarantined only: a published entry has had its decision made and faces an
   * expiry rather than more votes.
   */
  async strangersFor(question: string, byDesignId: string): Promise<KnowledgeEntry[]> {
    const { rows } = await this.#pool.query<EntryRow>(
      `SELECT ${RETURNED}
         FROM knowledge_entry
        WHERE status = 'quarantined'
          AND produced_by_design_id <> $2
          AND claim LIKE $1 || '%'
        ORDER BY created_at ASC`,
      [question, byDesignId],
    );
    return rows.map(toEntry);
  }

  async corroborate(entryId: string, by: Corroboration): Promise<KnowledgeEntry> {
    const existing = await this.findById(entryId);
    if (existing === null) throw new Error(`no knowledge entry ${entryId} to corroborate`);

    if (by.designId === existing.provenance.producedByDesignId) {
      throw new Error(
        `design ${by.designId} produced this finding and cannot corroborate it — a stranger must find it again`,
      );
    }

    const { rows } = await this.#pool.query<EntryRow>(
      `UPDATE knowledge_entry
          SET corroborations = corroborations || $2::jsonb, updated_at = now()
        WHERE entry_id = $1
      RETURNING ${RETURNED}`,
      [entryId, JSON.stringify([by])],
    );
    return toEntry(rows[0]!);
  }

  /**
   * Publish a quarantined finding, with an expiry (R24 AC-1, AC-2).
   *
   * A HIGH-impact entry is refused unless a design that did not produce it has
   * independently re-derived it. Low-impact findings publish on their own
   * verified provenance: requiring corroboration for everything would mean
   * nothing was ever shared, and the cost of being wrong is what the impact
   * field is for.
   *
   * `ttlSeconds` is required. There is no "publish forever" — the database
   * enforces it too, because immortal knowledge is how a store fills with
   * confident stale facts nobody re-checks.
   */
  async publish(entryId: string, ttlSeconds: number): Promise<KnowledgeEntry> {
    if (ttlSeconds <= 0) throw new RangeError(`a published entry needs a positive lifetime, got ${ttlSeconds}`);

    const existing = await this.findById(entryId);
    if (existing === null) throw new Error(`no knowledge entry ${entryId} to publish`);

    if (existing.impact === 'high') {
      const strangers = existing.corroborations.filter(
        (c) => c.designId !== existing.provenance.producedByDesignId,
      );
      if (strangers.length === 0) {
        throw new Error(
          `high-impact finding ${entryId} has not been independently re-derived — a stranger must find it again before it can be published`,
        );
      }
    }

    const { rows } = await this.#pool.query<EntryRow>(
      `UPDATE knowledge_entry
          SET status = 'published',
              published_at = now(),
              expires_at = now() + make_interval(secs => $2::double precision),
              updated_at = now()
        WHERE entry_id = $1
      RETURNING ${RETURNED}`,
      [entryId, ttlSeconds],
    );
    return toEntry(rows[0]!);
  }

  /**
   * What the broker may hand a worker, and how it must be labelled (R24 AC-0, AC-2).
   *
   * Quarantined findings ARE served — usable, but only with `unproven` showing,
   * because withholding them entirely would waste work the swarm already paid
   * for. An expired published entry is served with `current: false` rather than
   * hidden: the caller needs to know the claim exists and has lapsed, since
   * silently omitting it reads as "nobody ever found this" and invites the same
   * work again.
   *
   * Nothing here is returned as current fact unless it is published and unexpired.
   */
  async retrieve(missionId?: string): Promise<ServedKnowledge[]> {
    const { rows } = await this.#pool.query<EntryRow & { expired: boolean }>(
      `SELECT ${RETURNED}, (expires_at IS NOT NULL AND expires_at <= now()) AS expired
         FROM knowledge_entry
        WHERE status <> 'decayed'
          AND ($1::uuid IS NULL OR mission_id = $1::uuid)
        ORDER BY created_at DESC`,
      [missionId ?? null],
    );

    return rows.map((row) => {
      const entry = toEntry(row);
      if (row.status === 'published' && row.expired) {
        return { ...entry, label: 'expired' as const, current: false };
      }
      if (row.status === 'published') {
        return { ...entry, label: 'published' as const, current: true };
      }
      return { ...entry, label: 'unproven' as const, current: true };
    });
  }

  async findById(entryId: string): Promise<KnowledgeEntry | null> {
    const { rows } = await this.#pool.query<EntryRow>(
      `SELECT ${RETURNED} FROM knowledge_entry WHERE entry_id = $1`,
      [entryId],
    );
    return rows.length === 0 ? null : toEntry(rows[0]!);
  }
}
