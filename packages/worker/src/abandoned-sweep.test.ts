/**
 * The abandoned-mission sweep (defect `dd2e9d18`, ADR-0025).
 *
 * Find-shape (w): a state the system can enter but has no event to describe.
 * Nothing writes an event when a worker dies, so 26 missions sat at "running"
 * with the oldest ~19 hours old and zero actually in flight. That is not a query
 * problem — no projection can distinguish "running" from "abandoned" when the
 * ledger holds no fact either way.
 *
 * The premise was checked against the live queue BEFORE this was designed: of
 * the 26, **0** were in a live BullMQ state, and the control proved the queue
 * was reachable (155 completed jobs). But the check also produced the rule that
 * makes the sweep safe — see the queue distractor below. A sweep keyed on the
 * ledger alone would abandon a mission the runtime is about to pick up.
 */
import { describe, expect, it } from 'vitest';

import { sweepAbandonedMissions } from './abandoned-sweep.js';
import type { AbandonedSweepDeps } from './abandoned-sweep.js';

const AT = '2026-07-31T16:00:00.000Z';

function deps(overrides: Partial<AbandonedSweepDeps> = {}): {
  deps: AbandonedSweepDeps;
  appended: Array<Record<string, unknown>>;
} {
  const appended: Array<Record<string, unknown>> = [];
  return {
    appended,
    deps: {
      fleet: async () => [
        { missionId: 'm-dead', status: 'running', objective: 'Never finished' },
        { missionId: 'm-done', status: 'delivered', objective: 'Finished' },
        { missionId: 'm-gave-up', status: 'surrendered', objective: 'Stopped' },
      ],
      liveMissionIds: async () => new Set<string>(),
      append: async (event) => void appended.push(event as unknown as Record<string, unknown>),
      newId: () => 'generated-id',
      now: () => AT,
      ...overrides,
    },
  };
}

describe('dd2e9d18 — a mission nobody is running is recorded as abandoned', () => {
  it('appends `mission.abandoned` for a running mission with no live job', async () => {
    const { deps: d, appended } = deps();

    const swept = await sweepAbandonedMissions(d);

    expect(swept).toEqual(['m-dead']);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.['type']).toBe('mission.abandoned');
    expect(appended[0]?.['missionId']).toBe('m-dead');
  });

  it('files it against the mission task and says WHY, not merely what', async () => {
    // Find-shape (g). An operator reading "abandoned" with no reason has to go
    // and investigate what the trail was supposed to tell them.
    const { deps: d, appended } = deps();

    await sweepAbandonedMissions(d);

    expect(appended[0]?.['taskId'], 'a mission-scoped outcome must hang off the mission task').toBe('m-dead');
    expect(appended[0]?.['family']).toBe('contract');
    const payload = appended[0]?.['payload'] as Record<string, unknown>;
    expect(String(payload['reason'])).toMatch(/restart|worker|no longer running/i);
    expect(payload['objective'], 'the trail should not require a join to read').toBe('Never finished');
  });

  it('DISTRACTOR: a mission still LIVE on the queue is left alone', async () => {
    // The rule the pre-design queue check produced. A mission the API enqueued
    // moments before this worker booted is genuinely waiting, not dead — and
    // marking it abandoned would libel work that is about to happen.
    const { deps: d, appended } = deps({
      fleet: async () => [
        { missionId: 'm-queued', status: 'running', objective: 'Waiting its turn' },
        { missionId: 'm-dead', status: 'running', objective: 'Never finished' },
      ],
      liveMissionIds: async () => new Set(['m-queued']),
    });

    const swept = await sweepAbandonedMissions(d);

    expect(swept, 'CONTROL: nothing was swept at all, so the exclusion proves nothing').toEqual(['m-dead']);
    expect(appended.map((e) => e['missionId'])).not.toContain('m-queued');
  });

  it('DISTRACTOR: a mission that reached an outcome is never re-terminated', async () => {
    // Appending `mission.abandoned` after a delivery would overwrite a true
    // outcome with a false one under the last-event-wins rule (ADR-0024).
    const { deps: d, appended } = deps({ liveMissionIds: async () => new Set(['m-dead']) });

    const swept = await sweepAbandonedMissions(d);

    expect(swept, 'CONTROL: the fixture had settled missions to leave alone').toEqual([]);
    expect(appended, 'a settled mission was re-terminated').toHaveLength(0);
  });

  it('DISTRACTOR: a queue that cannot be reached sweeps NOTHING', async () => {
    // Degrading to "abandon everything" would be far worse than the defect. If
    // the sweep cannot establish what is live, it has not established that
    // anything is dead.
    const { deps: d, appended } = deps({
      liveMissionIds: async () => {
        throw new Error('redis unavailable');
      },
    });

    const swept = await sweepAbandonedMissions(d);

    expect(swept).toEqual([]);
    expect(appended).toHaveLength(0);
  });
});
