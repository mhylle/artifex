/**
 * R27 AC-0's missing upstream — evidence assembled from the real ledger.
 *
 * `ScienceLoop.mine` was correct and had nothing to mine. The criterion says
 * "given a completed mission HISTORY", which is cross-mission, and the worker's
 * only reader was `replay({missionId})`.
 *
 * No new query was needed: `listMissions()` already enumerates every mission
 * with its status and escalation count (it backs the fleet rail), and `replay`
 * fills in the per-task detail. This is the fold between them.
 *
 * **No invented window.** The history is every mission that has FINISHED —
 * a running mission has no verdict yet, so it carries no evidence. Picking "the
 * last N" would be a constant nobody measured; the ledger already knows which
 * missions are over.
 */
import { describe, expect, it } from 'vitest';

import { LedgerEvidenceSource } from './ledger-evidence.js';
import type { MissionIndex, MissionReader } from './ledger-evidence.js';

const AT = '2026-07-31T09:00:00.000Z';

const ev = (missionId: string, taskId: string | null, type: string, payload: Record<string, unknown>) => ({
  eventId: `${missionId}-${type}-${Math.random().toString(16).slice(2, 8)}`,
  missionId, taskId, family: 'execution' as const, type,
  actor: { kind: 'orchestrator' as const, id: 'orchestrator', displayName: null },
  payload, occurredAt: AT,
});

function sources(
  missions: Array<{ missionId: string; status: 'running' | 'delivered' | 'surrendered' | 'abandoned'; escalations: number }>,
  trails: Record<string, ReturnType<typeof ev>[]>,
): { index: MissionIndex; reader: MissionReader } {
  return {
    index: { async listMissions() { return missions; } },
    reader: { async replay({ missionId }) { return trails[missionId] ?? []; } },
  };
}

describe('R27 AC-0 — evidence is assembled from the real ledger', () => {
  it('produces one evidence row per CATEGORY, which is what the ranker aggregates on', async () => {
    const { index, reader } = sources(
      [{ missionId: 'm-1', status: 'delivered', escalations: 0 }],
      {
        'm-1': [
          ev('m-1', 't-1', 'task.contracted', { category: 'writing', contract: { budget: { ceiling: 10 } } }),
          ev('m-1', 't-1', 'gate_b.verdict_issued', { outcome: 'pass' }),
          ev('m-1', 't-2', 'task.contracted', { category: 'research', contract: { budget: { ceiling: 10 } } }),
          ev('m-1', 't-2', 'gate_b.verdict_issued', { outcome: 'fail' }),
        ],
      },
    );

    const evidence = await new LedgerEvidenceSource(index, reader).evidenceFor(['m-1']);

    expect(evidence.map((e) => e.category).sort()).toEqual(['research', 'writing']);
  });

  it('counts Gate B attempts and passes per category', async () => {
    const { index, reader } = sources(
      [{ missionId: 'm-1', status: 'delivered', escalations: 0 }],
      {
        'm-1': [
          ev('m-1', 't-1', 'task.contracted', { category: 'writing', contract: { budget: { ceiling: 10 } } }),
          ev('m-1', 't-1', 'gate_b.verdict_issued', { outcome: 'fail' }),
          ev('m-1', 't-1', 'gate_b.verdict_issued', { outcome: 'pass' }),
        ],
      },
    );

    const [writing] = await new LedgerEvidenceSource(index, reader).evidenceFor(['m-1']);

    expect(writing?.gateBAttempts).toBe(2);
    expect(writing?.gateBPasses).toBe(1);
  });

  it('carries budget spent and the ceiling, so budget outliers can be ranked', async () => {
    const { index, reader } = sources(
      [{ missionId: 'm-1', status: 'delivered', escalations: 0 }],
      {
        'm-1': [
          ev('m-1', 't-1', 'task.contracted', { category: 'writing', contract: { budget: { ceiling: 20 } } }),
          ev('m-1', 't-1', 'task.executed', { deliverable: {}, effortSpent: 7 }),
          ev('m-1', 't-1', 'gate_b.verdict_issued', { outcome: 'pass' }),
        ],
      },
    );

    const [writing] = await new LedgerEvidenceSource(index, reader).evidenceFor(['m-1']);

    expect(writing?.budgetSpent).toBe(7);
    expect(writing?.budgetCeiling).toBe(20);
  });

  it('marks a SURRENDERED mission, which the ranker weights highest', async () => {
    const { index, reader } = sources(
      [{ missionId: 'm-1', status: 'surrendered', escalations: 3 }],
      {
        'm-1': [
          ev('m-1', 't-1', 'task.contracted', { category: 'writing', contract: { budget: { ceiling: 10 } } }),
          ev('m-1', 't-1', 'gate_b.verdict_issued', { outcome: 'fail' }),
        ],
      },
    );

    const [writing] = await new LedgerEvidenceSource(index, reader).evidenceFor(['m-1']);

    expect(writing?.surrendered).toBe(true);
  });

  it('DISTRACTOR: a RUNNING mission contributes nothing — it has no outcome yet', async () => {
    // Counting an unfinished mission's partial verdicts would make a category
    // look weak simply because its work is still in progress.
    const { index, reader } = sources(
      [{ missionId: 'm-1', status: 'running', escalations: 0 }],
      {
        'm-1': [
          ev('m-1', 't-1', 'task.contracted', { category: 'writing', contract: { budget: { ceiling: 10 } } }),
          ev('m-1', 't-1', 'gate_b.verdict_issued', { outcome: 'fail' }),
        ],
      },
    );

    expect(await new LedgerEvidenceSource(index, reader).evidenceFor(['m-1'])).toEqual([]);
  });

  it('DISTRACTOR: an ABANDONED mission contributes nothing — its death judges nothing', async () => {
    // A mission the startup sweep recorded as abandoned (defect `dd2e9d18`) died
    // because a worker process was killed, not because the work was bad. Its
    // partial verdicts are evidence about infrastructure, and feeding them to
    // the learner would let a crashed container be recorded as a weak spot in a
    // capability — the measurement tool lying about what it measured.
    const { index, reader } = sources(
      [{ missionId: 'm-1', status: 'abandoned', escalations: 0 }],
      {
        'm-1': [
          ev('m-1', 't-1', 'task.contracted', { category: 'writing', contract: { budget: { ceiling: 10 } } }),
          ev('m-1', 't-1', 'gate_b.verdict_issued', { outcome: 'fail' }),
        ],
      },
    );

    expect(await new LedgerEvidenceSource(index, reader).evidenceFor(['m-1'])).toEqual([]);
  });

  it('DISTRACTOR: a mission with no contracted tasks yields no evidence, not an empty category', async () => {
    // A mission that surrendered at Gate A has no task categories at all.
    // Emitting an entry keyed on "" would create a phantom category that the
    // ranker could then rank.
    const { index, reader } = sources(
      [{ missionId: 'm-1', status: 'surrendered', escalations: 0 }],
      { 'm-1': [ev('m-1', 'm-1', 'mission.surrendered', { reason: 'Gate A rejected the decomposition' })] },
    );

    expect(await new LedgerEvidenceSource(index, reader).evidenceFor(['m-1'])).toEqual([]);
  });

  it('DISTRACTOR: only the requested missions are read', async () => {
    // The caller decides the scope. Reading everything regardless would make
    // mining cost grow with the whole ledger on every call.
    const read: string[] = [];
    const index: MissionIndex = {
      async listMissions() {
        return [
          { missionId: 'm-1', status: 'delivered' as const, escalations: 0 },
          { missionId: 'm-2', status: 'delivered' as const, escalations: 0 },
        ];
      },
    };
    const reader: MissionReader = {
      async replay({ missionId }) { read.push(missionId); return []; },
    };

    await new LedgerEvidenceSource(index, reader).evidenceFor(['m-1']);

    expect(read).toEqual(['m-1']);
  });

  it('reads EVERY finished mission when no ids are given — the history is the whole ledger', async () => {
    // "A completed mission history" with no window invented: the ledger already
    // knows which missions are over, so there is no "last N" constant to guess.
    const read: string[] = [];
    const index: MissionIndex = {
      async listMissions() {
        return [
          { missionId: 'm-1', status: 'delivered' as const, escalations: 0 },
          { missionId: 'm-2', status: 'running' as const, escalations: 0 },
          { missionId: 'm-3', status: 'surrendered' as const, escalations: 1 },
        ];
      },
    };
    const reader: MissionReader = {
      async replay({ missionId }) { read.push(missionId); return []; },
    };

    await new LedgerEvidenceSource(index, reader).evidenceFor();

    // The running mission is skipped without being read at all.
    expect(read).toEqual(['m-1', 'm-3']);
  });
});
