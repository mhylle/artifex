/**
 * The evidence bundle — a worker's deliverable made verifiable by a stranger.
 *
 * A worker delivers not just an output but the record of what it did, what it
 * consulted, and what it assumed. Consulted context names its Context Broker
 * grant: agents exchange context only through the broker, and every exchange is
 * logged (no peer chatter).
 */
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

import { IdSchema, TextSchema, TimestampSchema } from './common.js';

export const ConsultedSourceSchema = Type.Object(
  {
    source: TextSchema,
    /** Null only for context the contract already granted inline (its own inputs). */
    viaBrokerGrantId: Type.Union([TextSchema, Type.Null()]),
  },
  {
    additionalProperties: false,
    description: 'A context source and the broker grant that authorised it.',
  },
);

export const EvidenceBundleSchema = Type.Object(
  {
    bundleId: IdSchema,
    taskId: IdSchema,
    agentId: IdSchema,
    /** The work product itself; its shape is the task's business, not the schema's. */
    deliverable: Type.Unknown(),
    actions: Type.Array(TextSchema, { minItems: 1 }),
    consulted: Type.Array(ConsultedSourceSchema),
    assumptions: Type.Array(TextSchema),
    effortSpent: Type.Number({ minimum: 0 }),
    producedAt: TimestampSchema,
  },
  {
    $id: 'EvidenceBundle',
    additionalProperties: false,
    description: 'A deliverable plus the pedigree that makes it independently verifiable.',
  },
);
export type EvidenceBundle = Static<typeof EvidenceBundleSchema>;
