/**
 * R21 — the fleet route.
 *
 * Mission Control opened on an empty box demanding a UUID, so the operator
 * needed to already know a mission id to see anything at all. The rail needs a
 * list, and that list is a *projection of the ledger* — there is no mission
 * table, because a second store is a second truth (invariant #1).
 */
import { describe, expect, it } from 'vitest';

import { MissionController } from './mission.controller';
import type { LedgerReader, MissionSummary } from './ledger.types';
import type { MissionIntakeService } from './mission-intake.service';

const SUMMARIES: MissionSummary[] = [
  { missionId: 'm-2', objective: 'Newer', status: 'running', eventCount: 3, escalations: 0, agentsStaffed: 1, tasksToday: 2, lastEventAt: '2026-07-30T09:00:00.000Z' },
  { missionId: 'm-1', objective: 'Older', status: 'delivered', eventCount: 9, escalations: 1, agentsStaffed: 3, tasksToday: 0, lastEventAt: '2026-07-30T08:00:00.000Z' },
];

function harness(over: Partial<LedgerReader> = {}) {
  const calls: string[] = [];
  const reader: LedgerReader = {
    async replay({ missionId }) { calls.push(`replay:${missionId}`); return []; },
    async listMissions() { calls.push('listMissions'); return SUMMARIES; },
    async listAttentionItems() { calls.push('listAttentionItems'); return []; },
    ...over,
  };
  const intake = {} as MissionIntakeService;
  return { controller: new MissionController(intake, reader), calls };
}

describe('R21 — GET /missions returns the fleet', () => {
  it('returns every mission the ledger knows about', async () => {
    const { controller } = harness();

    const fleet = await controller.fleet();

    expect(fleet).toEqual(SUMMARIES);
  });

  it('reads the fleet from the ledger, not from a stored mission list', async () => {
    const { controller, calls } = harness();

    await controller.fleet();

    expect(calls).toEqual(['listMissions']);
  });

  it('DISTRACTOR: an empty ledger yields an empty fleet, not an error', async () => {
    // A fresh install has no missions; that is a normal state, not a fault.
    const { controller } = harness({ async listMissions() { return []; } });

    await expect(controller.fleet()).resolves.toEqual([]);
  });

  it('DISTRACTOR: the fleet route does not swallow the per-mission events route', async () => {
    // Nest matches in declaration order, so a `GET /missions` handler declared
    // after `:missionId/events` — or a `:missionId` param route declared before
    // it — silently captures the other's traffic. Both must still work.
    const { controller, calls } = harness();

    await controller.fleet();
    await controller.events('m-1');

    expect(calls).toEqual(['listMissions', 'replay:m-1']);
  });
});
