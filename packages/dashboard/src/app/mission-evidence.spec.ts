/**
 * What the mission actually did, beside what it produced (R40, R22 AC-1).
 *
 * The owner asked "would anyone be able to do anything real with the output?"
 * and the honest answer was no — but the reasons were all on the trail and
 * shown nowhere: the mission spent **2 of its 20 effort units**, used no tools,
 * consulted nothing, and declared three assumptions, one of which said it had
 * read the task as something other than what was asked.
 *
 * A deliverable without that context is a claim. With it, a reader can tell a
 * thin answer from a thorough one without opening the ledger explorer.
 */
import { buildMissionEvidence } from './mission-evidence';
import type { LedgerEventView } from './mission-tree';

const MISSION = 'm-1';
const ev = (seq: number, type: string, taskId: string | null, payload: Record<string, unknown> = {}): LedgerEventView =>
  ({ seq, eventId: `e-${seq}`, missionId: MISSION, taskId, family: 'execution', type, payload });

const TRAIL = [
  ev(1, 'mission.intake_accepted', MISSION, { contract: { budget: { ceiling: 20, unit: 'effort-units' } } }),
  ev(2, 'task.executed', MISSION, {
    effortSpent: 2,
    ceiling: 20,
    assumptions: ['This task requires creating algorithms rather than describing them.'],
    actions: [],
    consulted: [],
  }),
  ev(3, 'gate_b.verdict_issued', MISSION, { outcome: 'pass', findings: [], redFlags: [] }),
];

describe('buildMissionEvidence', () => {
  it('reports effort against the ceiling, so a thin answer is visible as thin', () => {
    const evidence = buildMissionEvidence(TRAIL);

    expect(evidence.effortSpent).toBe(2);
    expect(evidence.ceiling).toBe(20);
  });

  it('surfaces what the worker declared it assumed', () => {
    // R40's "verifiable by a stranger": a stranger cannot check work whose
    // premises stayed in the model's head. These were recorded and never shown.
    const evidence = buildMissionEvidence(TRAIL);

    expect(evidence.assumptions).toEqual([
      'This task requires creating algorithms rather than describing them.',
    ]);
  });

  it('reports the verdict, including that it passed with no findings', () => {
    const evidence = buildMissionEvidence(TRAIL);

    expect(evidence.verdict).toBe('pass');
    expect(evidence.findings).toEqual([]);
  });

  it('counts tools used and sources consulted — zero is a finding, not a blank', () => {
    // "Used no tools and consulted nothing" is exactly what distinguishes a
    // researched answer from a recalled one, and it is the kind of zero that
    // must be shown rather than left to look like missing data.
    const evidence = buildMissionEvidence(TRAIL);

    expect(evidence.toolsUsed).toBe(0);
    expect(evidence.sourcesConsulted).toBe(0);
  });

  it('DISTRACTOR: a CHILD task contributes its effort, and the mission totals it', () => {
    // A decomposed mission spends across tasks; reporting only the mission
    // task's own execution would report a fraction of the cost as the whole.
    const evidence = buildMissionEvidence([
      ev(1, 'mission.intake_accepted', MISSION, { contract: { budget: { ceiling: 40 } } }),
      ev(2, 'task.executed', 't-a', { effortSpent: 3, assumptions: ['a'], actions: [{}], consulted: [] }),
      ev(3, 'task.executed', 't-b', { effortSpent: 5, assumptions: ['b'], actions: [], consulted: [{}] }),
    ]);

    expect(evidence.effortSpent).toBe(8);
    expect(evidence.assumptions).toEqual(['a', 'b']);
    expect(evidence.toolsUsed).toBe(1);
    expect(evidence.sourcesConsulted).toBe(1);
  });

  it('DISTRACTOR: a retried task counts its LAST spend, not the sum of attempts', () => {
    // The same rule the inspector and the requester view already use. Summing
    // attempts would report a task that was retried as having cost double.
    const evidence = buildMissionEvidence([
      ev(1, 'mission.intake_accepted', MISSION, { contract: { budget: { ceiling: 40 } } }),
      ev(2, 'task.executed', 't-a', { effortSpent: 3 }),
      ev(3, 'task.executed', 't-a', { effortSpent: 7 }),
    ]);

    expect(evidence.effortSpent).toBe(7);
  });

  it('DISTRACTOR: a mission with no execution reports nothing rather than zeroes', () => {
    // Zeroes on a mission that never ran would read as "it did nothing",
    // which is a different claim from "it has not run yet".
    const evidence = buildMissionEvidence([ev(1, 'mission.started', MISSION, {})]);

    expect(evidence.ran).toBe(false);
  });
});
