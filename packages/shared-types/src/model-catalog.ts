/**
 * The Model Catalog entry — the versioned mapping from a *logical tier* to a
 * concrete model (ADR-0002).
 *
 * Tier is data, not code: the Agent Creator computes a logical tier per staffing
 * decision, and the catalog decides which model that resolves to. Swapping
 * Qwen2.5 for its successor is a row change, not a code change.
 *
 * A model is only resolvable once `admitted` — it must first clear the
 * structured-output admission gate on the *real* schemas in this package. That
 * flag is what lets logical Tier-2 fall back to Claude without blocking v0.
 */
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

import { LogicalTierSchema, TextSchema, TimestampSchema } from './common.js';

/** What a caller supplies when seeding or swapping a catalog entry. */
const modelCatalogEntryInputProperties = {
  logicalTier: LogicalTierSchema,
  provider: TextSchema,
  model: TextSchema,
  /** Provider-specific generation params, e.g. temperature. */
  params: Type.Record(Type.String(), Type.Unknown()),
  contextWindow: Type.Integer({ minimum: 1 }),
  /** Relative cost, used by the tier policy's budget arithmetic. */
  costWeight: Type.Number({ minimum: 0 }),
  capabilities: Type.Array(TextSchema),
  quantization: Type.Union([TextSchema, Type.Null()]),
  /** Has this entry passed the structured-output admission gate? */
  admitted: Type.Boolean(),
} as const;

export const ModelCatalogEntryInputSchema = Type.Object(modelCatalogEntryInputProperties, {
  $id: 'ModelCatalogEntryInput',
  additionalProperties: false,
  description: 'A catalog entry as submitted; the store assigns version and updatedAt.',
});
export type ModelCatalogEntryInput = Static<typeof ModelCatalogEntryInputSchema>;

export const ModelCatalogEntrySchema = Type.Object(
  {
    ...modelCatalogEntryInputProperties,
    version: Type.Integer({ minimum: 1 }),
    updatedAt: TimestampSchema,
  },
  {
    $id: 'ModelCatalogEntry',
    additionalProperties: false,
    description: 'A stored catalog entry resolving one logical tier to a concrete model.',
  },
);
export type ModelCatalogEntry = Static<typeof ModelCatalogEntrySchema>;
