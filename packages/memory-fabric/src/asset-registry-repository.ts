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
  readonly parentDesignId: string | null;
  /** Mean effort per verified run — the COST axis of the Pareto front. */
  readonly meanEffort: number | null;
  readonly validationHarness: { readonly checks: string[] } | null;
}

export interface AgentDesignInput {
  readonly designId: string;
  readonly category: string;
  readonly roleInstructions: string;
  readonly capabilities: string[];
  /** The design this one descends from, if any (R28). */
  readonly parentDesignId?: string | null;
  /**
   * The checks this design's work is graded against.
   *
   * `null` marks a design whose performance CANNOT be measured, which the
   * ratchet refuses to promote however well it appeared to do.
   */
  readonly validationHarness?: { readonly checks: string[] } | null;
}

const RETURNED = `
  design_id, category, version, role_instructions, capabilities,
  clade_score, observations, active, parent_design_id, mean_effort, validation_harness
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
  parent_design_id: string | null;
  mean_effort: string | null;
  validation_harness: { checks: string[] } | null;
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
    parentDesignId: row.parent_design_id,
    meanEffort: row.mean_effort === null ? null : Number(row.mean_effort),
    validationHarness: row.validation_harness,
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
      `INSERT INTO agent_design
         (design_id, category, role_instructions, capabilities, parent_design_id, validation_harness)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)
       ON CONFLICT (design_id) DO NOTHING
       RETURNING ${RETURNED}`,
      [
        input.designId, input.category, input.roleInstructions, JSON.stringify(input.capabilities),
        input.parentDesignId ?? null,
        input.validationHarness === undefined || input.validationHarness === null
          ? null
          : JSON.stringify(input.validationHarness),
      ],
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
  async recordOutcome(designId: string, score: number, effort?: number): Promise<AgentDesign> {
    if (score < 0 || score > 1) {
      throw new RangeError(`clade score must be within 0..1, received ${score}`);
    }

    const { rows } = await this.#pool.query<DesignRow>(
      `UPDATE agent_design
          SET clade_score  = ((COALESCE(clade_score, 0) * observations) + $2) / (observations + 1),
              -- Cost folds the same way, and stays NULL while no effort has been
              -- reported: unmeasured cost is not zero cost (R28 AC-1).
              mean_effort  = CASE
                               WHEN $3::numeric IS NULL THEN mean_effort
                               ELSE ((COALESCE(mean_effort, 0) * observations) + $3::numeric) / (observations + 1)
                             END,
              observations = observations + 1,
              updated_at   = now()
        WHERE design_id = $1
      RETURNING ${RETURNED}`,
      [designId, score, effort ?? null],
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

  /**
   * The clade score — how this design's WHOLE LINEAGE has performed (R28 AC-0).
   *
   * Walks ancestors with a recursive CTE and takes an **observation-weighted**
   * mean. Weighting is the whole point: a plain average of each design's mean
   * would let one lucky run count as much as thirty, which is the "lucky
   * audition" the criterion exists to rule out.
   *
   * `UNION` rather than `UNION ALL`, and a visited-set guard via `NOT IN`, so a
   * cycle in the ancestry terminates. Lineage is model-adjacent data; a cycle
   * must degrade to a finite answer rather than spin inside a live mission.
   *
   * Distinct from the design's own `cladeScore`, which is left alone: promotion
   * reads the clade, but a later delta is measured against the design's own
   * record, and collapsing the two would make an individual record unreadable.
   */
  async cladeScoreFor(designId: string): Promise<{ score: number | null; observations: number }> {
    const { rows } = await this.#pool.query<{ score: string | null; observations: string }>(
      `WITH RECURSIVE lineage(design_id, parent_design_id, clade_score, observations, seen) AS (
         SELECT d.design_id, d.parent_design_id, d.clade_score, d.observations,
                ARRAY[d.design_id]
           FROM agent_design d
          WHERE d.design_id = $1
         UNION ALL
         SELECT p.design_id, p.parent_design_id, p.clade_score, p.observations,
                l.seen || p.design_id
           FROM agent_design p
           JOIN lineage l ON p.design_id = l.parent_design_id
          WHERE NOT p.design_id = ANY(l.seen)
       )
       SELECT SUM(clade_score * observations) / NULLIF(SUM(observations), 0) AS score,
              COALESCE(SUM(observations), 0)                                 AS observations
         FROM lineage`,
      [designId],
    );

    const row = rows[0];
    return {
      score: row === undefined || row.score === null ? null : Number(row.score),
      observations: row === undefined ? 0 : Number(row.observations),
    };
  }

  /**
   * The Pareto front for a category (R28 AC-1).
   *
   * "Pareto sets per category rather than single champions, so a cheaper-but-
   * adequate design is not evicted by a costlier better one." A design is kept
   * unless another is at least as good on BOTH axes and strictly better on one:
   * higher clade score, lower mean effort.
   *
   * Cost comes from `effortSpent`, which the ledger already records on every
   * `task.executed` — derived from what the system measured rather than from an
   * invented price list.
   *
   * Unproven designs are excluded. An unmeasured design is not efficient, it is
   * unknown, and putting it on the front would let a design with no record
   * displace one that earned its place.
   */
  async paretoFor(category: string): Promise<AgentDesign[]> {
    const { rows } = await this.#pool.query<DesignRow>(
      `SELECT ${RETURNED} FROM agent_design
        WHERE category = $1
          AND clade_score IS NOT NULL
          AND mean_effort IS NOT NULL
        ORDER BY clade_score DESC, mean_effort ASC`,
      [category],
    );

    const candidates = rows.map(toDesign);
    return candidates.filter((design) => !candidates.some((rival) => dominates(rival, design)));
  }

  /** Re-point a design's ancestry. Used by the Learning Agent when a lineage is corrected. */
  async reparent(designId: string, parentDesignId: string | null): Promise<void> {
    await this.#pool.query(
      `UPDATE agent_design SET parent_design_id = $2, updated_at = now() WHERE design_id = $1`,
      [designId, parentDesignId],
    );
  }

  /**
   * The capabilities the registry knows, best-established first (R38 AC-0).
   *
   * Ordered by total observations so that a proposed category which could join
   * two capabilities joins the better-evidenced one — the tie-break is the
   * system's own measured history rather than alphabetical luck.
   */
  async knownCapabilities(): Promise<string[]> {
    const { rows } = await this.#pool.query<{ category: string }>(
      `SELECT category
         FROM agent_design
        GROUP BY category
        ORDER BY SUM(observations) DESC, MIN(created_at) ASC`,
    );
    return rows.map((row) => row.category);
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

      // "A design without a validation harness cannot earn permanence, by rule"
      // (R28 AC-2). Refused on MEASURABILITY, not performance: a perfect score
      // from a design nobody can grade is exactly the case the rule exists for,
      // because the number cannot be trusted whatever it says.
      if (incumbent.validationHarness === null) {
        throw new Error(
          `design ${input.designId} has no validation harness — a design whose performance cannot be measured cannot earn permanence`,
        );
      }

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
 * Does `rival` dominate `design` in the Pareto sense?
 *
 * At least as good on both axes — higher-or-equal quality, lower-or-equal cost —
 * and strictly better on at least one. Requiring strict betterness somewhere is
 * what stops two identical designs from eliminating each other and emptying the
 * front.
 */
function dominates(rival: AgentDesign, design: AgentDesign): boolean {
  if (rival.designId === design.designId) return false;
  const quality = (d: AgentDesign) => d.cladeScore ?? 0;
  const cost = (d: AgentDesign) => d.meanEffort ?? Number.POSITIVE_INFINITY;

  const noWorse = quality(rival) >= quality(design) && cost(rival) <= cost(design);
  const better = quality(rival) > quality(design) || cost(rival) < cost(design);
  return noWorse && better;
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
