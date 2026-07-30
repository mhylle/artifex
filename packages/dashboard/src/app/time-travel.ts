/**
 * Time travel (R20) — reconstruct any past moment from the ledger.
 *
 * There is no snapshot store here, and there must never be one. The cockpit
 * already holds the raw event list and derives everything from it, so a past
 * moment is that same list truncated at a `seq` and pushed through the same
 * projections the present uses. That is the whole mechanism.
 *
 * The alternative — writing a snapshot per moment — would give the dashboard a
 * second source of truth, which invariant #1 exists to forbid: a snapshot can
 * disagree with the ledger, and the operator would have no way to tell which one
 * was lying. Re-folding cannot disagree with the ledger, because it IS the
 * ledger.
 */
import { buildMissionTree } from './mission-tree';
import type { LedgerEventView, TaskNode } from './mission-tree';

/** Events as they arrive; `occurredAt` is what lets a moment say *when*. */
export type TimedEvent = LedgerEventView & { readonly occurredAt?: string };

/**
 * The trail as it stood at `seq`.
 *
 * `null` means the operator is not time travelling — the present, the whole
 * list. That is a different thing from "the empty past", and conflating the two
 * would blank the cockpit on load.
 *
 * Truncation is by `seq`, never by array position: the websocket delivers
 * promptly but not necessarily in order, and slicing by position would show a
 * plausible-looking wrong moment.
 */
export function eventsAsOf<E extends LedgerEventView>(
  events: readonly E[],
  seq: number | null,
): readonly E[] {
  if (seq === null) return events;
  return events.filter((event) => event.seq <= seq);
}

/** One stop on the scrubber — every recorded event is a moment you can visit. */
export interface Moment {
  readonly seq: number;
  readonly type: string;
  readonly taskId: string | null;
  readonly occurredAt: string | null;
}

/** The stops, in ledger order. An empty trail has none — not a phantom zero. */
export function momentsOf(events: readonly TimedEvent[]): Moment[] {
  return [...events]
    .sort((a, b) => a.seq - b.seq)
    .map((event) => ({
      seq: event.seq,
      type: event.type,
      taskId: event.taskId,
      occurredAt: event.occurredAt ?? null,
    }));
}

export interface TaskChange {
  readonly taskId: string;
  readonly objective: string;
  /** `null` when the task did not exist at the earlier moment. */
  readonly before: string | null;
  readonly after: string;
}

export interface MomentDiff {
  readonly fromSeq: number;
  readonly toSeq: number;
  readonly eventsBetween: number;
  readonly appeared: readonly TaskChange[];
  readonly changed: readonly TaskChange[];
  /** Deltas, not totals — see `criteriaMet`. */
  readonly effortSpent: number;
  readonly escalations: number;
  /**
   * Change in the number of criteria in state `met`.
   *
   * A DELTA, deliberately, and signed. Reporting the later moment's total would
   * be indistinguishable from progress on a mission that had regressed — and
   * "demonstrates an improvement rather than asserting it" is exactly the claim
   * this number is supposed to support.
   */
  readonly criteriaMet: number;
}

/**
 * What changed between two moments.
 *
 * The comparison always reads forward: the earlier moment is `from`, whichever
 * handle the operator dragged first. Otherwise dragging right-to-left would
 * report negative effort and a lost criterion — a regression that never
 * happened, produced purely by the order of two mouse gestures.
 */
export function diffMoments(
  events: readonly TimedEvent[],
  seqA: number,
  seqB: number,
): MomentDiff {
  const fromSeq = Math.min(seqA, seqB);
  const toSeq = Math.max(seqA, seqB);

  const before = index(buildMissionTree(eventsAsOf(events, fromSeq))?.children ?? []);
  const after = index(buildMissionTree(eventsAsOf(events, toSeq))?.children ?? []);

  const appeared: TaskChange[] = [];
  const changed: TaskChange[] = [];

  for (const [taskId, node] of after) {
    const prior = before.get(taskId);
    if (prior === undefined) {
      appeared.push({ taskId, objective: node.objective, before: null, after: node.status });
    } else if (prior.status !== node.status) {
      changed.push({ taskId, objective: node.objective, before: prior.status, after: node.status });
    }
  }

  const sum = (nodes: Map<string, TaskNode>, of: (node: TaskNode) => number): number =>
    [...nodes.values()].reduce((total, node) => total + of(node), 0);

  return {
    fromSeq,
    toSeq,
    eventsBetween: events.filter((e) => e.seq > fromSeq && e.seq <= toSeq).length,
    appeared,
    changed,
    effortSpent: sum(after, (n) => n.effortSpent ?? 0) - sum(before, (n) => n.effortSpent ?? 0),
    escalations: sum(after, (n) => n.escalations) - sum(before, (n) => n.escalations),
    criteriaMet: sum(after, met) - sum(before, met),
  };
}

const met = (node: TaskNode): number =>
  node.criteria.filter((criterion) => criterion.state === 'met').length;

/** Flattens the tree to `taskId -> node`, so two moments can be compared by id. */
function index(nodes: readonly TaskNode[]): Map<string, TaskNode> {
  const flat = new Map<string, TaskNode>();
  const walk = (list: readonly TaskNode[]): void => {
    for (const node of list) {
      flat.set(node.taskId, node);
      walk(node.children);
    }
  };
  walk(nodes);
  return flat;
}
