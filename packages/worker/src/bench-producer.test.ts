/**
 * The replay bench had no live producer (defect `c1b3ae71`).
 *
 * `bench.record` is called nowhere in production — verified by enumerating every
 * non-test reference across `packages/worker/src` and `packages/api/src`. The
 * two rows in the live sealed bench were written by scripts: one is a dogfood
 * stub whose whole contract is `{"o": "sealed case"}`, the other a real case
 * distilled by hand. So R25 AC-0's "when a benchmark set is built" has never
 * happened in the running system, and everything downstream starves — the
 * Reviewer's calibration probes (R35), the science loop's cases (R27), and the
 * sealed-bench evaluation R29 AC-0 needs.
 *
 * This bank the cases. The source is R25's own sentence: "every completed task
 * in the ledger — its contract, its inputs, its verified outcome — is a
 * potential benchmark." So a case is minted from a task whose Gate B PASSED,
 * carrying exactly those three things plus the verdict event that proves the
 * outcome was verified.
 *
 * **A failed task is never banked.** Its outcome is not ground truth, and
 * scoring a candidate against a wrong answer produces a number that looks like a
 * measurement — the same hazard `record()` already refuses evidence-free cases
 * for.
 *
 * ON THE OPEN/SEALED SPLIT, which is a CHOICE and not a derivation (ADR-0016):
 * nothing the system records can determine what fraction to reserve, so this
 * alternates within each capability — the first case banked for a capability is
 * sealed, the next open, and so on. That is deterministic and replayable, needs
 * no tuning, and guarantees the sealed slice covers every capability the swarm
 * actually works in, which is what a petition about a capability needs. It is
 * reversible: the slice is a column, and re-slicing is a migration, not a
 * redesign.
 */
import { describe, expect, it } from 'vitest';

import { casesFromTrail } from './bench-producer.js';

const AT = '2026-07-31T09:00:00.000Z';

const contractFor = (taskId: string) => ({
  taskId, missionId: 'm-1', category: 'answering', objective: 'Say three.',
  budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
});

let seq = 0;
const ev = (type: string, taskId: string | null, payload: Record<string, unknown>) => ({
  seq: (seq += 1), eventId: `e-${seq}`, missionId: 'm-1', taskId,
  family: 'execution', type, actor: { kind: 'worker', id: 'w', displayName: null },
  payload, occurredAt: AT,
});

/** One task that was contracted, executed, staffed and PASSED Gate B. */
const passingTask = (taskId: string, answer: string) => [
  ev('task.contracted', taskId, { contract: contractFor(taskId), category: 'answering' }),
  ev('agent.staffed', taskId, { designId: 'd-1', capability: 'answering' }),
  ev('task.executed', taskId, { deliverable: { answer }, effortSpent: 2 }),
  ev('gate_b.verdict_issued', taskId, { outcome: 'pass', findings: [] }),
];

describe('c1b3ae71 — verified tasks become replay bench cases', () => {
  it('banks a passing task with its contract, inputs and verified outcome', () => {
    const cases = casesFromTrail(passingTask('t-1', 'three') as never, { sealedSoFar: new Map() });

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      sourceTaskId: 't-1',
      sourceMissionId: 'm-1',
      capability: 'answering',
      verifiedOutcome: { answer: 'three' },
    });
    expect(cases[0]!.contract).toMatchObject({ taskId: 't-1' });
  });

  it('carries the verdict event as evidence, which the store REQUIRES', () => {
    // `record()` throws on an empty evidence array — "unverified ground truth is
    // a guess". A producer that banked cases with no evidence would fail at the
    // database and take the mission's post-processing down with it.
    const cases = casesFromTrail(passingTask('t-1', 'three') as never, { sealedSoFar: new Map() });

    expect(cases[0]!.evidence.length).toBeGreaterThan(0);
  });

  it('DISTRACTOR: a task whose Gate B FAILED is never banked', () => {
    // The whole point of ground truth. A failed deliverable is a wrong answer,
    // and banking it would score every future candidate against a mistake.
    const trail = [
      ev('task.contracted', 't-1', { contract: contractFor('t-1'), category: 'answering' }),
      ev('agent.staffed', 't-1', { designId: 'd-1', capability: 'answering' }),
      ev('task.executed', 't-1', { deliverable: { answer: 'four' }, effortSpent: 2 }),
      ev('gate_b.verdict_issued', 't-1', { outcome: 'fail', findings: [{ errorClass: 'wrong' }] }),
    ];

    expect(casesFromTrail(trail as never, { sealedSoFar: new Map() })).toEqual([]);
  });

  it('DISTRACTOR: a task that passed but produced NO deliverable is not banked', () => {
    // There is no verified outcome to score against, so a case would carry an
    // empty ground truth that every candidate trivially matches or trivially
    // fails.
    const trail = [
      ev('task.contracted', 't-1', { contract: contractFor('t-1'), category: 'answering' }),
      ev('gate_b.verdict_issued', 't-1', { outcome: 'pass', findings: [] }),
    ];

    expect(casesFromTrail(trail as never, { sealedSoFar: new Map() })).toEqual([]);
  });

  it('alternates the slice WITHIN a capability, starting sealed', () => {
    // ADR-0016. Deterministic and replayable, and it guarantees the sealed slice
    // covers every capability the swarm works in.
    const first = casesFromTrail(passingTask('t-1', 'three') as never, { sealedSoFar: new Map() });
    expect(first[0]!.slice).toBe('sealed');

    const second = casesFromTrail(passingTask('t-2', 'four') as never, {
      sealedSoFar: new Map([['answering', 1]]),
    });
    expect(second[0]!.slice).toBe('open');
  });

  it('alternates INDEPENDENTLY per capability, so one busy capability cannot starve another', () => {
    // Keyed on the capability, not a global counter. A global one would let a
    // high-volume capability decide the slice of every other capability's next
    // case, and the sealed bench would drift to covering only the busy ones.
    const trail = [
      ...passingTask('t-1', 'three'),
      ev('task.contracted', 't-2', { contract: contractFor('t-2'), category: 'summarising' }),
      ev('agent.staffed', 't-2', { designId: 'd-2', capability: 'summarising' }),
      ev('task.executed', 't-2', { deliverable: { answer: 'x' }, effortSpent: 2 }),
      ev('gate_b.verdict_issued', 't-2', { outcome: 'pass', findings: [] }),
    ];

    // FIXTURE NOTE: this first used `answering: 1`, and a mutant that summed a
    // GLOBAL counter instead of keying per capability still passed — with one
    // case banked, the global total happened to produce the same two slices. The
    // counts here are chosen so the two rules DISAGREE: `answering` at 2 and
    // `summarising` at 0 are both even, so per-capability seals both, while a
    // global counter (total 2, then 3) would give sealed then open.
    const cases = casesFromTrail(trail as never, {
      sealedSoFar: new Map([['answering', 2], ['summarising', 0]]),
    });

    expect(cases.find((c) => c.capability === 'answering')!.slice).toBe('sealed');
    expect(cases.find((c) => c.capability === 'summarising')!.slice).toBe('sealed');
  });

  it('alternates WITHIN one trail, not just across missions', () => {
    // Two passing tasks of the same capability in one mission must not both be
    // sealed — the counter has to advance as the trail is walked, or a mission
    // with ten tasks seals all ten.
    const trail = [...passingTask('t-1', 'three'), ...passingTask('t-2', 'four')];

    const slices = casesFromTrail(trail as never, { sealedSoFar: new Map() }).map((c) => c.slice);

    expect(slices).toEqual(['sealed', 'open']);
  });

  it('uses the RESOLVED capability, not the planner raw category', () => {
    // The same lesson as `340aa7de`: bucketing on the planner's phrasing
    // re-splits what staffing merged, and a bench keyed on raw names would never
    // match the category a petition argues about.
    const trail = [
      ev('task.contracted', 't-1', { contract: contractFor('t-1'), category: 'Answering Questions' }),
      ev('agent.staffed', 't-1', { designId: 'd-1', capability: 'answering' }),
      ev('task.executed', 't-1', { deliverable: { answer: 'three' }, effortSpent: 2 }),
      ev('gate_b.verdict_issued', 't-1', { outcome: 'pass', findings: [] }),
    ];

    expect(casesFromTrail(trail as never, { sealedSoFar: new Map() })[0]!.capability).toBe('answering');
  });
});
