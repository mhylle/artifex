/**
 * The four remaining lenses (R19) — workforce, timeline, learning, ledger.
 *
 * "One dashboard, five ways of looking at the same ledger — switchable per
 * mission, shareable as links, **identical truth underneath**."
 *
 * Every lens here is a pure function of the same event list the canvas folds.
 * That is not tidiness: two lenses cannot contradict each other if neither has
 * its own source. A lens that ran its own query could drift, and the operator
 * would have no way to tell which one was lying.
 */
import type { LedgerEventView } from './mission-tree';

/** Events as they arrive, plus the timestamp the lenses need. */
export type TimedEvent = LedgerEventView & { readonly occurredAt?: string };

const at = (event: TimedEvent): number => Date.parse(event.occurredAt ?? '') || 0;

const secondsBetween = (from: number, to: number): number =>
  from === 0 || to === 0 ? 0 : Math.max(0, Math.round((to - from) / 1000));

// ---------------------------------------------------------------- workforce --

export interface WorkforceAgent {
  readonly designId: string;
  readonly version: number | null;
  readonly logicalTier: number | null;
  readonly taskId: string;
  readonly category: string | null;
  readonly objective: string;
  /**
   * Share of this agent's own Gate B verdicts that passed.
   *
   * `null` — not zero — when nothing has judged it yet. Reporting "0% compliant"
   * for an unjudged agent would defame it with a number the ledger never
   * supported, and would poison any later clade score computed from it.
   */
  readonly complianceRate: number | null;
  readonly runtimeSeconds: number;
}

/** Every specialist the trail staffed, with what it holds and how it is doing. */
export function buildWorkforce(events: readonly TimedEvent[]): WorkforceAgent[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const category = new Map<string, string | null>();
  const objective = new Map<string, string>();
  const verdicts = new Map<string, { passed: number; total: number }>();
  const lastSeen = new Map<string, number>();

  for (const event of ordered) {
    const taskId = event.taskId;
    if (taskId === null) continue;
    lastSeen.set(taskId, at(event));

    if (event.type === 'task.contracted') {
      const raw = event.payload['category'];
      category.set(taskId, typeof raw === 'string' ? raw : null);
      const obj = event.payload['objective'];
      objective.set(taskId, typeof obj === 'string' ? obj : '');
    }

    if (event.type === 'gate_b.verdict_issued') {
      const tally = verdicts.get(taskId) ?? { passed: 0, total: 0 };
      tally.total += 1;
      if (event.payload['outcome'] === 'pass') tally.passed += 1;
      verdicts.set(taskId, tally);
    }
  }

  const agents: WorkforceAgent[] = [];
  for (const event of ordered) {
    if (event.type !== 'agent.staffed' || event.taskId === null) continue;
    const taskId = event.taskId;
    const tally = verdicts.get(taskId);
    const version = event.payload['version'];
    const tier = event.payload['logicalTier'];

    agents.push({
      designId: String(event.payload['designId'] ?? 'unknown'),
      version: typeof version === 'number' ? version : null,
      logicalTier: typeof tier === 'number' ? tier : null,
      taskId,
      category: category.get(taskId) ?? null,
      objective: objective.get(taskId) ?? '',
      complianceRate: tally === undefined || tally.total === 0 ? null : tally.passed / tally.total,
      runtimeSeconds: secondsBetween(at(event), lastSeen.get(taskId) ?? 0),
    });
  }
  return agents;
}

// ----------------------------------------------------------------- timeline --

export interface TimelineEntry {
  readonly seq: number;
  readonly taskId: string;
  readonly type: string;
  readonly occurredAt: string;
}

export interface TimelineLane {
  readonly taskId: string;
  readonly objective: string;
  readonly entries: readonly TimelineEntry[];
  /** Contracted → staffed. Where stalls become visible. */
  readonly waitedSeconds: number;
  /** Staffed → last event. Null when it never started. */
  readonly ranSeconds: number | null;
}

/** One swimlane per task: when it waited, ran, was reviewed and escalated. */
export function buildTimeline(events: readonly TimedEvent[]): TimelineLane[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const lanes = new Map<string, TimelineEntry[]>();
  const objective = new Map<string, string>();
  const contractedAt = new Map<string, number>();
  const staffedAt = new Map<string, number>();
  const lastAt = new Map<string, number>();

  for (const event of ordered) {
    const taskId = event.taskId;
    // Mission-level events belong to no lane; a lane is a task's own story.
    if (taskId === null || taskId === ordered[0]?.missionId) continue;

    const entries = lanes.get(taskId) ?? [];
    entries.push({ seq: event.seq, taskId, type: event.type, occurredAt: event.occurredAt ?? '' });
    lanes.set(taskId, entries);
    lastAt.set(taskId, at(event));

    if (event.type === 'task.contracted') {
      contractedAt.set(taskId, at(event));
      const obj = event.payload['objective'];
      objective.set(taskId, typeof obj === 'string' ? obj : '');
    }
    if (event.type === 'agent.staffed' && !staffedAt.has(taskId)) staffedAt.set(taskId, at(event));
  }

  return [...lanes.entries()].map(([taskId, entries]) => {
    const started = staffedAt.get(taskId);
    return {
      taskId,
      objective: objective.get(taskId) ?? '',
      entries,
      waitedSeconds: secondsBetween(contractedAt.get(taskId) ?? 0, started ?? 0),
      // Null rather than 0 for a task that never started: it has not run for no
      // time, it has not run.
      ranSeconds: started === undefined ? null : secondsBetween(started, lastAt.get(taskId) ?? 0),
    };
  });
}

// ---------------------------------------------------------- ledger explorer --

export interface LedgerFilter {
  readonly family?: string;
  readonly errorClass?: string;
  readonly agent?: string;
  readonly criterionId?: string;
  readonly since?: string;
}

/**
 * The raw trail, narrowed.
 *
 * Filters COMBINE — each is an additional constraint, never a replacement.
 * Treating the newest filter as the only one would quietly widen an
 * investigation at exactly the moment the operator was trying to narrow it.
 */
export function buildLedgerView(
  events: readonly TimedEvent[],
  filter: LedgerFilter,
): readonly TimedEvent[] {
  // Which tasks a named agent held — so "what did this specialist do" is one
  // query rather than a cross-reference the operator performs by hand.
  const agentTasks = new Set<string>();
  if (filter.agent !== undefined) {
    for (const event of events) {
      if (event.type === 'agent.staffed' && String(event.payload['designId'] ?? '') === filter.agent) {
        if (event.taskId !== null) agentTasks.add(event.taskId);
      }
    }
  }

  const findings = (event: TimedEvent): Array<{ errorClass?: unknown; criterionId?: unknown }> => {
    const raw = event.payload['findings'];
    return Array.isArray(raw) ? (raw as Array<{ errorClass?: unknown; criterionId?: unknown }>) : [];
  };

  return events.filter((event) => {
    if (filter.family !== undefined && event.family !== filter.family) return false;
    if (filter.agent !== undefined && (event.taskId === null || !agentTasks.has(event.taskId))) return false;
    if (filter.since !== undefined && at(event) < Date.parse(filter.since)) return false;
    if (filter.errorClass !== undefined
      && !findings(event).some((f) => f.errorClass === filter.errorClass)) return false;
    if (filter.criterionId !== undefined
      && !findings(event).some((f) => f.criterionId === filter.criterionId)) return false;
    return true;
  });
}

// ------------------------------------------------------ learning observatory --

export interface LearningView {
  readonly experiments: readonly TimedEvent[];
  readonly adoptions: readonly TimedEvent[];
  readonly reverts: readonly TimedEvent[];
  /** Amendment petitions — PROPOSALS. Never rendered as applied changes. */
  readonly petitions: readonly TimedEvent[];
}

/**
 * The swarm improving itself.
 *
 * Petitions are kept in their own bucket rather than folded in with adoptions,
 * because invariant #4 is that the learner proposes and never ratifies. A lens
 * that showed a petition as a change would misrepresent the constitution — the
 * separation belongs in the projection, not in a CSS class.
 */
export function buildLearningView(events: readonly TimedEvent[]): LearningView {
  const of = (type: string) => events.filter((e) => e.type === type);
  return {
    experiments: of('learning.experiment_started'),
    adoptions: of('learning.adopted'),
    reverts: of('learning.reverted'),
    petitions: of('learning.amendment_petitioned'),
  };
}
