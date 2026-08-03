/**
 * The mission tree — a pure projection of the audit ledger.
 *
 * The cockpit renders ledger events and persists nothing of its own
 * (invariant #1). The strongest way to hold that line in code is to make the
 * tree a **pure function of the event list**: no store, no mutation, no
 * accumulated view state. If the only way to obtain a tree is to fold the
 * events, a second source of truth has nowhere to hide — and "the dashboard is
 * a view, never a second truth" stops being a convention someone has to respect.
 *
 * Status is *derived*, never stored. A task is "verified" because its last Gate B
 * verdict passed, not because something set a flag — so the cockpit cannot
 * disagree with the ledger even transiently.
 */

/** The shape the API streams. Deliberately structural — the dashboard owns no schema. */
export interface LedgerEventView {
  readonly seq: number;
  readonly eventId: string;
  readonly missionId: string;
  readonly taskId: string | null;
  readonly family: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export type TaskStatus =
  | 'contracted'
  | 'staffed'
  | 'executing'
  | 'verified'
  | 'failed'
  | 'bounced';

export type MissionStatus = 'running' | 'delivered' | 'surrendered' | 'abandoned';

/**
 * A criterion's state (R16).
 *
 * Three values, not two. "Not yet judged" and "judged and failed" are different
 * facts, and collapsing them would have the dashboard inventing a verdict the
 * ledger never issued.
 */
export type CriterionState = 'unknown' | 'met' | 'unmet';

export interface CriterionView {
  readonly criterionId: string;
  readonly statement: string;
  readonly state: CriterionState;
  /** The reviewer's words when it failed — the drill-down's payload. */
  readonly detail: string | null;
}

export interface TaskNode {
  readonly taskId: string;
  readonly objective: string;
  readonly status: TaskStatus;
  readonly logicalTier: number | null;
  readonly escalations: number;
  readonly blastRadius: string | null;
  /** The kind of specialist this task is staffed by — shown on the node (R15). */
  readonly category: string | null;
  readonly parentTaskId: string | null;
  /** Sibling outputs this task consumes — the canvas's dependency edges. */
  readonly dependsOn: readonly string[];
  /** The contract's criteria with their live state — the inspector's spine. */
  readonly criteria: readonly CriterionView[];
  readonly designId: string | null;
  readonly designVersion: number | null;
  readonly effortSpent: number | null;
  readonly ceiling: number | null;
  /** This task's own events, so a drill-down bottoms out in the substrate. */
  readonly events: readonly LedgerEventView[];
  readonly children: TaskNode[];
}

export interface MissionNode {
  readonly taskId: string;
  readonly objective: string;
  readonly status: MissionStatus;
  /**
   * What the mission actually produced, or null while it has not.
   *
   * The owner of a delivered mission: "there is no place where I can see what
   * was delivered." The answer was on the trail and no lens read it —
   * find-shape (o). Taken from `mission.delivered`/`mission.folded`, never from
   * the last `task.executed`: a decomposed mission's answer is what the
   * reconciler assembled, and reading a task result would show one child's
   * fragment and call it the mission's.
   */
  readonly deliverable: unknown;
  readonly blockers: string[];
  readonly children: TaskNode[];
  readonly eventCount: number;
}

interface Accumulator {
  objective: string;
  status: TaskStatus;
  logicalTier: number | null;
  escalations: number;
  blastRadius: string | null;
  category: string | null;
  parentTaskId: string | null;
  dependsOn: string[];
  criteria: { criterionId: string; statement: string }[];
  designId: string | null;
  designVersion: number | null;
  effortSpent: number | null;
  ceiling: number | null;
  /** Findings of the LAST verdict — status is the last verdict, never a tally. */
  lastVerdict: { outcome: string; failed: Map<string, string> } | null;
  events: LedgerEventView[];
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

export function buildMissionTree(events: readonly LedgerEventView[]): MissionNode | null {
  if (events.length === 0) return null;

  // `seq` is the ledger's ordering, and it is the only one that counts — a
  // websocket delivers events promptly, not necessarily in order.
  const ordered = [...events].sort((a, b) => a.seq - b.seq);

  const missionId = ordered[0]!.missionId;
  let missionObjective = '';
  let missionStatus: MissionStatus = 'running';
  let blockers: string[] = [];
  let deliverable: unknown = null;
  /**
   * The mission task's own result, kept separately from the delivery event's.
   *
   * A mission the gate keeps WHOLE executes at the mission task itself, so that
   * is its answer — and every mission delivered before `mission.delivered`
   * began carrying the deliverable has its result only there. Never a child's:
   * reporting one fragment as the mission's result is worse than showing
   * nothing, because it looks complete.
   */
  let ownResult: unknown = null;

  const tasks = new Map<string, Accumulator>();
  const order: string[] = [];

  const touch = (taskId: string): Accumulator => {
    const existing = tasks.get(taskId);
    if (existing !== undefined) return existing;
    const created: Accumulator = {
      objective: '', status: 'contracted', logicalTier: null, escalations: 0, blastRadius: null,
      category: null, parentTaskId: null, dependsOn: [],
      criteria: [], designId: null, designVersion: null, effortSpent: null, ceiling: null,
      lastVerdict: null, events: [],
    };
    tasks.set(taskId, created);
    order.push(taskId);
    return created;
  };

  for (const event of ordered) {
    const { taskId, payload, type } = event;

    // Every event is filed against its own task, so a drill-down bottoms out in
    // the substrate rather than in a summary.
    if (taskId !== null && taskId !== missionId) touch(taskId).events.push(event);

    switch (type) {
      case 'mission.started':
        missionObjective = str(payload, 'objective') ?? '';
        // Status too, not only the objective. A mission that was swept as
        // abandoned and then actually ran must read as running again — that
        // self-correction is what makes the startup sweep safe to do
        // automatically on an append-only trail (ADR-0025).
        missionStatus = 'running';
        break;
      // Nothing writes an event when a worker dies, so the startup sweep
      // appends this one (defect `dd2e9d18`). Distinct from `surrendered`:
      // a surrender is a decision the system made and can explain, an
      // abandonment is a death it can only notice afterwards.
      case 'mission.abandoned':
        missionStatus = 'abandoned';
        break;

      /**
       * The operator restated the mission (R41). Everything contracted before
       * this was planned to satisfy criteria that no longer exist.
       *
       * The worker already knows: `foldPriorTrail` clears the plan when it
       * walks past a restatement, so the mission re-plans. This projection did
       * not, and drew the rejected tree over a mission that had since delivered
       * something else — two views of one trail disagreeing, which is the one
       * thing a pure projection exists to prevent.
       */
      case 'operator.restated':
        tasks.clear();
        order.length = 0;
        deliverable = null;
        ownResult = null;
        break;
      // BOTH delivery events (defect `dd2e9d18`). `mission.delivered` was added
      // by R37 AC-0 because a mission the decompose-or-delegate gate keeps WHOLE
      // never folds, and this projection was never taught about it — so a
      // kept-whole mission read as running forever. Seen live as a flat
      // contradiction: the fleet rail said DELIVERED and this header said
      // SURRENDERED for the same mission on the same screen.
      case 'mission.folded':
      case 'mission.delivered': {
        missionStatus = 'delivered';
        const produced = payload['deliverable'];
        if (produced !== undefined) deliverable = produced;
        // Cleared, not merely overwritten. A mission that surrendered, was
        // answered and then delivered (R41) has got PAST those blockers, and
        // listing them under a delivered header would describe a problem the
        // operator already solved.
        blockers = [];
        break;
      }
      case 'mission.surrendered': {
        missionStatus = 'surrendered';
        const raw = payload['blockers'];
        blockers = Array.isArray(raw) ? raw.map(String) : [];
        break;
      }
      case 'task.contracted': {
        if (taskId === null || taskId === missionId) break;
        const node = touch(taskId);
        node.objective = str(payload, 'objective') ?? '';
        node.blastRadius = str(payload, 'blastRadius');
        node.category = str(payload, 'category');
        node.parentTaskId = str(payload, 'parentTaskId');
        const consumes = payload['dependsOn'];
        node.dependsOn = Array.isArray(consumes) ? consumes.map(String) : [];
        const criteria = payload['acceptanceCriteria'];
        node.criteria = Array.isArray(criteria)
          ? criteria.map((c) => ({
              criterionId: String((c as { criterionId?: unknown }).criterionId ?? ''),
              statement: String((c as { statement?: unknown }).statement ?? ''),
            }))
          : [];
        const ceiling = payload['ceiling'];
        if (typeof ceiling === 'number') node.ceiling = ceiling;
        node.status = 'contracted';
        break;
      }
      case 'agent.staffed': {
        if (taskId === null || taskId === missionId) break;
        const node = touch(taskId);
        const tier = payload['logicalTier'];
        node.logicalTier = typeof tier === 'number' ? tier : node.logicalTier;
        node.designId = str(payload, 'designId') ?? node.designId;
        const version = payload['version'];
        if (typeof version === 'number') node.designVersion = version;
        node.status = 'staffed';
        break;
      }
      case 'task.executed': {
        // The mission task executing IS the mission's own work — that is what a
        // mission kept whole produces. Captured before the guard below, which
        // exists to keep mission-level events out of the task tree.
        if (taskId === missionId) {
          const produced = payload['deliverable'];
          if (produced !== undefined) ownResult = produced;
        }
        if (taskId === null || taskId === missionId) break;
        const node = touch(taskId);
        const spent = payload['effortSpent'];
        if (typeof spent === 'number') node.effortSpent = spent;
        const ceiling = payload['ceiling'];
        if (typeof ceiling === 'number') node.ceiling = ceiling;
        node.status = 'executing';
        break;
      }
      case 'task.bounced': {
        if (taskId === null || taskId === missionId) break;
        touch(taskId).status = 'bounced';
        break;
      }
      case 'task.failed': {
        if (taskId === null || taskId === missionId) break;
        touch(taskId).status = 'failed';
        break;
      }
      case 'gate_b.verdict_issued': {
        if (taskId === null || taskId === missionId) break;
        const node = touch(taskId);
        // Derived, never stored: the status IS the last verdict — and so is the
        // per-criterion state, which is why the previous verdict is replaced
        // rather than merged. A retry that passes must clear the old failure.
        const outcome = str(payload, 'outcome') ?? '';
        const rawFindings = payload['findings'];
        const failed = new Map<string, string>();
        if (Array.isArray(rawFindings)) {
          for (const finding of rawFindings) {
            const f = finding as { criterionId?: unknown; detail?: unknown };
            if (typeof f.criterionId === 'string') failed.set(f.criterionId, String(f.detail ?? ''));
          }
        }
        node.lastVerdict = { outcome, failed };
        node.status = outcome === 'pass' ? 'verified' : 'failed';
        break;
      }
      case 'escalation.rung_climbed': {
        if (taskId === null || taskId === missionId) break;
        const node = touch(taskId);
        node.escalations += 1;
        const to = payload['toTier'];
        if (typeof to === 'number') node.logicalTier = to;
        break;
      }
      default:
        break;
    }
  }

  return {
    taskId: missionId,
    objective: missionObjective,
    status: missionStatus,
    // The delivery event wins: for a decomposed mission it is the assembled
    // answer, and no task ever produced it.
    deliverable: deliverable ?? ownResult,
    blockers,
    eventCount: ordered.length,
    children: nest(order, tasks, missionId),
  };
}

/**
 * Fold the flat accumulator map into the parent/child graph the canvas draws.
 *
 * Two safeguards, both because this data is written by a model-driven loop and
 * arrives over a websocket rather than being constructed here:
 *
 *  - **An unknown parent does not lose the task.** It is attached at the root
 *    instead. A canvas quietly less complete than the ledger is the one thing it
 *    must never be — the operator cannot tell a missing node from a finished one.
 *  - **A parent cycle terminates.** Two tasks naming each other must degrade to
 *    a flat rendering, not spin the browser.
 */
function nest(
  order: readonly string[],
  tasks: ReadonlyMap<string, Accumulator>,
  missionId: string,
): TaskNode[] {
  const nodes = new Map<string, TaskNode>();
  for (const taskId of order) {
    const acc = tasks.get(taskId)!;
    nodes.set(taskId, {
      taskId,
      objective: acc.objective,
      status: acc.status,
      logicalTier: acc.logicalTier,
      escalations: acc.escalations,
      blastRadius: acc.blastRadius,
      category: acc.category,
      parentTaskId: acc.parentTaskId,
      dependsOn: acc.dependsOn,
      criteria: acc.criteria.map((c) => {
        const verdict = acc.lastVerdict;
        if (verdict === null) return { ...c, state: 'unknown' as const, detail: null };
        const failure = verdict.failed.get(c.criterionId);
        return failure === undefined
          ? { ...c, state: 'met' as const, detail: null }
          : { ...c, state: 'unmet' as const, detail: failure };
      }),
      designId: acc.designId,
      designVersion: acc.designVersion,
      effortSpent: acc.effortSpent,
      ceiling: acc.ceiling,
      events: acc.events,
      children: [],
    });
  }

  /** Walks up the recorded parents; returns false if the chain loops. */
  const reachesRoot = (from: string): boolean => {
    const seen = new Set<string>([from]);
    let cursor = tasks.get(from)?.parentTaskId ?? null;
    while (cursor !== null && cursor !== missionId) {
      if (seen.has(cursor) || !nodes.has(cursor)) return false;
      seen.add(cursor);
      cursor = tasks.get(cursor)?.parentTaskId ?? null;
    }
    return true;
  };

  const roots: TaskNode[] = [];
  for (const taskId of order) {
    const node = nodes.get(taskId)!;
    const parentId = node.parentTaskId;
    const parent = parentId === null || parentId === missionId ? undefined : nodes.get(parentId);

    if (parent === undefined || !reachesRoot(taskId)) {
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }
  return roots;
}
