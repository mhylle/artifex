/**
 * What the mission actually did, beside what it produced (R40, R22 AC-1).
 *
 * A deliverable on its own is a claim. The facts that let a reader judge it —
 * how much of the budget was spent, what the worker declared it assumed, how
 * many tools it ran, how many sources it consulted, and what the reviewer
 * said — were all on the trail and rendered nowhere.
 *
 * They are what answers "would anyone be able to do anything real with this?".
 * A mission that spent 2 of 20 effort units, used no tools, consulted nothing
 * and passed review with no findings is not the same artefact as one that spent
 * 18 and cited its sources, even when the two answers look alike.
 */
import type { LedgerEventView } from './mission-tree';
import { sinceLastRestatement } from './current-plan';

export interface MissionEvidence {
  /** False when no task has executed — distinct from having done nothing. */
  readonly ran: boolean;
  readonly effortSpent: number;
  readonly ceiling: number | null;
  readonly assumptions: readonly string[];
  readonly toolsUsed: number;
  readonly sourcesConsulted: number;
  readonly verdict: string | null;
  readonly findings: readonly string[];
}

const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

export function buildMissionEvidence(events: readonly LedgerEventView[]): MissionEvidence {
  // Only the plan actually running: work done for a superseded specification is
  // not evidence about what was delivered (R41).
  const ordered = [...sinceLastRestatement(events)].sort((a, b) => a.seq - b.seq);

  /**
   * Per task, LAST value wins — the same rule the inspector and the requester
   * view use. Summing attempts would report a retried task as having cost every
   * attempt, and two projections of one trail must not disagree about cost
   * (R19 AC-4).
   */
  const spendByTask = new Map<string, number>();
  const toolsByTask = new Map<string, number>();
  const sourcesByTask = new Map<string, number>();
  const assumptionsByTask = new Map<string, readonly string[]>();

  let ceiling: number | null = null;
  let verdict: string | null = null;
  let findings: readonly string[] = [];
  let ran = false;

  for (const event of ordered) {
    if (event.type === 'mission.intake_accepted') {
      const contract = event.payload['contract'] as { budget?: { ceiling?: unknown } } | undefined;
      const declared = contract?.budget?.ceiling;
      if (typeof declared === 'number') ceiling = declared;
      continue;
    }

    if (event.type === 'task.executed' && event.taskId !== null) {
      ran = true;
      const spent = event.payload['effortSpent'];
      if (typeof spent === 'number') spendByTask.set(event.taskId, spent);
      toolsByTask.set(event.taskId, count(event.payload['actions']));
      sourcesByTask.set(event.taskId, count(event.payload['consulted']));
      const declared = event.payload['assumptions'];
      if (Array.isArray(declared)) assumptionsByTask.set(event.taskId, declared.map(String));
      continue;
    }

    if (event.type === 'gate_b.verdict_issued') {
      const outcome = event.payload['outcome'];
      if (typeof outcome === 'string') verdict = outcome;
      const raw = event.payload['findings'];
      findings = Array.isArray(raw)
        ? raw.map((f) => String((f as { detail?: unknown }).detail ?? f))
        : [];
    }
  }

  const total = (m: Map<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0);

  return {
    ran,
    effortSpent: total(spendByTask),
    // The per-task ceiling is not the mission's; the commissioned budget is.
    ceiling,
    assumptions: [...assumptionsByTask.values()].flat(),
    toolsUsed: total(toolsByTask),
    sourcesConsulted: total(sourcesByTask),
    verdict,
    findings,
  };
}
