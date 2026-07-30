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

export type MissionStatus = 'running' | 'delivered' | 'surrendered';

export interface TaskNode {
  readonly taskId: string;
  readonly objective: string;
  readonly status: TaskStatus;
  readonly logicalTier: number | null;
  readonly escalations: number;
  readonly blastRadius: string | null;
  readonly children: TaskNode[];
}

export interface MissionNode {
  readonly taskId: string;
  readonly objective: string;
  readonly status: MissionStatus;
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

  const tasks = new Map<string, Accumulator>();
  const order: string[] = [];

  const touch = (taskId: string): Accumulator => {
    const existing = tasks.get(taskId);
    if (existing !== undefined) return existing;
    const created: Accumulator = {
      objective: '', status: 'contracted', logicalTier: null, escalations: 0, blastRadius: null,
    };
    tasks.set(taskId, created);
    order.push(taskId);
    return created;
  };

  for (const event of ordered) {
    const { taskId, payload, type } = event;

    switch (type) {
      case 'mission.started':
        missionObjective = str(payload, 'objective') ?? '';
        break;
      case 'mission.folded':
        missionStatus = 'delivered';
        break;
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
        node.status = 'contracted';
        break;
      }
      case 'agent.staffed': {
        if (taskId === null || taskId === missionId) break;
        const node = touch(taskId);
        const tier = payload['logicalTier'];
        node.logicalTier = typeof tier === 'number' ? tier : node.logicalTier;
        node.status = 'staffed';
        break;
      }
      case 'task.executed': {
        if (taskId === null || taskId === missionId) break;
        touch(taskId).status = 'executing';
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
        // Derived, never stored: the status IS the last verdict.
        node.status = str(payload, 'outcome') === 'pass' ? 'verified' : 'failed';
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
    blockers,
    eventCount: ordered.length,
    children: order.map((taskId) => {
      const node = tasks.get(taskId)!;
      return {
        taskId,
        objective: node.objective,
        status: node.status,
        logicalTier: node.logicalTier,
        escalations: node.escalations,
        blastRadius: node.blastRadius,
        children: [],
      };
    }),
  };
}
