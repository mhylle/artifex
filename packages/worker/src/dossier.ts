/**
 * What a mission hands back — a pedigree when it delivers, a dossier when it
 * surrenders (R37).
 *
 * Both are **derived from the trail**, never accumulated alongside it. The
 * ledger already holds every verdict, escalation, evidence bundle and effort
 * figure; a second copy assembled as the mission ran would be a second truth
 * that can drift from the first. That is the rule the dashboard projection
 * already follows, and the reason `mission.folded` used to carry two numbers:
 * nobody had written the fold.
 *
 * The asymmetry is deliberate. A delivered result is a claim, so its pedigree
 * says how far to trust it. A surrender is a *handover*, so its dossier says
 * what the next attempt should not have to rediscover.
 */
import type { LedgerEventInput, TaskContract } from '@artifex/shared-types';

interface Payload {
  readonly outcome?: unknown;
  readonly verificationDepth?: unknown;
  readonly criteria?: unknown;
  readonly findings?: unknown;
  readonly assumptions?: unknown;
  readonly effortSpent?: unknown;
  readonly capabilities?: unknown;
  readonly rung?: unknown;
  readonly entryClass?: unknown;
  readonly objective?: unknown;
}

const payloadOf = (e: LedgerEventInput) => e.payload as Payload;

/** Every event for a task, oldest first. */
const forTask = (trail: readonly LedgerEventInput[], taskId: string) =>
  trail.filter((e) => e.taskId === taskId);

/**
 * The LAST Gate B verdict per task.
 *
 * Last, not any: a task that failed and then passed on retry is verified, and a
 * task that passed and was later re-run and failed is not. Taking "any pass"
 * would let a pedigree cite a verification that was subsequently overturned.
 */
function lastVerdicts(trail: readonly LedgerEventInput[]): Map<string, LedgerEventInput> {
  const byTask = new Map<string, LedgerEventInput>();
  for (const event of trail) {
    if (event.type !== 'gate_b.verdict_issued' || event.taskId === null) continue;
    byTask.set(event.taskId, event);
  }
  return byTask;
}

/** Effort actually spent, summed from what the workers reported. */
function effortSpent(trail: readonly LedgerEventInput[]): number {
  return trail
    .filter((e) => e.type === 'task.executed')
    .reduce((total, e) => {
      const spent = payloadOf(e).effortSpent;
      return total + (typeof spent === 'number' ? spent : 0);
    }, 0);
}

export interface VerifiedTask {
  readonly taskId: string;
  readonly objective: string | null;
  /** How deeply it was checked — the contract's demand, as the reviewer ran it. */
  readonly depth: string;
  readonly criteria: readonly string[];
  /** Ledger event ids, so a reader can reach the individual task. */
  readonly evidence: readonly string[];
}

export interface Pedigree {
  readonly missionId: string;
  readonly verified: readonly VerifiedTask[];
  readonly assumptions: ReadonlyArray<{ readonly taskId: string; readonly assumption: string }>;
  readonly budget: { readonly spent: number; readonly ceiling: number; readonly unit: string };
}

/**
 * What a delivered result carries with it (R37 AC-0).
 *
 * The pedigree answers "how far should I trust this": what was checked and how
 * deeply, what the workers took for granted, what it cost, and where to look.
 */
export function pedigreeOf(mission: TaskContract, trail: readonly LedgerEventInput[]): Pedigree {
  const verdicts = lastVerdicts(trail);

  const verified: VerifiedTask[] = [];
  for (const [taskId, verdict] of verdicts) {
    if (payloadOf(verdict).outcome !== 'pass') continue;

    const events = forTask(trail, taskId);
    const contracted = events.find((e) => e.type === 'task.contracted');
    const criteria = payloadOf(verdict).criteria;

    verified.push({
      taskId,
      objective: typeof payloadOf(contracted ?? verdict).objective === 'string'
        ? (payloadOf(contracted ?? verdict).objective as string)
        : null,
      depth: typeof payloadOf(verdict).verificationDepth === 'string'
        ? (payloadOf(verdict).verificationDepth as string)
        : 'unknown',
      criteria: Array.isArray(criteria)
        ? criteria
          .map((c) => (c as { criterionId?: unknown }).criterionId)
          .filter((id): id is string => typeof id === 'string')
        : [],
      // Every event this task produced. A pedigree that named tasks without
      // citing events would leave the reader knowing something happened and
      // unable to find it.
      evidence: events.map((e) => e.eventId),
    });
  }

  const assumptions: Array<{ taskId: string; assumption: string }> = [];
  for (const event of trail) {
    if (event.type !== 'task.executed' || event.taskId === null) continue;
    const declared = payloadOf(event).assumptions;
    if (!Array.isArray(declared)) continue;
    for (const assumption of declared) {
      if (typeof assumption === 'string') assumptions.push({ taskId: event.taskId, assumption });
    }
  }

  return {
    missionId: mission.missionId,
    verified,
    assumptions,
    budget: {
      spent: effortSpent(trail),
      ceiling: mission.budget.ceiling,
      unit: mission.budget.unit,
    },
  };
}

export interface SurrenderDossier extends Pedigree {
  readonly reason: string;
  readonly completed: readonly VerifiedTask[];
  readonly blockers: ReadonlyArray<{
    readonly taskId: string;
    readonly detail: string;
    readonly errorClass: string;
    readonly evidence: readonly string[];
  }>;
  readonly escalations: ReadonlyArray<{
    readonly taskId: string;
    readonly rung: string;
    readonly entryClass: string | null;
  }>;
  readonly whatItWouldTake: readonly string[];
}

/**
 * What a surrendered mission hands over (R37 AC-1).
 *
 * A surrender is not a total loss and must not read like one: whatever was
 * verified stays verified, and the next attempt should not have to rediscover
 * any of it.
 *
 * `whatItWouldTake` is the part that turns a refusal into a next step. It is
 * DERIVED, not speculated: each entry comes from something the trail actually
 * recorded — a criterion no verdict ever met, a `staffing.capability_gap`, a
 * budget genuinely close to its ceiling, an escalation that reached the human
 * rung. Asking a model to imagine what might help would produce plausible
 * suggestions with nothing behind them, which is worse than silence because the
 * requester cannot tell the difference.
 */
export function surrenderDossier(
  mission: TaskContract,
  trail: readonly LedgerEventInput[],
  reason: string,
  blockerSummaries: readonly string[],
): SurrenderDossier {
  const base = pedigreeOf(mission, trail);
  const verdicts = lastVerdicts(trail);

  const blockers: SurrenderDossier['blockers'] = [...verdicts.entries()]
    .filter(([, verdict]) => payloadOf(verdict).outcome !== 'pass')
    .flatMap(([taskId, verdict]) => {
      const findings = payloadOf(verdict).findings;
      if (!Array.isArray(findings)) return [];
      return findings.map((f) => {
        const finding = f as { detail?: unknown; errorClass?: unknown };
        return {
          taskId,
          detail: typeof finding.detail === 'string' ? finding.detail : 'no detail recorded',
          errorClass: typeof finding.errorClass === 'string' ? finding.errorClass : 'unknown',
          evidence: forTask(trail, taskId).map((e) => e.eventId),
        };
      });
    });

  const escalations = trail
    .filter((e) => e.type === 'escalation.rung_climbed' && e.taskId !== null)
    .map((e) => ({
      taskId: e.taskId!,
      rung: typeof payloadOf(e).rung === 'string' ? (payloadOf(e).rung as string) : 'unknown',
      entryClass: typeof payloadOf(e).entryClass === 'string' ? (payloadOf(e).entryClass as string) : null,
    }));

  // ---- what it would take, derived ----------------------------------------
  const whatItWouldTake: string[] = [];

  // Criteria no verdict ever met. Named in full, because "relax the criteria" is
  // useless without saying which.
  const met = new Set<string>();
  for (const verdict of verdicts.values()) {
    const criteria = payloadOf(verdict).criteria;
    if (!Array.isArray(criteria)) continue;
    for (const c of criteria) {
      const entry = c as { criterionId?: unknown; met?: unknown };
      if (entry.met === true && typeof entry.criterionId === 'string') met.add(entry.criterionId);
    }
  }
  const unmet = mission.acceptanceCriteria.filter((c) => !met.has(c.criterionId));
  if (unmet.length > 0) {
    whatItWouldTake.push(
      `Relax or restate: ${unmet.map((c) => `"${c.statement}"`).join(', ')} — no verification ever met ${unmet.length === 1 ? 'it' : 'them'}.`,
    );
  }

  // Capabilities the swarm could not staff, as it reported at the time.
  const gaps = trail
    .filter((e) => e.type === 'staffing.capability_gap')
    .flatMap((e) => {
      const capabilities = payloadOf(e).capabilities;
      return Array.isArray(capabilities) ? capabilities.filter((c): c is string => typeof c === 'string') : [];
    });
  if (gaps.length > 0) {
    whatItWouldTake.push(`Supply a capability for: ${[...new Set(gaps)].join(', ')}.`);
  }

  // Budget, only when it was actually the constraint. Suggesting more of it
  // otherwise sends the requester to buy what was never scarce.
  const spent = base.budget.spent;
  if (spent >= mission.budget.ceiling * 0.9) {
    whatItWouldTake.push(
      `Add budget: ${spent} of ${mission.budget.ceiling} ${mission.budget.unit} was consumed before stopping.`,
    );
  }

  // The one thing the swarm cannot decide for itself.
  if (escalations.some((e) => e.rung === 'human_review')) {
    whatItWouldTake.push('Make the call the swarm escalated for — it reached the human rung and stopped.');
  }

  return {
    ...base,
    reason,
    completed: base.verified,
    blockers: blockers.length > 0
      ? blockers
      : blockerSummaries.map((detail) => ({
        taskId: mission.taskId,
        detail,
        errorClass: 'unknown',
        // Whole-mission events, since no task-level verdict carried this.
        evidence: trail.filter((e) => e.taskId === mission.taskId).map((e) => e.eventId),
      })),
    escalations,
    whatItWouldTake,
  };
}
