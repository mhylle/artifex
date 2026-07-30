/**
 * P12 — the mission tree projection (R10 AC-2, dashboard half).
 *
 * The cockpit "renders ledger events and persists nothing of its own"
 * (invariant #1). The sharpest way to hold that line is to make the tree a
 * **pure function of the event list** — no store, no mutation, no accumulated
 * view state. If the tree can only be produced by folding the events, then a
 * second source of truth has nowhere to hide.
 */
import { buildMissionTree } from './mission-tree';
import type { LedgerEventView } from './mission-tree';

const MISSION = 'm-1';

function ev(seq: number, type: string, taskId: string | null, payload: Record<string, unknown> = {}): LedgerEventView {
  return { seq, eventId: `e-${seq}`, missionId: MISSION, taskId, family: 'contract', type, payload };
}

const TRAIL: LedgerEventView[] = [
  ev(1, 'mission.started', MISSION, { objective: 'Two-part briefing' }),
  ev(2, 'task.contracted', 't-a', { objective: 'Part A', blastRadius: 'low' }),
  ev(3, 'task.contracted', 't-b', { objective: 'Part B', blastRadius: 'low' }),
  ev(4, 'gate_a.verdict_issued', MISSION, { outcome: 'pass' }),
  ev(5, 'agent.staffed', 't-a', { logicalTier: 1, designId: 'd-1' }),
  ev(6, 'task.executed', 't-a', {}),
  ev(7, 'gate_b.verdict_issued', 't-a', { outcome: 'fail' }),
  ev(8, 'escalation.rung_climbed', 't-a', { rung: 'retry_higher_tier', fromTier: 1, toTier: 2 }),
  ev(9, 'agent.staffed', 't-a', { logicalTier: 2, designId: 'd-1' }),
  ev(10, 'task.executed', 't-a', {}),
  ev(11, 'gate_b.verdict_issued', 't-a', { outcome: 'pass' }),
  ev(12, 'mission.folded', MISSION, { childCount: 2 }),
];

describe('R10 AC-2 — the task tree renders from ledger events', () => {
  it('builds the mission node and its children from the trail', () => {
    const tree = buildMissionTree(TRAIL);

    expect(tree?.taskId).toBe(MISSION);
    expect(tree?.objective).toBe('Two-part briefing');
    expect(tree?.children.map((c) => c.taskId)).toEqual(['t-a', 't-b']);
  });

  it('derives each task status from its verdicts, not from a stored flag', () => {
    const tree = buildMissionTree(TRAIL);

    expect(tree?.children[0]?.status).toBe('verified');
    // t-b was contracted but never executed — the tree must show that honestly.
    expect(tree?.children[1]?.status).toBe('contracted');
  });

  it('shows the mission as delivered once it folds', () => {
    expect(buildMissionTree(TRAIL)?.status).toBe('delivered');
  });

  it('surfaces the CURRENT tier, so a tier bump is visible in the cockpit', () => {
    const tree = buildMissionTree(TRAIL);

    expect(tree?.children[0]?.logicalTier).toBe(2);
    expect(tree?.children[0]?.escalations).toBe(1);
  });

  it('DISTRACTOR: it is a pure projection — same events in, same tree out', () => {
    // If the tree were accumulated in a store, a second fold would drift.
    expect(buildMissionTree(TRAIL)).toEqual(buildMissionTree(TRAIL));
  });

  it('DISTRACTOR: it does not mutate the events it is given', () => {
    const snapshot = JSON.stringify(TRAIL);

    buildMissionTree(TRAIL);

    expect(JSON.stringify(TRAIL)).toBe(snapshot);
  });

  it('DISTRACTOR: a PARTIAL trail renders a partial tree, not a wrong one', () => {
    // A cockpit opened mid-mission must not invent state it has not seen.
    const partial = buildMissionTree(TRAIL.slice(0, 6));

    expect(partial?.status).toBe('running');
    expect(partial?.children[0]?.status).toBe('executing');
    expect(partial?.children[0]?.escalations).toBe(0);
  });

  it('DISTRACTOR: events arriving out of order still fold to the same tree', () => {
    // The websocket is not a total order guarantee; seq is.
    const shuffled = [...TRAIL].reverse();

    expect(buildMissionTree(shuffled)).toEqual(buildMissionTree(TRAIL));
  });

  it('an empty trail is null, not an invented mission', () => {
    expect(buildMissionTree([])).toBeNull();
  });

  it('shows surrender as a real outcome', () => {
    const surrendered = [...TRAIL.slice(0, 8), ev(9, 'mission.surrendered', MISSION, { blockers: ['no source'] })];

    const tree = buildMissionTree(surrendered);

    expect(tree?.status).toBe('surrendered');
    expect(tree?.blockers).toEqual(['no source']);
  });
});

/**
 * R15 — the canvas lens needs structure the flat list never carried: each
 * node's category, its parent, and what it depends on. Edges cannot be drawn
 * from data that was never recorded.
 */
describe('R15 — the projection carries the graph, not just a list', () => {
  const ev = (seq: number, type: string, taskId: string | null, payload: Record<string, unknown> = {}) =>
    ({ seq, eventId: `e-${seq}`, missionId: 'm-1', taskId, family: 'contract', type, payload });

  it('AC-0: a task carries its category and its parent', () => {
    const tree = buildMissionTree([
      ev(1, 'mission.started', 'm-1', { objective: 'Root' }),
      ev(2, 'task.contracted', 't-a', { objective: 'A', category: 'research', parentTaskId: 'm-1' }),
    ]);

    expect(tree?.children[0]?.category).toBe('research');
    expect(tree?.children[0]?.parentTaskId).toBe('m-1');
  });

  it('AC-0: a task carries the sibling outputs it consumes', () => {
    const tree = buildMissionTree([
      ev(1, 'mission.started', 'm-1', { objective: 'Root' }),
      ev(2, 'task.contracted', 't-a', { objective: 'A', parentTaskId: 'm-1' }),
      ev(3, 'task.contracted', 't-b', { objective: 'B', parentTaskId: 'm-1', dependsOn: ['t-a'] }),
    ]);

    const b = tree?.children.find((c) => c.taskId === 't-b');
    expect(b?.dependsOn).toEqual(['t-a']);
  });

  it('AC-0: children nest under their parent rather than sitting in one flat row', () => {
    const tree = buildMissionTree([
      ev(1, 'mission.started', 'm-1', { objective: 'Root' }),
      ev(2, 'task.contracted', 't-a', { objective: 'A', parentTaskId: 'm-1' }),
      ev(3, 'task.contracted', 't-a1', { objective: 'A1', parentTaskId: 't-a' }),
    ]);

    expect(tree?.children).toHaveLength(1);
    expect(tree?.children[0]?.taskId).toBe('t-a');
    expect(tree?.children[0]?.children[0]?.taskId).toBe('t-a1');
  });

  it('DISTRACTOR: a task whose parent was never recorded still appears, at the root', () => {
    // Losing a task because its parent event is missing would make the canvas
    // quietly less complete than the ledger — the one thing it must never be.
    const tree = buildMissionTree([
      ev(1, 'mission.started', 'm-1', { objective: 'Root' }),
      ev(2, 'task.contracted', 't-orphan', { objective: 'Orphan', parentTaskId: 'nobody' }),
    ]);

    expect(tree?.children.map((c) => c.taskId)).toContain('t-orphan');
  });

  it('DISTRACTOR: a cycle in the recorded parents does not hang the projection', () => {
    // The ledger is append-only and written by a model-driven loop; a malformed
    // pair must degrade, not spin forever.
    const tree = buildMissionTree([
      ev(1, 'mission.started', 'm-1', { objective: 'Root' }),
      ev(2, 'task.contracted', 't-x', { objective: 'X', parentTaskId: 't-y' }),
      ev(3, 'task.contracted', 't-y', { objective: 'Y', parentTaskId: 't-x' }),
    ]);

    expect(tree).not.toBeNull();
    const ids = JSON.stringify(tree);
    expect(ids).toContain('t-x');
    expect(ids).toContain('t-y');
  });
});
