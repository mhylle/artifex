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

  /** Register a new design, or bump the version of an existing one. */
  async upsert(input: AgentDesignInput): Promise<AgentDesign> {
    const { rows } = await this.#pool.query<DesignRow>(
      `INSERT INTO agent_design (design_id, category, role_instructions, capabilities)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (design_id) DO UPDATE
         SET role_instructions = EXCLUDED.role_instructions,
             capabilities      = EXCLUDED.capabilities,
             version           = agent_design.version + 1,
             updated_at        = now()
       RETURNING ${RETURNED}`,
      [input.designId, input.category, input.roleInstructions, JSON.stringify(input.capabilities)],
    );

    return toDesign(rows[0]!);
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
}
