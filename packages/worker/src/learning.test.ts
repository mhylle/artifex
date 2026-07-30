/**
 * P11 — the Learning seam (R11).
 *
 * Both acceptance criteria are about what the learner *cannot* do, so these
 * tests have to prove absence rather than presence. Invariant #4 — the learner
 * does not own the yardstick — is the one guarantee that, if it silently eroded,
 * would make every other measurement in the system meaningless.
 */
import type { LedgerEvent } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { CONSTITUTIONAL_CORE, ProposalEmitter } from './proposal-emitter.js';
import { LearningProjection } from './learning-projection.js';

const MISSION = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';
const AT = '2026-07-30T09:00:00.000Z';

function ev(seq: number, family: string, type: string, payload: Record<string, unknown> = {}): LedgerEvent {
  return {
    seq, eventId: `e-${seq}`, missionId: MISSION, taskId: `t-${seq}`,
    family: family as LedgerEvent['family'], type,
    actor: { kind: 'worker', id: 'w', displayName: null },
    payload, occurredAt: AT, recordedAt: AT,
  };
}

const TRAIL: LedgerEvent[] = [
  ev(1, 'contract', 'mission.started'),
  ev(2, 'staffing', 'agent.staffed', { designId: 'd-1', logicalTier: 1, category: 'research' }),
  ev(3, 'verification', 'gate_b.verdict_issued', { outcome: 'fail', gate: 'B', findings: [{ errorClass: 'execution_error' }] }),
  ev(4, 'escalation', 'escalation.rung_climbed', { rung: 'retry_higher_tier', fromTier: 1, toTier: 2 }),
  ev(5, 'staffing', 'agent.staffed', { designId: 'd-1', logicalTier: 2, category: 'research' }),
  ev(6, 'verification', 'gate_b.verdict_issued', { outcome: 'pass', gate: 'B', findings: [] }),
];

/** A reader that ALSO exposes append — so "read-only" has to be behavioural, not typed away. */
function spyReader() {
  const appended: unknown[] = [];
  return {
    appended,
    async replay() { return TRAIL; },
    async append(e: unknown) { appended.push(e); return e; },
  };
}

describe('R11 AC-1 — the projection is read-only', () => {
  it('computes real metrics from the ledger', async () => {
    const projection = new LearningProjection(spyReader());

    const report = await projection.project(MISSION);

    expect(report.gateBAttempts).toBe(2);
    expect(report.gateBPasses).toBe(1);
    expect(report.escalations).toBe(1);
    expect(report.tierBumps).toBe(1);
  });

  it('DISTRACTOR: it never writes, even when handed something that CAN write', async () => {
    // Typing the dependency as a reader is not proof — a projection could still
    // reach through. This asserts the behaviour: given append, it stays unused.
    const reader = spyReader();
    const projection = new LearningProjection(reader);

    await projection.project(MISSION);

    expect(reader.appended).toHaveLength(0);
  });

  it('DISTRACTOR: the projection exposes no write method at all', () => {
    const projection = new LearningProjection(spyReader()) as unknown as Record<string, unknown>;

    for (const forbidden of ['append', 'write', 'emit', 'save']) {
      expect(typeof projection[forbidden]).not.toBe('function');
    }
  });

  it('surfaces per-design performance, which is what the ratchet needs', async () => {
    const report = await new LearningProjection(spyReader()).project(MISSION);

    expect(report.byDesign['d-1']).toMatchObject({ staffings: 2 });
  });
});

describe('R11 AC-2 — the emitter proposes; it cannot amend', () => {
  it('records a proposal as a learning-family ledger event', async () => {
    const sink = spyReader();
    const emitter = new ProposalEmitter(sink, { newId: () => 'p-1', now: () => AT });

    const event = await emitter.propose({
      missionId: MISSION,
      title: 'Raise the tier for root decomposition',
      rationale: 'Small models run away on nested schemas.',
      evidenceEventIds: ['e-3'],
    });

    expect(event.family).toBe('learning');
    expect(event.type).toBe('learning.proposal_emitted');
    expect(sink.appended).toHaveLength(1);
  });

  it('DISTRACTOR: the proposal does NOT mutate the constitutional core', async () => {
    const before = JSON.stringify(CONSTITUTIONAL_CORE);
    const emitter = new ProposalEmitter(spyReader(), { newId: () => 'p-1', now: () => AT });

    await emitter.propose({
      missionId: MISSION,
      title: 'Let the learner set its own metrics',
      rationale: 'It would be faster.',
      evidenceEventIds: [],
      // A proposal may TARGET the core — that is the whole point of an
      // amendment protocol — but emitting it must change nothing.
      targets: 'constitution',
    });

    expect(JSON.stringify(CONSTITUTIONAL_CORE)).toBe(before);
  });

  it('DISTRACTOR: the constitutional core is frozen — it cannot be written at all', () => {
    // Not "we promise not to": the object refuses. A learner that could edit the
    // yardstick would make every measurement in the system unfalsifiable.
    expect(Object.isFrozen(CONSTITUTIONAL_CORE)).toBe(true);
    expect(() => {
      (CONSTITUTIONAL_CORE as unknown as Record<string, unknown>)['reviewIndependence'] = false;
    }).toThrow();
  });

  it('DISTRACTOR: the emitter exposes no amend/apply path', () => {
    const emitter = new ProposalEmitter(spyReader(), { newId: () => 'p-1', now: () => AT }) as unknown as Record<string, unknown>;

    for (const forbidden of ['amend', 'apply', 'mutate', 'adopt']) {
      expect(typeof emitter[forbidden]).not.toBe('function');
    }
  });

  it('a proposal carries its evidence, so it can be argued with', async () => {
    const sink = spyReader();
    const emitter = new ProposalEmitter(sink, { newId: () => 'p-1', now: () => AT });

    await emitter.propose({
      missionId: MISSION, title: 'x', rationale: 'y', evidenceEventIds: ['e-3', 'e-4'],
    });

    const payload = (sink.appended[0] as { payload: { evidenceEventIds: string[] } }).payload;
    expect(payload.evidenceEventIds).toEqual(['e-3', 'e-4']);
  });

  it('DISTRACTOR: a proposal with no rationale is refused — an unargued proposal is noise', async () => {
    const emitter = new ProposalEmitter(spyReader(), { newId: () => 'p-1', now: () => AT });

    await expect(
      emitter.propose({ missionId: MISSION, title: 'do better', rationale: '', evidenceEventIds: [] }),
    ).rejects.toThrow(/rationale/i);
  });
});
