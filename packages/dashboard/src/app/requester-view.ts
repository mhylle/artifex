/**
 * The requester's view of their own mission (R22).
 *
 * The binding phrase in the criterion is "progress against the mission
 * contract's criteria — **not internal task counts**". A requester asked for
 * three things; how many tasks Artifex needed, how often it retried and which
 * tier it escalated to are the system's business, not theirs.
 *
 * This works only because criteria are **partitioned, never invented**: a child
 * task carries its parent's own `criterionId`, so a mission criterion can be
 * traced to the task holding it and graded by that task's Gate B verdict. Were
 * decomposition to mint fresh ids, this projection would be impossible and the
 * requester could only ever be shown internal task progress.
 */
import type { LedgerEventView } from './mission-tree';

export type CriterionState = 'unknown' | 'met' | 'unmet';

export interface RequesterCriterion {
  readonly criterionId: string;
  readonly statement: string;
  readonly state: CriterionState;
  /** The reviewer's words when it failed — why it is not yet done. */
  readonly detail: string | null;
}

export interface RequesterQuestion {
  /** Carried so the requester can actually answer it, not merely read it. */
  readonly taskId: string;
  readonly objective: string;
  readonly rung: string;
  readonly findings: readonly string[];
}

export interface RequesterView {
  readonly objective: string;
  readonly criteria: readonly RequesterCriterion[];
  readonly questions: readonly RequesterQuestion[];
  readonly budget: { readonly granted: number | null; readonly consumed: number };
  /**
   * Flagged assumptions — `null` meaning UNAVAILABLE, never `[]` meaning none.
   *
   * R40 built the producer: the worker is asked what it assumed and the mission
   * loop records it on `task.executed`, so this is now read from the trail
   * rather than pinned to `null`.
   *
   * The distinction it was created for still holds, and still matters:
   *   - `null` — nothing in this trail carries assumptions. Either no task has
   *     executed yet, or the events predate R40. Nobody was asked.
   *   - `[]` — a worker WAS asked and declared none.
   *
   * An empty list where the truth is "unavailable" tells the requester nothing
   * was assumed, a claim the ledger cannot support — exactly the invented
   * reassurance that makes a dashboard worse than no dashboard.
   */
  readonly assumptions: readonly string[] | null;
  readonly outcome: 'running' | 'delivered' | 'surrendered';
}

const str = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
};

export function buildRequesterView(events: readonly LedgerEventView[]): RequesterView {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);

  let objective = '';
  let granted: number | null = null;
  let outcome: RequesterView['outcome'] = 'running';

  const declared: { criterionId: string; statement: string }[] = [];
  /** criterionId -> the task that holds it, from the partition. */
  const holder = new Map<string, string>();
  /** taskId -> its last Gate B verdict. */
  const verdicts = new Map<string, { outcome: string; failed: Map<string, string> }>();
  /** taskId -> its LAST reported spend (see below). */
  const spend = new Map<string, number>();
  const questions: RequesterQuestion[] = [];

  for (const event of ordered) {
    const { payload, taskId, type } = event;

    switch (type) {
      case 'mission.intake_accepted': {
        objective = str(payload, 'objective') ?? objective;
        const budget = payload['budget'];
        if (typeof budget === 'object' && budget !== null) {
          const ceiling = (budget as { ceiling?: unknown }).ceiling;
          if (typeof ceiling === 'number') granted = ceiling;
        }
        const contract = payload['contract'];
        const criteria = typeof contract === 'object' && contract !== null
          ? (contract as { acceptanceCriteria?: unknown }).acceptanceCriteria
          : undefined;
        if (Array.isArray(criteria)) {
          for (const raw of criteria) {
            const c = raw as { criterionId?: unknown; statement?: unknown };
            if (typeof c.criterionId === 'string') {
              declared.push({ criterionId: c.criterionId, statement: String(c.statement ?? '') });
            }
          }
        }
        break;
      }

      case 'mission.started':
        objective = str(payload, 'objective') ?? objective;
        break;

      case 'task.contracted': {
        // The partition: whichever task carries a mission criterion is the task
        // whose verdict grades it.
        if (taskId === null) break;
        const criteria = payload['acceptanceCriteria'];
        if (!Array.isArray(criteria)) break;
        for (const raw of criteria) {
          const c = raw as { criterionId?: unknown };
          if (typeof c.criterionId === 'string') holder.set(c.criterionId, taskId);
        }
        break;
      }

      case 'task.executed': {
        if (taskId === null) break;
        const spent = payload['effortSpent'];
        // LAST value per task, not a running sum — the same rule the inspector
        // and the canvas use. Two projections of one ledger must not disagree
        // about what a mission cost (R19 AC-4).
        if (typeof spent === 'number') spend.set(taskId, spent);
        break;
      }

      case 'gate_b.verdict_issued': {
        if (taskId === null) break;
        const failed = new Map<string, string>();
        const findings = payload['findings'];
        if (Array.isArray(findings)) {
          for (const raw of findings) {
            const f = raw as { criterionId?: unknown; detail?: unknown };
            if (typeof f.criterionId === 'string') failed.set(f.criterionId, String(f.detail ?? ''));
          }
        }
        // Replaced, never merged: the state IS the last verdict, so a retry
        // that passes must clear the earlier failure.
        verdicts.set(taskId, { outcome: str(payload, 'outcome') ?? '', failed });
        break;
      }

      case 'operator.budget_granted': {
        const amount = payload['amount'];
        if (typeof amount === 'number') granted = (granted ?? 0) + amount;
        break;
      }

      case 'escalation.awaiting_human': {
        const findings = payload['findings'];
        questions.push({
          taskId: taskId ?? '',
          objective: str(payload, 'objective') ?? '',
          rung: str(payload, 'rung') ?? '',
          findings: Array.isArray(findings) ? findings.map(String) : [],
        });
        break;
      }

      // BOTH delivery events (defect `dd2e9d18`) — the third site that knew only
      // `mission.folded`. A requester whose mission the gate kept WHOLE would
      // have been told it was still running long after they had the answer.
      case 'mission.folded':
      case 'mission.delivered':
        outcome = 'delivered';
        break;

      case 'mission.surrendered':
        outcome = 'surrendered';
        break;

      default:
        break;
    }
  }

  const criteria = declared.map(({ criterionId, statement }) => {
    const task = holder.get(criterionId);
    const verdict = task === undefined ? undefined : verdicts.get(task);
    if (verdict === undefined) return { criterionId, statement, state: 'unknown' as const, detail: null };
    const failure = verdict.failed.get(criterionId);
    return failure === undefined
      ? { criterionId, statement, state: 'met' as const, detail: null }
      : { criterionId, statement, state: 'unmet' as const, detail: failure };
  });

  // Collected across EVERY executed task: a mission's premises are the union of
  // its workers', and showing one task's as the mission's is the same silent
  // omission as reporting `[]` for unavailable.
  //
  // Stays `null` unless some `task.executed` actually carried the field, so a
  // trail written before R40 reads as "nobody was asked" rather than "none".
  let assumptions: string[] | null = null;
  for (const event of events) {
    if (event.type !== 'task.executed') continue;
    const declared = event.payload?.['assumptions'];
    if (!Array.isArray(declared)) continue;
    assumptions ??= [];
    assumptions.push(...declared.filter((a): a is string => typeof a === 'string'));
  }

  return {
    objective,
    criteria,
    questions,
    budget: {
      granted,
      consumed: [...spend.values()].reduce((total, n) => total + n, 0),
    },
    assumptions,
    outcome,
  };
}
