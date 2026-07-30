/**
 * R17 — the cockpit's control plane half.
 *
 * "Watching is also acting… every such act is itself a ledger event, first-class
 * and attributable like everything the agents do." So the service's whole job is
 * to turn an operator's intent into an append, and to derive the current control
 * state back out of those appends — never to hold a flag of its own.
 */
import { describe, expect, it } from 'vitest';

import { CockpitService } from './cockpit.service';
import type { LedgerSink } from './ledger.types';

const MISSION = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';
const TASK = 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39';
const AT = '2026-07-30T09:00:00.000Z';

function harness(existing: Array<{ taskId: string | null; type: string; occurredAt: string }> = []) {
  const appended: Array<Record<string, unknown>> = [];
  const sink: LedgerSink = { async append(event) { appended.push(event as Record<string, unknown>); return event; } };
  const reader = {
    async replay() { return existing as never; },
    async listMissions() { return []; },
    async listAttentionItems() { return []; },
  };
  let n = 0;
  const service = new CockpitService(sink, reader, {
    now: () => AT,
    newId: () => `00000000-0000-4000-8000-${(n += 1).toString(16).padStart(12, '0')}`,
  });
  return { service, appended };
}

describe('R17 AC-0 — every cockpit act is a ledger event with the operator on it', () => {
  it('appends a pause carrying the operator identity', async () => {
    const { service, appended } = harness();

    await service.act({
      missionId: MISSION, taskId: TASK, action: 'pause', operator: 'mnh@systematic.com',
    });

    expect(appended).toHaveLength(1);
    const event = appended[0] as { type: string; actor: { kind: string; id: string }; taskId: string };
    expect(event.type).toBe('operator.paused');
    expect(event.actor.kind).toBe('human');
    expect(event.actor.id).toBe('mnh@systematic.com');
    expect(event.taskId).toBe(TASK);
  });

  it('AC-2: a budget grant is an ECONOMIC event carrying the amount', async () => {
    const { service, appended } = harness();

    await service.act({
      missionId: MISSION, taskId: TASK, action: 'grant_budget', operator: 'op', amount: 25,
    });

    const event = appended[0] as { family: string; payload: { amount: number } };
    expect(event.family).toBe('economic');
    expect(event.payload.amount).toBe(25);
  });

  it('AC-3: turning the dial records the new setting for the NEXT gate', async () => {
    const { service, appended } = harness();

    await service.act({
      missionId: MISSION, taskId: null, action: 'turn_dial', operator: 'op', autonomyDial: 'supervised',
    });

    const event = appended[0] as { type: string; payload: { autonomyDial: string; appliesFrom: string } };
    expect(event.type).toBe('operator.dial_turned');
    expect(event.payload.autonomyDial).toBe('supervised');
    // Recorded explicitly so replay cannot mistake it for retroactive.
    expect(event.payload.appliesFrom).toBe('next_gate');
  });

  it('an annotation is appended against the task it annotates', async () => {
    const { service, appended } = harness();

    await service.act({
      missionId: MISSION, taskId: TASK, action: 'annotate', operator: 'op', note: 'Watch this one.',
    });

    const event = appended[0] as { type: string; payload: { note: string } };
    expect(event.type).toBe('operator.annotated');
    expect(event.payload.note).toBe('Watch this one.');
  });

  it('AC-4 DISTRACTOR: acting only ever APPENDS — the sink is never asked to change anything', async () => {
    // The ledger's append-only guarantee is enforced by database triggers, but
    // the service must not even try: a correction is a new event, never an edit.
    const { service } = harness();
    const forbidden: string[] = [];
    const service2 = new CockpitService(
      {
        async append(event) { return event; },
        // Any mutating method must go unused; if the service ever calls one the
        // test fails loudly rather than relying on the DB to refuse it.
        async update() { forbidden.push('update'); },
        async delete() { forbidden.push('delete'); },
      } as unknown as LedgerSink,
      { async replay() { return [] as never; }, async listMissions() { return []; }, async listAttentionItems() { return []; } },
      { now: () => AT, newId: () => TASK },
    );

    await service2.act({ missionId: MISSION, taskId: TASK, action: 'pause', operator: 'op' });
    await service2.act({ missionId: MISSION, taskId: TASK, action: 'resume', operator: 'op' });
    void service;

    expect(forbidden).toEqual([]);
  });
});

describe('R17 — control state is DERIVED from the trail, never stored', () => {
  it('reports run when nothing has been said', async () => {
    const { service } = harness();

    await expect(service.controlState(MISSION, TASK)).resolves.toBe('run');
  });

  it('reports paused after a pause', async () => {
    const { service } = harness([{ taskId: TASK, type: 'operator.paused', occurredAt: AT }]);

    await expect(service.controlState(MISSION, TASK)).resolves.toBe('paused');
  });

  it('DISTRACTOR: the LATEST signal wins, so a resume actually resumes', async () => {
    // Accumulating rather than replacing would make pause a one-way door.
    const { service } = harness([
      { taskId: TASK, type: 'operator.paused', occurredAt: AT },
      { taskId: TASK, type: 'operator.resumed', occurredAt: AT },
    ]);

    await expect(service.controlState(MISSION, TASK)).resolves.toBe('run');
  });

  it('DISTRACTOR: a cancel outranks a later resume — cancellation is not reversible', async () => {
    // Resuming cancelled work would restart something the operator ended, and
    // the accounting for it has already been written.
    const { service } = harness([
      { taskId: TASK, type: 'operator.cancelled', occurredAt: AT },
      { taskId: TASK, type: 'operator.resumed', occurredAt: AT },
    ]);

    await expect(service.controlState(MISSION, TASK)).resolves.toBe('cancelled');
  });

  it('DISTRACTOR: a pause on ANOTHER task does not pause this one', async () => {
    const { service } = harness([
      { taskId: 'someone-else', type: 'operator.paused', occurredAt: AT },
    ]);

    await expect(service.controlState(MISSION, TASK)).resolves.toBe('run');
  });

  it('a mission-wide pause (no taskId) applies to every task in it', async () => {
    const { service } = harness([{ taskId: null, type: 'operator.paused', occurredAt: AT }]);

    await expect(service.controlState(MISSION, TASK)).resolves.toBe('paused');
  });
});

/**
 * R18 AC-2 — an answered item must let the task PROCEED, not merely be recorded.
 *
 * Recording a decision that nothing acts on is the failure shape this project
 * has shipped repeatedly. The runtime resumes by replaying the trail (R41), but
 * it only replays when a job arrives — so answering has to re-enqueue.
 */
describe('R18 AC-2 — deciding re-enqueues the mission so the task proceeds', () => {
  function decidingHarness() {
    const appended: Array<Record<string, unknown>> = [];
    const enqueued: string[] = [];
    const sink: LedgerSink = { async append(event) { appended.push(event as Record<string, unknown>); return event; } };
    const reader = {
      async replay() { return [] as never; },
      async listMissions() { return []; },
      async listAttentionItems() { return []; },
    };
    const service = new CockpitService(
      sink,
      reader,
      { now: () => AT, newId: () => TASK },
      { async resume(missionId: string) { enqueued.push(missionId); } },
    );
    return { service, appended, enqueued };
  }

  it('appends the decision and re-enqueues the mission', async () => {
    const { service, appended, enqueued } = decidingHarness();

    await service.act({
      missionId: MISSION, taskId: TASK, action: 'decide', operator: 'op', decision: 'approve',
    });

    expect((appended[0] as { type: string }).type).toBe('operator.decided');
    expect(enqueued).toEqual([MISSION]);
  });

  it('DISTRACTOR: a pause does NOT re-enqueue — only a decision unblocks', async () => {
    // Re-enqueuing on every action would restart missions the operator just
    // stopped, which is the opposite of what they asked for.
    const { service, enqueued } = decidingHarness();

    await service.act({ missionId: MISSION, taskId: TASK, action: 'pause', operator: 'op' });
    await service.act({ missionId: MISSION, taskId: TASK, action: 'annotate', operator: 'op', note: 'x' });

    expect(enqueued).toEqual([]);
  });

  it('DISTRACTOR: a decision is recorded even if re-enqueuing fails', async () => {
    // The human's ruling is a fact about what they decided; losing it because a
    // queue was briefly unavailable would discard the one thing only they can
    // provide.
    const appended: Array<Record<string, unknown>> = [];
    const service = new CockpitService(
      { async append(event) { appended.push(event as Record<string, unknown>); return event; } },
      { async replay() { return [] as never; }, async listMissions() { return []; }, async listAttentionItems() { return []; } },
      { now: () => AT, newId: () => TASK },
      { async resume() { throw new Error('queue down'); } },
    );

    await expect(
      service.act({ missionId: MISSION, taskId: TASK, action: 'decide', operator: 'op', decision: 'approve' }),
    ).resolves.toBeDefined();
    expect(appended).toHaveLength(1);
  });
});
