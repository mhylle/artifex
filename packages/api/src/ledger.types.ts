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

/** One mission as the fleet rail shows it (R21) — derived, never stored. */
export interface MissionSummary {
  readonly missionId: string;
  readonly objective: string | null;
  readonly status: 'running' | 'delivered' | 'surrendered' | 'abandoned';
  readonly eventCount: number;
  readonly escalations: number;
  readonly agentsStaffed: number;
  readonly tasksToday: number;
  readonly lastEventAt: string;
}

/** One item waiting on a human (R18) — carries everything needed to decide. */
export interface AttentionItem {
  readonly missionId: string;
  readonly taskId: string;
  readonly objective: string;
  readonly rung: string;
  readonly autonomyDial: string | null;
  readonly findings: readonly string[];
  readonly acceptanceCriteria: readonly { criterionId: string; statement: string }[];
  readonly waitingSince: string;
}

export interface LedgerReader {
  replay(filter: { missionId: string }): Promise<LedgerEvent[]>;
  listMissions(): Promise<MissionSummary[]>;
  listAttentionItems(): Promise<AttentionItem[]>;
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
