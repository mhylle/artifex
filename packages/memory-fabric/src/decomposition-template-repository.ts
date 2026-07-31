/**
 * Decomposition templates (R31 AC-2) — "how to split this kind of work".
 *
 * The same earned-permanence shape as the design registry, for the same reason:
 * a recipe offered before it has evidence is a guess promoted into a default.
 * Kept in its own store rather than in `agent_design` because R26's fast loop
 * patches `role_instructions` — see migration 0009 for the full argument.
 */
import type { Pool } from 'pg';

export interface DecompositionTemplate {
  readonly templateId: string;
  readonly capability: string;
  readonly recipe: string;
  readonly observations: number;
  readonly score: number | null;
}

interface TemplateRow {
  template_id: string;
  capability: string;
  recipe: string;
  observations: number;
  score: string | null;
}

const toTemplate = (row: TemplateRow): DecompositionTemplate => ({
  templateId: row.template_id,
  capability: row.capability,
  recipe: row.recipe,
  observations: Number(row.observations),
  score: row.score === null ? null : Number(row.score),
});

export class DecompositionTemplateRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  /**
   * Record a recipe distilled from a split that survived Gate A.
   *
   * Idempotent per capability: a second distillation for the same kind of work
   * does NOT overwrite the recipe, because the incumbent carries the evidence
   * and the newcomer carries none. Replacing it would reset the record every
   * time the swarm split that kind of work again, and no template would ever
   * accumulate anything.
   */
  async remember(input: {
    readonly capability: string;
    readonly recipe: string;
    readonly sourceMissionId: string;
  }): Promise<DecompositionTemplate> {
    const { rows } = await this.#pool.query<TemplateRow>(
      `INSERT INTO decomposition_template (capability, recipe, source_mission_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (capability) DO NOTHING
       RETURNING template_id, capability, recipe, observations, score`,
      [input.capability, input.recipe, input.sourceMissionId],
    );

    if (rows.length > 0) return toTemplate(rows[0]!);

    const existing = await this.forCapability(input.capability, 0);
    if (existing === null) {
      throw new Error(`decomposition template for ${input.capability} vanished between insert and read-back`);
    }
    return existing;
  }

  /**
   * The template to guide a split of this capability, or null.
   *
   * `minObservations` defaults to 0 — deliberately different from the design
   * registry's bar of 3, and the difference is the point. A design that has not
   * proven itself may be staffed and produce bad WORK; a template that has not
   * proven itself only adds a sentence to a prompt the planner is free to
   * ignore, and Gate A still audits whatever comes out. Withholding it until it
   * had three observations would mean it could never GET three, because nothing
   * else offers templates — the evidence bar would be its own blocker.
   */
  async forCapability(capability: string, minObservations = 0): Promise<DecompositionTemplate | null> {
    const { rows } = await this.#pool.query<TemplateRow>(
      `SELECT template_id, capability, recipe, observations, score
         FROM decomposition_template
        WHERE capability = $1 AND active = true AND observations >= $2`,
      [capability, minObservations],
    );

    return rows.length === 0 ? null : toTemplate(rows[0]!);
  }

  /**
   * Fold one more outcome into a template's record (a running mean).
   *
   * The outcome is whether the split it guided SURVIVED GATE A — not whether the
   * mission succeeded. A template produces a decomposition; blaming it for a
   * worker that later failed would score it on something it cannot influence.
   */
  async recordOutcome(templateId: string, survived: boolean): Promise<void> {
    await this.#pool.query(
      `UPDATE decomposition_template
          SET score = ((COALESCE(score, 0) * observations) + $2) / (observations + 1),
              observations = observations + 1,
              updated_at = now()
        WHERE template_id = $1`,
      [templateId, survived ? 1 : 0],
    );
  }

  /** Down-weight rather than delete — the registry's rule, applied here too. */
  async deactivate(templateId: string): Promise<void> {
    await this.#pool.query(
      `UPDATE decomposition_template SET active = false, updated_at = now() WHERE template_id = $1`,
      [templateId],
    );
  }
}
