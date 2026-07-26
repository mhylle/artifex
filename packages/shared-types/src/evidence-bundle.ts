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

import {
  ActionOutcomeSchema,
  IdSchema,
  SlugIdSchema,
  TextSchema,
  TimestampSchema,
  ToolRiskClassSchema,
} from './common.js';
import { ReflectionRecordSchema } from './reflection.js';

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

/**
 * One brokered tool invocation (R13).
 *
 * Prose was not verifiable: a reviewer could only believe a sentence claiming
 * the agent searched. A structured record lets the Reviewer check the claim and
 * lets the Learning Agent mine which tools actually pay off.
 *
 * `viaBrokerGrantId` is **not** nullable — and that asymmetry with
 * `ConsultedSource` is the point. Context can be granted inline by the contract,
 * but there is no such thing as an unbrokered action: an unmediated tool call
 * would be an unlogged side effect, and the ledger must be the complete record
 * of what happened (invariant #1).
 */
export const ActionRecordSchema = Type.Object(
  {
    actionId: IdSchema,
    toolId: SlugIdSchema,
    riskClass: ToolRiskClassSchema,
    arguments: Type.Record(Type.String(), Type.Unknown()),
    /** A digest, not the payload — bundles stay reviewable and bounded. */
    resultDigest: TextSchema,
    viaBrokerGrantId: TextSchema,
    outcome: ActionOutcomeSchema,
    invokedAt: TimestampSchema,
  },
  {
    additionalProperties: false,
    description: 'One brokered tool invocation, with the grant that authorised it.',
  },
);
export type ActionRecord = Static<typeof ActionRecordSchema>;

export const EvidenceBundleSchema = Type.Object(
  {
    bundleId: IdSchema,
    taskId: IdSchema,
    agentId: IdSchema,
    /** The work product itself; its shape is the task's business, not the schema's. */
    deliverable: Type.Unknown(),
    /**
     * Brokered invocations, not prose. No `minItems`: a task that only reasons
     * legitimately takes no actions, and an empty list is an honest record of
     * that — unlike the old free-text field, which forced a narrative.
     */
    actions: Type.Array(ActionRecordSchema),
    consulted: Type.Array(ConsultedSourceSchema),
    assumptions: Type.Array(TextSchema),
    /**
     * Present-and-nullable rather than optional (the `parentTaskId` convention):
     * "this work was not self-critiqued" is a fact the Reviewer and the Learning
     * Agent must be able to read, not a field that might be missing.
     */
    reflection: Type.Union([ReflectionRecordSchema, Type.Null()]),
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
