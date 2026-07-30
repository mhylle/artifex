/**
 * R19 — the four remaining lenses.
 *
 * "One dashboard, five ways of looking at the same ledger — switchable per
 * mission, shareable as links, **identical truth underneath**."
 *
 * That last clause is the design constraint, and it is why every lens here is a
 * pure function of the same event list rather than its own query. Two lenses
 * cannot disagree if neither has its own source.
 */
import { describe, expect, it } from 'vitest';

import { buildLedgerView, buildLearningView, buildTimeline, buildWorkforce } from './lenses';
import type { LedgerEventView } from './mission-tree';

const MISSION = 'm-1';
let seq = 0;
const ev = (
  type: string,
  taskId: string | null,
  payload: Record<string, unknown> = {},
  family = 'execution',
  occurredAt = '2026-07-30T09:00:00.000Z',
): LedgerEventView & { occurredAt: string } =>
  ({ seq: (seq += 1), eventId: `e-${seq}`, missionId: MISSION, taskId, family, type, payload, occurredAt });

const trail = () => {
  seq = 0;
  return [
    ev('mission.started', MISSION, { objective: 'Root' }, 'contract', '2026-07-30T09:00:00.000Z'),
    ev('task.contracted', 't-a', { objective: 'Part A', category: 'research' }, 'contract', '2026-07-30T09:00:01.000Z'),
    ev('task.contracted', 't-b', { objective: 'Part B', category: 'writing' }, 'contract', '2026-07-30T09:00:02.000Z'),
    ev('agent.staffed', 't-a', { designId: 'analyst', version: 3, logicalTier: 2 }, 'staffing', '2026-07-30T09:00:03.000Z'),
    ev('task.executed', 't-a', { effortSpent: 2 }, 'execution', '2026-07-30T09:00:08.000Z'),
    ev('gate_b.verdict_issued', 't-a', { outcome: 'pass', findings: [] }, 'verification', '2026-07-30T09:00:09.000Z'),
    ev('agent.staffed', 't-b', { designId: 'writer', version: 1, logicalTier: 1 }, 'staffing', '2026-07-30T09:00:10.000Z'),
    ev('task.executed', 't-b', { effortSpent: 1 }, 'execution', '2026-07-30T09:00:12.000Z'),
    ev('gate_b.verdict_issued', 't-b', {
      outcome: 'fail',
      findings: [{ criterionId: 'ac-1', detail: 'no citation', errorClass: 'incomplete' }],
    }, 'verification', '2026-07-30T09:00:13.000Z'),
  ];
};

describe('R19 — workforce lens', () => {
  it('lists every staffed specialist with its design, version, tier and held task', () => {
    const agents = buildWorkforce(trail());

    const analyst = agents.find((a) => a.designId === 'analyst');
    expect(analyst?.version).toBe(3);
    expect(analyst?.logicalTier).toBe(2);
    expect(analyst?.taskId).toBe('t-a');
    expect(analyst?.category).toBe('research');
  });

  it('derives a live compliance rate from that agent\'s own verdicts', () => {
    const agents = buildWorkforce(trail());

    // analyst passed its one verdict; writer failed its one.
    expect(agents.find((a) => a.designId === 'analyst')?.complianceRate).toBe(1);
    expect(agents.find((a) => a.designId === 'writer')?.complianceRate).toBe(0);
  });

  it('reports how long the agent has been on its task', () => {
    const agents = buildWorkforce(trail());

    // staffed 09:00:03, last event for t-a at 09:00:09 -> 6 seconds.
    expect(agents.find((a) => a.designId === 'analyst')?.runtimeSeconds).toBe(6);
  });

  it('DISTRACTOR: an agent with no verdict yet has an UNKNOWN rate, not 0%', () => {
    // Reporting "0% compliant" for an agent nobody has judged would defame it
    // with a number the ledger never supported.
    const partial = trail().slice(0, 4);

    expect(buildWorkforce(partial)[0]?.complianceRate).toBeNull();
  });

  it('DISTRACTOR: two agents on different tasks are not merged into one', () => {
    const agents = buildWorkforce(trail());

    expect(agents).toHaveLength(2);
    expect(new Set(agents.map((a) => a.taskId)).size).toBe(2);
  });
});

describe('R19 — timeline lens', () => {
  it('gives each task a lane of its events in time order', () => {
    const lanes = buildTimeline(trail());

    const laneA = lanes.find((l) => l.taskId === 't-a');
    expect(laneA?.entries.map((e) => e.type)).toEqual([
      'task.contracted', 'agent.staffed', 'task.executed', 'gate_b.verdict_issued',
    ]);
  });

  it('exposes the wait before a task started, which is where stalls show up', () => {
    const lanes = buildTimeline(trail());

    // t-b was contracted at 09:00:02 and not staffed until 09:00:10.
    expect(lanes.find((l) => l.taskId === 't-b')?.waitedSeconds).toBe(8);
  });

  it('DISTRACTOR: lanes carry only their own task\'s events', () => {
    const lanes = buildTimeline(trail());

    for (const lane of lanes) {
      expect(lane.entries.every((e) => e.taskId === lane.taskId)).toBe(true);
    }
  });

  it('DISTRACTOR: a task never staffed reports no runtime rather than a negative one', () => {
    const lanes = buildTimeline(trail().slice(0, 3));

    expect(lanes.every((l) => (l.ranSeconds ?? 0) >= 0)).toBe(true);
  });
});

describe('R19 — ledger explorer lens', () => {
  it('returns the raw trail when nothing is filtered', () => {
    expect(buildLedgerView(trail(), {})).toHaveLength(9);
  });

  it('filters by event family', () => {
    const rows = buildLedgerView(trail(), { family: 'verification' });

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.family === 'verification')).toBe(true);
  });

  it('filters by error class, which is how an investigation starts', () => {
    const rows = buildLedgerView(trail(), { errorClass: 'incomplete' });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.taskId).toBe('t-b');
  });

  it('filters by agent, so "what did this specialist do" is one query', () => {
    const rows = buildLedgerView(trail(), { agent: 'analyst' });

    expect(rows.every((r) => r.taskId === 't-a')).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('filters by criterion', () => {
    const rows = buildLedgerView(trail(), { criterionId: 'ac-1' });

    expect(rows).toHaveLength(1);
  });

  it('DISTRACTOR: filters COMBINE rather than replace one another', () => {
    // Two filters that each match must narrow to their intersection; treating
    // the last one as the only one would quietly widen every investigation.
    const rows = buildLedgerView(trail(), { family: 'verification', errorClass: 'incomplete' });

    expect(rows).toHaveLength(1);
  });

  it('DISTRACTOR: an unmatched filter yields nothing, not everything', () => {
    expect(buildLedgerView(trail(), { errorClass: 'no-such-class' })).toHaveLength(0);
  });
});

describe('R19 — learning observatory lens', () => {
  it('reports honestly that there is nothing to show when the loops have not run', () => {
    // R26/R27 are unbuilt, so this lens has no experiments to display. Saying so
    // is the correct rendering; inventing content would be the dashboard
    // asserting something the ledger cannot justify.
    const view = buildLearningView(trail());

    expect(view.experiments).toEqual([]);
    expect(view.adoptions).toEqual([]);
    expect(view.petitions).toEqual([]);
  });

  it('surfaces learning-family events when they exist', () => {
    const withLearning = [
      ...trail(),
      ev('learning.experiment_started', null, { hypothesis: 'shorter prompts', metric: 'gate_b pass rate' }, 'learning'),
      ev('learning.adopted', null, { change: 'shorter prompts' }, 'learning'),
    ];

    const view = buildLearningView(withLearning);

    expect(view.experiments).toHaveLength(1);
    expect(view.adoptions).toHaveLength(1);
  });

  it('DISTRACTOR: an amendment petition is listed as a PROPOSAL, never as applied', () => {
    // Invariant #4: the learner proposes, it never ratifies. A lens that showed
    // a petition as a change would misrepresent the constitution.
    const withPetition = [
      ...trail(),
      ev('learning.amendment_petitioned', null, { target: 'reviewer rubric' }, 'learning'),
    ];

    const view = buildLearningView(withPetition);

    expect(view.petitions).toHaveLength(1);
    expect(view.adoptions).toHaveLength(0);
  });
});

describe('R19 AC-4 DISTRACTOR — the lenses agree, because they share one source', () => {
  it('the workforce lens counts exactly the agents the trail staffed', () => {
    const events = trail();
    const staffed = events.filter((e) => e.type === 'agent.staffed').length;

    expect(buildWorkforce(events)).toHaveLength(staffed);
  });

  it('the timeline covers exactly the tasks the trail contracted', () => {
    const events = trail();
    const contracted = new Set(events.filter((e) => e.type === 'task.contracted').map((e) => e.taskId));

    expect(new Set(buildTimeline(events).map((l) => l.taskId))).toEqual(contracted);
  });

  it('the unfiltered explorer holds every event the other lenses drew from', () => {
    const events = trail();

    expect(buildLedgerView(events, {})).toHaveLength(events.length);
  });
});
