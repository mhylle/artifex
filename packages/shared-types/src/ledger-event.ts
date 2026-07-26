/**
 * The audit ledger event — the system's one substrate.
 *
 * Invariant: *nothing that matters happens off-ledger*. Every agent act, every
 * verdict, and every human action in the cockpit is appended here as a typed,
 * attributable event; the dashboard renders these and holds no truth of its own.
 */
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

import { ActorSchema, IdSchema, StringEnum, TextSchema, TimestampSchema } from './common.js';

/**
 * The event families of the audit taxonomy. Events are structured for querying,
 * not archaeology: family + error class + criterion id make "which categories
 * fail which clauses" a lookup rather than an investigation.
 */
export const LEDGER_EVENT_FAMILIES = [
  'decision',
  'contract',
  'staffing',
  'execution',
  /**
   * Brokered tool invocations and denials (R13). Its own family rather than an
   * `action.*` prefix under `execution`, so "reproduce every action this mission
   * took" is a family lookup instead of a string scan — querying, not archaeology.
   *
   * Reflection deliberately stays under `execution`: an action is a side effect
   * on the world with its own governance, a self-critique is an internal step.
   * Keeping it out of `verification` leaves that family exclusively the
   * Reviewer's, which puts "self-review is never self-verification" in the
   * taxonomy itself.
   */
  'action',
  'verification',
  'economic',
  'escalation',
  'learning',
] as const;
export const LedgerEventFamilySchema = StringEnum(LEDGER_EVENT_FAMILIES, {
  description: 'Audit event family — the top level of the event taxonomy.',
});
export type LedgerEventFamily = Static<typeof LedgerEventFamilySchema>;

/**
 * Fields supplied by whoever appends the event. `seq` and `recordedAt` are
 * assigned by the ledger itself, so an appender cannot forge ordering.
 */
const ledgerEventInputProperties = {
  eventId: IdSchema,
  missionId: IdSchema,
  /** Null for mission-scoped events that belong to no single task. */
  taskId: Type.Union([IdSchema, Type.Null()]),
  family: LedgerEventFamilySchema,
  /** The specific act within the family, e.g. `gate_b.verdict_issued`. */
  type: TextSchema,
  actor: ActorSchema,
  payload: Type.Record(Type.String(), Type.Unknown()),
  occurredAt: TimestampSchema,
} as const;

/** What an appender submits. */
export const LedgerEventInputSchema = Type.Object(ledgerEventInputProperties, {
  $id: 'LedgerEventInput',
  additionalProperties: false,
  description: 'An event as submitted for append; the ledger assigns seq and recordedAt.',
});
export type LedgerEventInput = Static<typeof LedgerEventInputSchema>;

/**
 * A recorded, immutable event. `seq` is monotonic — it is what makes
 * time-travel replay and the replay benchmarks possible.
 */
export const LedgerEventSchema = Type.Object(
  {
    ...ledgerEventInputProperties,
    seq: Type.Integer({
      minimum: 1,
      description: 'Monotonic ledger position; the basis of ordering and time-travel replay.',
    }),
    recordedAt: TimestampSchema,
  },
  {
    $id: 'LedgerEvent',
    additionalProperties: false,
    description: 'An appended, immutable audit-ledger event.',
  },
);
export type LedgerEvent = Static<typeof LedgerEventSchema>;
