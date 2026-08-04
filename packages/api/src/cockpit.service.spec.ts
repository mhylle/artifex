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

  /**
   * The guard says "a cockpit action must name the operator performing it" and
   * only implemented half of it: `request.operator.trim()` reads the field
   * before checking it exists, so a request that names NO operator threw a
   * TypeError and the operator got a 500 instead of the sentence above.
   *
   * Found live — a control POST that used `actor` instead of `operator` (an
   * easy mistake, since the ledger event calls it `actor`) crashed the
   * endpoint. Find-shape (h): a guard stating an intent its own implementation
   * does not cover.
   */
  it('refuses an action naming no operator, with a reason rather than a crash', async () => {
    const { service, appended } = harness();

    // The exact shape that crashed it: the field simply absent.
    const acting = service.act({ missionId: MISSION, taskId: null, action: 'pause' } as never);

    await expect(acting).rejects.toThrow(/name the operator/);
    expect(appended, 'a refused action still appended to the ledger').toHaveLength(0);
  });

  it('refuses a BLANK operator too', async () => {
    // The half that already worked. Kept as an anti-regression distractor: a
    // fix that only added an existence check would let whitespace through, and
    // "someone paused this" is not accountability.
    const { service, appended } = harness();

    await expect(
      service.act({ missionId: MISSION, taskId: null, action: 'pause', operator: '   ' }),
    ).rejects.toThrow(/name the operator/);
    expect(appended).toHaveLength(0);
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

/**
 * Restating a mission amends its contract and continues it (R41, R37 AC-2).
 *
 * The owner's correction: a retry that minted a new mission id split one piece
 * of work across two trails and grew the fleet by a row every time a criterion
 * needed a word changed. A restatement is another event on the SAME trail.
 *
 * The ledger is append-only, so the amendment does not rewrite the intake
 * event — it is appended, and the contract handed to the runtime is the intake
 * contract with the LAST restatement applied. That is the same rule the fleet
 * projection uses for status (ADR-0024): the most recent statement wins.
 */
describe('R41 — restating amends the contract and continues the same mission', () => {
  const ORIGINAL = {
    taskId: MISSION, missionId: MISSION, objective: 'Come up with algorithms',
    acceptanceCriteria: [{ criterionId: 'm-1', statement: 'Completeness and accuracy' }],
  };

  function harness(trail: Array<Record<string, unknown>>) {
    const appended: Array<Record<string, unknown>> = [];
    const enqueued: Array<{ missionId: string; contract: Record<string, unknown> }> = [];
    const sink: LedgerSink = { async append(event) { appended.push(event as Record<string, unknown>); return event; } };
    const reader = {
      async replay() { return [...trail, ...appended] as never; },
      async listMissions() { return []; },
      async listAttentionItems() { return []; },
    };
    const service = new CockpitService(
      sink, reader, { now: () => AT, newId: () => TASK },
      {
        async resume(missionId: string) {
          // Mirrors app.module's resumer: read the trail, build the contract.
          const events = await reader.replay();
          const intake = (events as unknown as Array<Record<string, unknown>>)
            .find((e) => e['type'] === 'mission.intake_accepted');
          const restated = [...(events as unknown as Array<Record<string, unknown>>)]
            .reverse().find((e) => e['type'] === 'operator.restated');
          const base = (intake?.['payload'] as { contract?: Record<string, unknown> })?.contract ?? {};
          const amendment = (restated?.['payload'] ?? {}) as Record<string, unknown>;
          enqueued.push({ missionId, contract: { ...base, ...amendment } });
        },
      },
    );
    return { service, appended, enqueued };
  }

  const withIntake = (): Array<Record<string, unknown>> => [
    { type: 'mission.intake_accepted', payload: { contract: ORIGINAL } },
  ];

  it('records the restatement and re-enqueues the SAME mission id', async () => {
    const { service, appended, enqueued } = harness(withIntake());

    await service.act({
      missionId: MISSION, taskId: MISSION, action: 'restate', operator: 'op',
      acceptanceCriteria: [{ criterionId: 'm-1', statement: 'Lists exactly three named algorithms.' }],
    });

    expect((appended[0] as { type: string }).type).toBe('operator.restated');
    expect(enqueued.map((e) => e.missionId), 'a restatement started a different mission').toEqual([MISSION]);
  });

  it('the contract the runtime receives carries the NEW criteria, not the old', async () => {
    // The half that makes it a restatement rather than a retry: without it the
    // mission resumes against the specification that already failed.
    const { service, enqueued } = harness(withIntake());

    await service.act({
      missionId: MISSION, taskId: MISSION, action: 'restate', operator: 'op',
      acceptanceCriteria: [{ criterionId: 'm-1', statement: 'Lists exactly three named algorithms.' }],
    });

    const criteria = enqueued[0]?.contract['acceptanceCriteria'] as Array<{ statement: string }>;
    expect(criteria[0]?.statement).toBe('Lists exactly three named algorithms.');
  });

  it('DISTRACTOR: what the restatement does NOT mention is inherited, not dropped', () => {
    // A restatement names the criteria; it must not silently blank the
    // objective, budget or boundaries the mission was commissioned with.
    const { service, enqueued } = harness(withIntake());

    return service.act({
      missionId: MISSION, taskId: MISSION, action: 'restate', operator: 'op',
      acceptanceCriteria: [{ criterionId: 'm-1', statement: 'Lists three.' }],
    }).then(() => {
      expect(enqueued[0]?.contract['objective']).toBe('Come up with algorithms');
      expect(enqueued[0]?.contract['missionId']).toBe(MISSION);
    });
  });

  it('DISTRACTOR: a restatement with no criteria is refused rather than blanking the contract', async () => {
    // A mission with no acceptance criteria cannot be graded (invariant #2), and
    // an empty array would be accepted silently by a naive spread.
    const { service, appended } = harness(withIntake());

    await expect(
      service.act({ missionId: MISSION, taskId: MISSION, action: 'restate', operator: 'op', acceptanceCriteria: [] }),
    ).rejects.toThrow();
    expect(appended, 'an ungradeable restatement reached the ledger').toHaveLength(0);
  });
});
