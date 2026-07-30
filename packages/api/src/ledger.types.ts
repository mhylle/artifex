/**
 * The narrow slices of the Memory Fabric the control plane is allowed to touch.
 *
 * The API is a *reader* of the ledger with two exceptions — intake and human
 * gates — because human actions are first-class ledger events (the symmetry
 * rule). Expressing that as a deliberately thin interface keeps the boundary
 * visible: anything wider would let the control plane start behaving like the
 * runtime.
 */
import type { LedgerEvent, LedgerEventInput } from '@artifex/shared-types';

export interface LedgerSink {
  append(event: LedgerEventInput): Promise<unknown>;
}

export interface LedgerReader {
  replay(filter: { missionId: string }): Promise<LedgerEvent[]>;
}

/** A pointer, as the ledger's `LISTEN/NOTIFY` channel delivers it. */
export interface LedgerNotification {
  readonly seq: number;
  readonly eventId: string;
  readonly missionId: string;
  readonly taskId: string | null;
  readonly family: string;
  readonly type: string;
}
