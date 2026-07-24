/**
 * The capability manifest — what the Agent Creator emits when it staffs a task.
 *
 * Carries a *logical* tier, never a concrete model: the versioned Model Catalog
 * resolves tier → `{provider, model, params}` at dispatch, so models stay
 * swappable data rather than hardcoded per agent (ADR-0002).
 */
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

import { IdSchema, LogicalTierSchema, TextSchema, TimestampSchema } from './common.js';

/**
 * The repeatable checks that measure whether this design performs — the
 * evidence permanence decisions are made on. A design without a harness cannot
 * earn permanence, by rule, which is why `checks` may not be empty.
 */
export const ValidationHarnessSchema = Type.Object(
  {
    checks: Type.Array(TextSchema, { minItems: 1 }),
  },
  {
    additionalProperties: false,
    description: 'Repeatable checks that decide whether this design earns permanence.',
  },
);

export const CapabilityManifestSchema = Type.Object(
  {
    manifestId: IdSchema,
    /** The versioned design in the Asset Registry this manifest instantiates. */
    designId: IdSchema,
    version: Type.Integer({ minimum: 1 }),
    category: TextSchema,
    roleInstructions: TextSchema,
    capabilities: Type.Array(TextSchema, { minItems: 1 }),
    /** Context this agent may request via the broker — nothing its task doesn't warrant. */
    contextEntitlements: Type.Array(TextSchema),
    logicalTier: LogicalTierSchema,
    validationHarness: ValidationHarnessSchema,
    createdAt: TimestampSchema,
  },
  {
    $id: 'CapabilityManifest',
    additionalProperties: false,
    description: 'The spec for one conjured specialist, including its computed logical tier.',
  },
);
export type CapabilityManifest = Static<typeof CapabilityManifestSchema>;
