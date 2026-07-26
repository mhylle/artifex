/**
 * The Model Router — provider-neutral dispatch (ADR-0001/0002).
 *
 * Tier is *data*, not code: an agent carries a logical tier, and the versioned
 * Model Catalog decides which concrete model that means. Nothing here hardcodes
 * a model, and nothing here invents parameters — a router that substitutes its
 * own defaults has stopped being neutral.
 */
import type { LogicalTier, ModelCatalogEntry } from '@artifex/shared-types';

import { NoModelForTierError } from './errors.js';

/**
 * The slice of the Model Catalog the router needs.
 *
 * Deliberately structural rather than an import of `@artifex/memory-fabric`:
 * the router stays free of database concerns, and the worker supplies the
 * adapter. `null` means "no admitted model for this tier"; a rejection means the
 * catalog itself failed, and that must NOT be mistaken for absence — otherwise a
 * database outage would quietly resolve as "fall back to Claude", which is the
 * silent default this whole design refuses.
 */
export interface CatalogResolver {
  resolve(logicalTier: LogicalTier): Promise<ModelCatalogEntry | null>;
}

export interface TierFallback {
  readonly from: LogicalTier;
  readonly to: LogicalTier;
  readonly reason: string;
}

export interface ResolvedModel {
  readonly logicalTier: LogicalTier;
  readonly provider: string;
  readonly model: string;
  readonly params: Record<string, unknown>;
  /** Non-null when the request was served by a tier other than the one asked for. */
  readonly fallback: TierFallback | null;
}

const LOCAL_MID_TIER = 2 satisfies LogicalTier;
const FRONTIER_TIER = 3 satisfies LogicalTier;

function resolved(entry: ModelCatalogEntry, fallback: TierFallback | null): ResolvedModel {
  return {
    logicalTier: entry.logicalTier,
    provider: entry.provider,
    model: entry.model,
    params: entry.params,
    fallback,
  };
}

export class ModelRouter {
  readonly #catalog: CatalogResolver;

  constructor(options: { catalog: CatalogResolver }) {
    this.#catalog = options.catalog;
  }

  /**
   * Resolve a logical tier to a concrete model.
   *
   * Tier-2 is the one tier with a documented fallback (ADR-0003): the local
   * mid-size model is *attempted*, and if none has cleared the admission gate the
   * request is served by the frontier tier instead. That substitution is
   * reported on {@link ResolvedModel.fallback} rather than performed quietly —
   * an unreported fallback is indistinguishable from a silent default, and the
   * cost difference between a local 32B and a frontier model is exactly the kind
   * of thing the budget ledger must be able to see.
   */
  async resolveTier(logicalTier: LogicalTier): Promise<ResolvedModel> {
    const direct = await this.#catalog.resolve(logicalTier);
    if (direct !== null) {
      return resolved(direct, null);
    }

    if (logicalTier !== LOCAL_MID_TIER) {
      throw new NoModelForTierError(logicalTier);
    }

    const frontier = await this.#catalog.resolve(FRONTIER_TIER);
    if (frontier === null) {
      throw new NoModelForTierError(logicalTier, 'no local Tier-2 model and no frontier fallback');
    }

    return resolved(frontier, {
      from: LOCAL_MID_TIER,
      to: FRONTIER_TIER,
      reason:
        'No admitted local Tier-2 model in the catalog; served by the frontier tier (ADR-0003).',
    });
  }
}
