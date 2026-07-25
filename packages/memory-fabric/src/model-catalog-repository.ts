/**
 * The Model Catalog — "tier is data, not code" (ADR-0002).
 *
 * The Agent Creator computes a *logical* tier; this store decides which concrete
 * model that means. Swapping Qwen2.5 for a successor is a row change.
 */
import {
  assertValid,
  ModelCatalogEntryInputSchema,
  type LogicalTier,
  type ModelCatalogEntry,
  type ModelCatalogEntryInput,
} from '@artifex/shared-types';
import type { Pool } from 'pg';

/**
 * Raised when a logical tier has no admitted entry.
 *
 * This is deliberately an error and not a fallback: silently substituting some
 * other model would hide a misconfigured catalog behind plausible output, and
 * the caller (the Model Router) is the only layer entitled to decide what a
 * missing tier should degrade to.
 */
export class TierNotInCatalogError extends Error {
  readonly logicalTier: number;

  constructor(logicalTier: number) {
    super(`no admitted model catalog entry for logical tier ${logicalTier}`);
    this.name = 'TierNotInCatalogError';
    this.logicalTier = logicalTier;
  }
}

const RETURNED_COLUMNS = `
  logical_tier, provider, model, params, context_window, cost_weight,
  capabilities, quantization, admitted, version, updated_at
`;

interface ModelCatalogRow {
  logical_tier: number;
  provider: string;
  model: string;
  params: Record<string, unknown>;
  context_window: number;
  /** `numeric` arrives from pg as a string. */
  cost_weight: string;
  capabilities: string[];
  quantization: string | null;
  admitted: boolean;
  version: number;
  updated_at: Date;
}

function toEntry(row: ModelCatalogRow): ModelCatalogEntry {
  return {
    logicalTier: row.logical_tier,
    provider: row.provider,
    model: row.model,
    params: row.params,
    contextWindow: row.context_window,
    costWeight: Number(row.cost_weight),
    capabilities: row.capabilities,
    quantization: row.quantization,
    admitted: row.admitted,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  };
}

export class ModelCatalogRepository {
  constructor(private readonly pool: Pool) {}

  /** Insert or replace the entry for a tier, bumping its version. */
  async upsert(input: ModelCatalogEntryInput): Promise<ModelCatalogEntry> {
    const entry = assertValid(ModelCatalogEntryInputSchema, input);

    const result = await this.pool.query<ModelCatalogRow>(
      `INSERT INTO model_catalog
         (logical_tier, provider, model, params, context_window, cost_weight,
          capabilities, quantization, admitted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (logical_tier) DO UPDATE SET
         provider       = EXCLUDED.provider,
         model          = EXCLUDED.model,
         params         = EXCLUDED.params,
         context_window = EXCLUDED.context_window,
         cost_weight    = EXCLUDED.cost_weight,
         capabilities   = EXCLUDED.capabilities,
         quantization   = EXCLUDED.quantization,
         admitted       = EXCLUDED.admitted,
         version        = model_catalog.version + 1,
         updated_at     = now()
       RETURNING ${RETURNED_COLUMNS}`,
      [
        entry.logicalTier,
        entry.provider,
        entry.model,
        JSON.stringify(entry.params),
        entry.contextWindow,
        entry.costWeight,
        entry.capabilities,
        entry.quantization,
        entry.admitted,
      ],
    );

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('model catalog upsert returned no row');
    }
    return toEntry(row);
  }

  /**
   * Resolve a logical tier to its concrete model.
   *
   * Only admitted entries resolve — a model that hasn't cleared the
   * structured-output admission gate is not usable, which is what lets a
   * not-yet-proven local Tier-2 candidate sit in the catalog harmlessly.
   */
  async resolve(logicalTier: LogicalTier): Promise<ModelCatalogEntry> {
    const result = await this.pool.query<ModelCatalogRow>(
      `SELECT ${RETURNED_COLUMNS} FROM model_catalog
       WHERE logical_tier = $1 AND admitted = true`,
      [logicalTier],
    );

    const row = result.rows[0];
    if (row === undefined) {
      throw new TierNotInCatalogError(logicalTier);
    }
    return toEntry(row);
  }

  /** Every admitted entry, lowest tier first. */
  async listActive(): Promise<ModelCatalogEntry[]> {
    const result = await this.pool.query<ModelCatalogRow>(
      `SELECT ${RETURNED_COLUMNS} FROM model_catalog
       WHERE admitted = true ORDER BY logical_tier ASC`,
    );
    return result.rows.map(toEntry);
  }
}
