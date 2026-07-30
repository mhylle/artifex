/**
 * R20 — time travel.
 *
 * "Reconstruct any past moment from the ledger."
 *
 * The whole feature rests on a property the cockpit already has: the dashboard
 * stores only the raw event list and derives everything else. So a past moment
 * is not a snapshot anyone has to take — it is the same list, truncated, fed
 * through the same projections. These tests pin that down, because the moment
 * anyone "optimises" time travel by storing snapshots, the dashboard acquires
 * the second source of truth invariant #1 exists to forbid.
 */
import { describe, expect, it } from 'vitest';

import { buildMissionTree } from './mission-tree';
import type { LedgerEventView } from './mission-tree';
import { diffMoments, eventsAsOf, momentsOf } from './time-travel';

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

/**
 * A trail with a real shape: two tasks, one of which fails and then passes on a
 * retry. The retry is the point — an improvement the operator should be able to
 * SHOW rather than assert.
 */
const trail = () => {
  seq = 0;
  return [
    ev('mission.started', MISSION, { objective: 'Root' }, 'contract', '2026-07-30T09:00:00.000Z'),
    ev('task.contracted', 't-a', {
      objective: 'Part A',
      acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'A is done' }],
    }, 'contract', '2026-07-30T09:00:01.000Z'),
    ev('agent.staffed', 't-a', { designId: 'analyst', version: 1, logicalTier: 1 }, 'staffing', '2026-07-30T09:00:03.000Z'),
    ev('task.executed', 't-a', { effortSpent: 2 }, 'execution', '2026-07-30T09:00:08.000Z'),
    ev('gate_b.verdict_issued', 't-a', {
      outcome: 'fail',
      findings: [{ criterionId: 'ac-1', detail: 'no citation' }],
    }, 'verification', '2026-07-30T09:00:09.000Z'),
    ev('escalation.rung_climbed', 't-a', { toTier: 2 }, 'escalation', '2026-07-30T09:00:10.000Z'),
    ev('task.contracted', 't-b', {
      objective: 'Part B',
      acceptanceCriteria: [{ criterionId: 'ac-2', statement: 'B is done' }],
    }, 'contract', '2026-07-30T09:00:11.000Z'),
    ev('task.executed', 't-a', { effortSpent: 5 }, 'execution', '2026-07-30T09:00:14.000Z'),
    ev('gate_b.verdict_issued', 't-a', { outcome: 'pass', findings: [] }, 'verification', '2026-07-30T09:00:15.000Z'),
  ];
};

describe('eventsAsOf', () => {
  it('keeps every event up to and including the cursor, and nothing after it', () => {
    const events = trail();
    const asOf = eventsAsOf(events, 5);

    expect(asOf.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('a null cursor means "now" — the whole trail, not an empty one', () => {
    const events = trail();

    // The distinction matters: `null` is "the operator is not time travelling",
    // and collapsing it to 0 would blank the cockpit the moment it loaded.
    expect(eventsAsOf(events, null)).toHaveLength(events.length);
  });

  it('reconstructs the past by RE-FOLDING, so a moment shows the status of that moment — not of now', () => {
    const events = trail();

    // At seq 5, task A has just been failed by Gate B. By seq 9 it has been
    // retried and passed. The same projection must give both answers.
    const past = buildMissionTree(eventsAsOf(events, 5))!;
    const now = buildMissionTree(eventsAsOf(events, null))!;

    expect(past.children[0]!.status).toBe('failed');
    expect(past.children[0]!.criteria[0]!.state).toBe('unmet');
    expect(past.children[0]!.criteria[0]!.detail).toBe('no citation');

    expect(now.children[0]!.status).toBe('verified');
    expect(now.children[0]!.criteria[0]!.state).toBe('met');
  });

  it('a task contracted after the cursor has not appeared yet', () => {
    const events = trail();

    // t-b is contracted at seq 7. Showing it at seq 5 would be the dashboard
    // inventing a task the ledger had not yet recorded.
    const past = buildMissionTree(eventsAsOf(events, 5))!;
    expect(past.children.map((c) => c.taskId)).toEqual(['t-a']);

    const later = buildMissionTree(eventsAsOf(events, 7))!;
    expect(later.children.map((c) => c.taskId)).toEqual(['t-a', 't-b']);
  });

  it('budgets read as they stood: effort spent is the figure of that moment, not the final one', () => {
    const events = trail();

    expect(buildMissionTree(eventsAsOf(events, 5))!.children[0]!.effortSpent).toBe(2);
    expect(buildMissionTree(eventsAsOf(events, null))!.children[0]!.effortSpent).toBe(5);
  });

  it('DISTRACTOR: a cursor beyond the last event is the present, not an error or an empty trail', () => {
    const events = trail();

    // The scrubber's right-hand end is the newest event, and a live mission
    // grows underneath it. Treating "past the end" as out of range would make
    // the handle fall off the track every time a new event arrived.
    expect(eventsAsOf(events, 9999)).toHaveLength(events.length);
  });

  it('DISTRACTOR: ordering is by seq, not by arrival — a trail delivered out of order truncates correctly', () => {
    const events = [...trail()].reverse();

    // The websocket delivers promptly, not in order. Slicing by array position
    // rather than by seq would silently show the WRONG moment — and it would
    // look plausible, which is worse.
    expect(eventsAsOf(events, 5).map((e) => e.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('momentsOf', () => {
  it('offers every recorded event as a stop, labelled with what happened', () => {
    const moments = momentsOf(trail());

    expect(moments).toHaveLength(9);
    expect(moments[0]).toMatchObject({ seq: 1, type: 'mission.started' });
    expect(moments[8]).toMatchObject({ seq: 9, type: 'gate_b.verdict_issued' });
  });

  it('carries the timestamp, so the scrubber can say WHEN and not only which event', () => {
    const moments = momentsOf(trail());

    expect(moments[4]!.occurredAt).toBe('2026-07-30T09:00:09.000Z');
  });

  it('DISTRACTOR: an empty trail offers no moments rather than a phantom "moment zero"', () => {
    expect(momentsOf([])).toEqual([]);
  });
});

describe('diffMoments', () => {
  it('names the tasks that appeared between the two moments', () => {
    const diff = diffMoments(trail(), 5, 9);

    expect(diff.appeared.map((t) => t.taskId)).toEqual(['t-b']);
    expect(diff.appeared[0]!.objective).toBe('Part B');
  });

  it('shows a status that changed, with both ends of the change', () => {
    const diff = diffMoments(trail(), 5, 9);

    expect(diff.changed).toEqual([
      expect.objectContaining({ taskId: 't-a', before: 'failed', after: 'verified' }),
    ]);
  });

  it('quantifies the change — this is how an improvement is demonstrated rather than asserted', () => {
    const diff = diffMoments(trail(), 5, 9);

    expect(diff.criteriaMet).toBe(1); // ac-1 went unmet -> met
    expect(diff.effortSpent).toBe(3); // 2 -> 5
    expect(diff.escalations).toBe(1); // the rung climbed at seq 6
    expect(diff.eventsBetween).toBe(4); // seqs 6,7,8,9
  });

  it('reads forward regardless of which handle the operator dragged first', () => {
    // Comparing B to A is the same comparison as A to B. Reporting effort as
    // -3 because the handles were dragged in the other order would read as a
    // regression that never happened.
    expect(diffMoments(trail(), 9, 5)).toEqual(diffMoments(trail(), 5, 9));
  });

  it('reports a task that existed at both moments and did not change as neither appeared nor changed', () => {
    const diff = diffMoments(trail(), 7, 8);

    expect(diff.appeared).toEqual([]);
    // t-a went staffed->executing at seq 8; t-b sat still and must not be listed.
    expect(diff.changed.map((t) => t.taskId)).toEqual(['t-a']);
  });

  it('DISTRACTOR: comparing a moment with itself is an empty diff, not a diff against the present', () => {
    const diff = diffMoments(trail(), 5, 5);

    // The easy wrong implementation compares `from` against the whole trail and
    // reports everything that ever happened — which would make the compare view
    // agree with itself only by accident.
    expect(diff.appeared).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.eventsBetween).toBe(0);
    expect(diff.effortSpent).toBe(0);
    expect(diff.criteriaMet).toBe(0);
  });

  it('DISTRACTOR: a criterion that went MET back to UNMET counts as a loss, not an absolute gain', () => {
    const events = [
      ev('mission.started', MISSION, { objective: 'Root' }, 'contract'),
      ev('task.contracted', 't-x', {
        objective: 'Fragile',
        acceptanceCriteria: [{ criterionId: 'ac-x', statement: 'X holds' }],
      }, 'contract'),
      ev('gate_b.verdict_issued', 't-x', { outcome: 'pass', findings: [] }, 'verification'),
      ev('gate_b.verdict_issued', 't-x', {
        outcome: 'fail',
        findings: [{ criterionId: 'ac-x', detail: 'regressed' }],
      }, 'verification'),
    ];
    const base = events[0]!.seq - 1;

    // Counting "criteria met at the later moment" instead of the DELTA would
    // report 0 here and look correct. Counting the delta reports -1, which is
    // the fact: the mission got worse between these two moments.
    const diff = diffMoments(events, base + 3, base + 4);
    expect(diff.criteriaMet).toBe(-1);
  });
});
