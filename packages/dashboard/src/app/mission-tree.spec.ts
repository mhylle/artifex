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

  it('shows a KEPT-WHOLE mission as delivered — it never folds (defect dd2e9d18)', () => {
    // `mission.delivered` exists precisely because a mission the
    // decompose-or-delegate gate keeps whole never folds (R37 AC-0). This
    // projection only knew `mission.folded`, so a kept-whole mission read
    // "running" forever. Seen live: the rail said DELIVERED and this header
    // said SURRENDERED for the same mission, on the same screen.
    const kept = [
      ev(1, 'mission.started', MISSION, { objective: 'Kept whole' }),
      ev(2, 'task.executed', MISSION, {}),
      ev(3, 'mission.delivered', MISSION, {}),
    ];

    expect(buildMissionTree(kept)?.status).toBe('delivered');
  });

  it('shows a mission that surrendered and was then resumed to delivery as delivered', () => {
    // R41 made this ordinary: block, answer, resume, deliver. The LAST outcome
    // is the true one — and the blockers the surrender recorded are no longer
    // blocking anything.
    const resumed = [
      ev(1, 'mission.started', MISSION, { objective: 'Answered' }),
      ev(2, 'mission.surrendered', MISSION, { blockers: ['the intake dialogue has unanswered questions'] }),
      ev(3, 'operator.decided', MISSION, { decision: 'approve' }),
      ev(4, 'mission.delivered', MISSION, {}),
    ];

    const tree = buildMissionTree(resumed);
    expect(tree?.status).toBe('delivered');
    expect(tree?.blockers, 'a delivered mission still showed the blockers it got past').toEqual([]);
  });

  it('shows a swept mission as abandoned (defect dd2e9d18)', () => {
    // Nothing writes an event when a worker dies, so the startup sweep appends
    // one. A projection that ignored it would keep the detail header saying
    // "running" while the rail said "abandoned" — the same contradiction this
    // defect already produced once.
    const swept = [
      ev(1, 'mission.started', MISSION, { objective: 'Killed mid-flight' }),
      ev(2, 'mission.abandoned', MISSION, { reason: 'no job on the queue at worker startup' }),
    ];

    expect(buildMissionTree(swept)?.status).toBe('abandoned');
  });

  it('shows an abandoned mission that RAN AGAIN as running — the sweep is self-correcting', () => {
    // The property the sweep's safety rests on: a mistaken abandonment is
    // temporary, because the mission records `mission.started` when it runs and
    // the last status-bearing event decides.
    const revived = [
      ev(1, 'mission.started', MISSION, { objective: 'Back from the dead' }),
      ev(2, 'mission.abandoned', MISSION, {}),
      ev(3, 'mission.started', MISSION, { objective: 'Back from the dead' }),
    ];

    expect(buildMissionTree(revived)?.status).toBe('running');
  });

  it('DISTRACTOR: a mission that delivered and THEN surrendered reads surrendered', () => {
    // The other side of the discriminator. A rule that simply preferred the
    // cheerier of two flags would report a delivery the mission took back.
    const takenBack = [
      ev(1, 'mission.started', MISSION, { objective: 'Both' }),
      ev(2, 'mission.delivered', MISSION, {}),
      ev(3, 'mission.surrendered', MISSION, { blockers: ['ran out of budget'] }),
    ];

    const tree = buildMissionTree(takenBack);
    expect(tree?.status).toBe('surrendered');
    expect(tree?.blockers, 'CONTROL: the surrender recorded no blockers, so the order was not tested').toEqual([
      'ran out of budget',
    ]);
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

/**
 * R16 — the inspector's data. Every field is derived from the ledger; a fact
 * with no event behind it does not belong on screen.
 */
describe('R16 — the projection carries what the inspector shows', () => {
  const ev = (seq: number, type: string, taskId: string | null, payload: Record<string, unknown> = {}) =>
    ({ seq, eventId: `e-${seq}`, missionId: 'm-1', taskId, family: 'contract', type, payload });

  const withTask = (extra: ReturnType<typeof ev>[] = []) => buildMissionTree([
    ev(1, 'mission.started', 'm-1', { objective: 'Root' }),
    ev(2, 'task.contracted', 't-a', {
      objective: 'A', parentTaskId: 'm-1', ceiling: 10,
      acceptanceCriteria: [
        { criterionId: 'ac-1', statement: 'First thing.' },
        { criterionId: 'ac-2', statement: 'Second thing.' },
      ],
    }),
    ...extra,
  ])?.children[0];

  it('AC-0: carries the acceptance criteria, the agent and the effort against budget', () => {
    const task = withTask([
      ev(3, 'agent.staffed', 't-a', { designId: 'analyst.v7', version: 7, logicalTier: 2 }),
      ev(4, 'task.executed', 't-a', { effortSpent: 3, ceiling: 10 }),
    ]);

    expect(task?.criteria.map((c) => c.statement)).toEqual(['First thing.', 'Second thing.']);
    expect(task?.designId).toBe('analyst.v7');
    expect(task?.designVersion).toBe(7);
    expect(task?.effortSpent).toBe(3);
    expect(task?.ceiling).toBe(10);
  });

  it('AC-1: a passing Gate B verdict marks every criterion met', () => {
    const task = withTask([
      ev(3, 'gate_b.verdict_issued', 't-a', { outcome: 'pass', findings: [] }),
    ]);

    expect(task?.criteria.map((c) => c.state)).toEqual(['met', 'met']);
  });

  it('AC-1: a failing verdict marks only the criteria it named', () => {
    const task = withTask([
      ev(3, 'gate_b.verdict_issued', 't-a', {
        outcome: 'fail',
        findings: [{ criterionId: 'ac-2', detail: 'no citation', errorClass: 'incomplete' }],
      }),
    ]);

    expect(task?.criteria.find((c) => c.criterionId === 'ac-2')?.state).toBe('unmet');
    expect(task?.criteria.find((c) => c.criterionId === 'ac-1')?.state).toBe('met');
  });

  it('DISTRACTOR: before any verdict a criterion is UNKNOWN, not failed', () => {
    // "Not yet judged" and "judged and failed" are different facts. Showing the
    // first as the second would be the dashboard inventing a verdict.
    const task = withTask();

    expect(task?.criteria.map((c) => c.state)).toEqual(['unknown', 'unknown']);
  });

  it('DISTRACTOR: the LAST verdict wins, so a retry that passes clears an earlier failure', () => {
    // Status is the last verdict, never an accumulated flag — otherwise a task
    // that recovered would still show its old failure.
    const task = withTask([
      ev(3, 'gate_b.verdict_issued', 't-a', {
        outcome: 'fail',
        findings: [{ criterionId: 'ac-1', detail: 'missing', errorClass: 'incomplete' }],
      }),
      ev(4, 'gate_b.verdict_issued', 't-a', { outcome: 'pass', findings: [] }),
    ]);

    expect(task?.criteria.map((c) => c.state)).toEqual(['met', 'met']);
  });

  it('AC-2: the events for this task are reachable from the node', () => {
    const task = withTask([
      ev(3, 'agent.staffed', 't-a', { designId: 'analyst.v7', version: 7, logicalTier: 2 }),
    ]);

    expect(task?.events.map((e) => e.type)).toEqual(['task.contracted', 'agent.staffed']);
  });

  it('DISTRACTOR: a node carries only ITS events, not the whole mission trail', () => {
    const tree = buildMissionTree([
      ev(1, 'mission.started', 'm-1', { objective: 'Root' }),
      ev(2, 'task.contracted', 't-a', { objective: 'A', parentTaskId: 'm-1', acceptanceCriteria: [] }),
      ev(3, 'task.contracted', 't-b', { objective: 'B', parentTaskId: 'm-1', acceptanceCriteria: [] }),
      ev(4, 'agent.staffed', 't-b', { designId: 'other', version: 1, logicalTier: 1 }),
    ]);

    const a = tree?.children.find((c) => c.taskId === 't-a');
    expect(a?.events.every((e) => e.taskId === 't-a')).toBe(true);
    expect(a?.events).toHaveLength(1);
  });
});
