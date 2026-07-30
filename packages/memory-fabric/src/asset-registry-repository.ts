/**
 * The Asset Registry — versioned agent designs and the earned-permanence ratchet.
 *
 * Staffing is **reuse-first**: the Agent Creator asks this store for the best
 * proven design in a category before designing anything new. That ordering is
 * what makes the swarm cheaper over time instead of re-inventing the same
 * specialist every mission.
 *
 * "Best" means *most evidence*, not most recent. A design with a 0.95 score over
 * two observations has not out-performed one at 0.85 over forty — one audition is
 * not a track record (invariant #5), so `bestForCategory` requires a minimum
 * observation count before a score counts as earned.
 */
import type { Pool } from 'pg';

export interface AgentDesign {
  readonly designId: string;
  readonly category: string;
  readonly version: number;
  readonly roleInstructions: string;
  readonly capabilities: string[];
  /** Null until the design has earned evidence — distinct from "measured at zero". */
  readonly cladeScore: number | null;
  readonly observations: number;
  readonly active: boolean;
}

export interface AgentDesignInput {
  readonly designId: string;
  readonly category: string;
  readonly roleInstructions: string;
  readonly capabilities: string[];
}

const RETURNED = `
  design_id, category, version, role_instructions, capabilities,
  clade_score, observations, active
`;

interface DesignRow {
  design_id: string;
  category: string;
  version: number;
  role_instructions: string;
  capabilities: string[];
  /** `numeric` arrives from pg as a string. */
  clade_score: string | null;
  observations: number;
  active: boolean;
}

function toDesign(row: DesignRow): AgentDesign {
  return {
    designId: row.design_id,
    category: row.category,
    version: row.version,
    roleInstructions: row.role_instructions,
    capabilities: row.capabilities,
    cladeScore: row.clade_score === null ? null : Number(row.clade_score),
    observations: row.observations,
    active: row.active,
  };
}

export class AssetRegistryRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  /**
   * Register a design, and return whatever the registry now holds for that id.
   *
   * **Idempotent, and it never overwrites an incumbent** (defect `fe690036`).
   * Staffing registers every design it authors, so an unchanged design is
   * re-registered on every no-bid. This previously bumped `version` each time:
   * five identical missions moved one design v1 → v2 → v3 with no delta, no
   * evidence and no measurement — exactly what the ratchet exists to prevent,
   * and it made `version` useless as the key a clade score is attributed to.
   *
   * A conflict now changes nothing at all, not even the content. A no-bid that
   * authored *different* instructions for a category that already has an asset
   * must not silently replace it: that is a wholesale rewrite without evidence,
   * which R23 AC-0 forbids. The only route to changing an existing asset is
   * `proposeDelta`, which carries a measurement and records why.
   */
  async upsert(input: AgentDesignInput): Promise<AgentDesign> {
    const { rows } = await this.#pool.query<DesignRow>(
      `INSERT INTO agent_design (design_id, category, role_instructions, capabilities)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (design_id) DO NOTHING
       RETURNING ${RETURNED}`,
      [input.designId, input.category, input.roleInstructions, JSON.stringify(input.capabilities)],
    );

    if (rows.length > 0) return toDesign(rows[0]!);

    // The row already existed, so `DO NOTHING` returned nothing. Read it back:
    // the caller needs the version the registry actually holds, not the one it
    // proposed — `staff()` reporting a hard-coded 1 is how the ledger and the
    // registry came to disagree about which version did the work.
    const existing = await this.findById(input.designId);
    if (existing === null) {
      throw new Error(`agent design ${input.designId} vanished between insert and read-back`);
    }
    return existing;
  }

  /**
   * The best *earned* design for a category, or null — a no-bid.
   *
   * `minObservations` is the evidence bar. Below it a design is not "bad", it is
   * *unproven*, and treating unproven as proven is how a lucky first run gets
   * promoted into a permanent default.
   */
  async bestForCategory(category: string, minObservations = 3): Promise<AgentDesign | null> {
    const { rows } = await this.#pool.query<DesignRow>(
      `SELECT ${RETURNED} FROM agent_design
        WHERE category = $1 AND active = true
          AND clade_score IS NOT NULL AND observations >= $2
        ORDER BY clade_score DESC, observations DESC
        LIMIT 1`,
      [category, minObservations],
    );

    return rows.length === 0 ? null : toDesign(rows[0]!);
  }

  /**
   * Fold one more observation into a design's clade score (a running mean).
   *
   * Incremental rather than recomputed so the ratchet never needs the full task
   * history in memory, and so a score always states how much evidence it rests on.
   */
  async recordOutcome(designId: string, score: number): Promise<AgentDesign> {
    if (score < 0 || score > 1) {
      throw new RangeError(`clade score must be within 0..1, received ${score}`);
    }

    const { rows } = await this.#pool.query<DesignRow>(
      `UPDATE agent_design
          SET clade_score  = ((COALESCE(clade_score, 0) * observations) + $2) / (observations + 1),
              observations = observations + 1,
              updated_at   = now()
        WHERE design_id = $1
      RETURNING ${RETURNED}`,
      [designId, score],
    );

    if (rows.length === 0) {
      throw new Error(`no agent design ${designId} to record an outcome against`);
    }
    return toDesign(rows[0]!);
  }

  /**
   * Down-weight a losing design. Never a delete: a design that lost on one task
   * class may be right for another, and hard-deleting destroys the evidence the
   * Learning Agent reasons over (invariant #5).
   */
  async deactivate(designId: string): Promise<void> {
    await this.#pool.query(`UPDATE agent_design SET active = false, updated_at = now() WHERE design_id = $1`, [
      designId,
    ]);
  }

  async findById(designId: string): Promise<AgentDesign | null> {
    const { rows } = await this.#pool.query<DesignRow>(
      `SELECT ${RETURNED} FROM agent_design WHERE design_id = $1`,
      [designId],
    );
    return rows.length === 0 ? null : toDesign(rows[0]!);
  }

  /**
   * Every design in a category, retired ones included (R23 AC-2).
   *
   * "Retirement is down-weighting, never deletion; cold assets remain searchable
   * as stepping stones." The down-weighting is expressed as ORDER — an active
   * design outranks every retired one, whatever their scores — rather than as a
   * multiplier. A multiplier would be a number the evidence cannot justify, and
   * this project does not invent constants.
   *
   * Distinct from `bestForCategory`, which answers "who should do this work" and
   * so must exclude the retired. This answers "what has this category ever
   * learned", which is the Learning Agent's question.
   */
  async search(category: string): Promise<RankedDesign[]> {
    const { rows } = await this.#pool.query<DesignRow>(
      `SELECT ${RETURNED} FROM agent_design
        WHERE category = $1
        ORDER BY active DESC, clade_score DESC NULLS LAST, observations DESC`,
      [category],
    );

    return rows.map((row) => ({ ...toDesign(row), retired: !row.active }));
  }

  /** Every ratchet decision against a design, adopted or reverted, newest last. */
  async deltasFor(designId: string): Promise<AssetDelta[]> {
    const { rows } = await this.#pool.query<DeltaRow>(
      `SELECT delta_id, design_id, from_version, to_version, changes, justified_by,
              candidate_score, incumbent_score, outcome, reason
         FROM agent_design_delta
        WHERE design_id = $1
        ORDER BY created_at, delta_id`,
      [designId],
    );

    return rows.map((row) => ({
      deltaId: row.delta_id,
      designId: row.design_id,
      fromVersion: row.from_version,
      toVersion: row.to_version,
      changes: row.changes,
      justifiedBy: row.justified_by,
      candidateScore: Number(row.candidate_score),
      incumbentScore: row.incumbent_score === null ? null : Number(row.incumbent_score),
      outcome: row.outcome,
      reason: row.reason,
    }));
  }

  /**
   * The ratchet (R23 AC-0, AC-1).
   *
   * Assets advance one validated delta at a time. A candidate measured
   * equal-or-worse than the incumbent reverts automatically; where two measure
   * equal, the simpler wins. Every proposal is recorded either way — a rejection
   * is evidence too, and a ratchet that forgets its rejections invites the same
   * losing change to be proposed forever.
   *
   * The whole thing runs in ONE transaction: a delta recorded without its
   * version bump, or a bump without its delta, would leave the registry unable
   * to explain its own state.
   */
  async proposeDelta(input: DeltaProposal): Promise<DeltaResult> {
    if (input.justifiedBy.length === 0) {
      // Refused before the database sees it, so the caller gets a sentence rather
      // than a constraint violation — but the constraint is there too, because
      // "only measured wins enter" is the registry's rule, not this method's.
      throw new Error(
        `delta for ${input.designId} carries no evidence — only measured wins enter the registry`,
      );
    }
    if (input.candidateScore < 0 || input.candidateScore > 1) {
      throw new RangeError(`candidate score must be within 0..1, received ${input.candidateScore}`);
    }

    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');

      // Locked for the duration: two concurrent proposals against one asset
      // could otherwise both read the same incumbent and both adopt, which is
      // two deltas at a time — exactly what a ratchet forbids.
      const { rows } = await client.query<DesignRow>(
        `SELECT ${RETURNED} FROM agent_design WHERE design_id = $1 FOR UPDATE`,
        [input.designId],
      );
      if (rows.length === 0) {
        throw new Error(`no agent design ${input.designId} to propose a delta against`);
      }

      const incumbent = toDesign(rows[0]!);
      const candidate = applyChanges(incumbent, input.changes);
      const incumbentSimplicity = simplicityOf(incumbent);
      const candidateSimplicity = simplicityOf(candidate);

      const { adopt, reason } = judge(
        incumbent.cladeScore,
        input.candidateScore,
        incumbentSimplicity,
        candidateSimplicity,
      );

      const toVersion = adopt ? incumbent.version + 1 : null;

      if (adopt) {
        // Itemized: only the named fields move. The rest of the asset is not
        // rewritten, so a later reader can attribute each field to the delta
        // that earned it.
        await client.query(
          `UPDATE agent_design
              SET role_instructions = $2, capabilities = $3::jsonb,
                  version = version + 1, updated_at = now()
            WHERE design_id = $1`,
          [input.designId, candidate.roleInstructions, JSON.stringify(candidate.capabilities)],
        );
      }

      await client.query(
        `INSERT INTO agent_design_delta
           (design_id, from_version, to_version, changes, justified_by,
            candidate_score, incumbent_score, candidate_simplicity, incumbent_simplicity,
            outcome, reason)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11)`,
        [
          input.designId, incumbent.version, toVersion,
          JSON.stringify(input.changes), JSON.stringify(input.justifiedBy),
          input.candidateScore, incumbent.cladeScore,
          candidateSimplicity, incumbentSimplicity,
          adopt ? 'adopted' : 'reverted', reason,
        ],
      );

      await client.query('COMMIT');
      return { outcome: adopt ? 'adopted' : 'reverted', reason, toVersion };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

/** A design plus whether it has been retired — what `search` returns. */
export interface RankedDesign extends AgentDesign {
  readonly retired: boolean;
}

/** One field of an asset, moved. */
export interface DeltaChange {
  readonly field: 'roleInstructions' | 'capabilities';
  readonly to: string | string[];
}

export interface DeltaProposal {
  readonly designId: string;
  readonly changes: readonly DeltaChange[];
  /** Ledger event ids. Non-empty: only measured wins enter. */
  readonly justifiedBy: readonly string[];
  readonly candidateScore: number;
}

export interface DeltaResult {
  readonly outcome: 'adopted' | 'reverted';
  readonly reason: string;
  readonly toVersion: number | null;
}

export interface AssetDelta {
  readonly deltaId: string;
  readonly designId: string;
  readonly fromVersion: number;
  readonly toVersion: number | null;
  readonly changes: readonly DeltaChange[];
  readonly justifiedBy: readonly string[];
  readonly candidateScore: number;
  readonly incumbentScore: number | null;
  readonly outcome: 'adopted' | 'reverted';
  readonly reason: string;
}

interface DeltaRow {
  delta_id: string;
  design_id: string;
  from_version: number;
  to_version: number | null;
  changes: DeltaChange[];
  justified_by: string[];
  candidate_score: string;
  incumbent_score: string | null;
  outcome: 'adopted' | 'reverted';
  reason: string;
}

/**
 * How complicated an asset is, derived from the asset itself rather than
 * declared by whoever proposes a change — otherwise "simpler" would be a claim
 * the proposer could simply assert.
 */
function simplicityOf(design: Pick<AgentDesign, 'roleInstructions' | 'capabilities'>): number {
  return design.roleInstructions.length + design.capabilities.length;
}

/** The candidate asset, with only the named fields moved. */
function applyChanges(
  incumbent: AgentDesign,
  changes: readonly DeltaChange[],
): Pick<AgentDesign, 'roleInstructions' | 'capabilities'> {
  let roleInstructions = incumbent.roleInstructions;
  let capabilities = incumbent.capabilities;

  for (const change of changes) {
    if (change.field === 'roleInstructions' && typeof change.to === 'string') {
      roleInstructions = change.to;
    } else if (change.field === 'capabilities' && Array.isArray(change.to)) {
      capabilities = change.to;
    }
  }
  return { roleInstructions, capabilities };
}

/** The ratchet's rule, in one place so it can be read as a sentence. */
function judge(
  incumbentScore: number | null,
  candidateScore: number,
  incumbentSimplicity: number,
  candidateSimplicity: number,
): { adopt: boolean; reason: string } {
  if (incumbentScore === null) {
    // Nothing to beat is not a tie. Treating an unmeasured incumbent as zero
    // would invent evidence; treating it as unbeatable would freeze every new
    // design at its first draft.
    return {
      adopt: true,
      reason: `Incumbent is unproven (no incumbent evidence); candidate measured ${candidateScore}.`,
    };
  }
  if (candidateScore > incumbentScore) {
    return { adopt: true, reason: `Candidate ${candidateScore} beats incumbent ${incumbentScore}.` };
  }
  if (candidateScore === incumbentScore && candidateSimplicity < incumbentSimplicity) {
    return {
      adopt: true,
      reason: `Equal at ${candidateScore}; candidate is simpler (${candidateSimplicity} vs ${incumbentSimplicity}).`,
    };
  }
  return {
    adopt: false,
    reason: candidateScore === incumbentScore
      ? `Equal at ${candidateScore} and no simpler (${candidateSimplicity} vs ${incumbentSimplicity}) — incumbent stands.`
      : `Candidate ${candidateScore} is worse than incumbent ${incumbentScore} — incumbent stands.`,
  };
}
