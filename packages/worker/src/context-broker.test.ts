/**
 * P8 — the Context Broker and the Worker Swarm (R8).
 *
 * The broker is the SOLE context channel (invariant #6). The test that matters
 * most is AC-2: a specialist must not be able to reach the Memory Fabric around
 * it. That is enforced by making the grant the capability — fabric reads require
 * a grant the broker issued, so "bypassing the broker" is not a policy anyone can
 * forget to apply, it is a missing argument.
 */
import { LedgerEventInputSchema, validate } from '@artifex/shared-types';
import type { TaskContract, WorkerContractView } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { BrokeredFabric, ContextBroker, UnbrokeredAccessError, UnentitledSourceError } from './context-broker.js';
import { runSpecialist } from './specialist.js';
import type { ClarityJudge, SpecialistWork } from './specialist.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';
const TASK_ID = 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39';
const AGENT_ID = '7b2d9e10-4c58-4a3f-b6e2-1f8c0d5a9b47';

function fullContract(over: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: TASK_ID, missionId: MISSION_ID, parentTaskId: MISSION_ID,
    category: 'research.sub-question', depth: 1,
    objective: 'Answer the sub-question about EV market share with cited sources.',
    acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'Every claim carries a citation.' }],
    boundaries: { outOfScope: ['Do not draft the report.'], siblingOwners: [] },
    inputs: { entitlements: ['mission-brief', 'commons:ev-adoption'], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['ac-1 met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier', 'human_review'], humanAt: 'human_review' },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'checkpointed', createdAt: AT,
    ...over,
  };
}

function view(over: Partial<TaskContract> = {}): WorkerContractView {
  const { verificationPlan: _withheld, ...rest } = fullContract(over);
  return rest;
}

/** Captures what the broker appends, so the logging claim is checkable. */
function recordingSink() {
  const events: unknown[] = [];
  return { events, append: async (e: unknown) => { events.push(e); } };
}

const SOURCES = { 'mission-brief': { text: 'Report on EV adoption.' }, 'commons:ev-adoption': { text: '22% in 2024.' }, 'secret:salaries': { text: 'nope' } };
const store = { async read(source: string) { return SOURCES[source as keyof typeof SOURCES] ?? null; } };

describe('R8 AC-1 — context is served by the broker, and every exchange is logged', () => {
  it('serves an entitled source and returns a grant', async () => {
    const sink = recordingSink();
    const broker = new ContextBroker({ fabric: new BrokeredFabric(store), sink, missionId: MISSION_ID });

    const grant = await broker.request({ agentId: AGENT_ID, contract: view(), source: 'mission-brief', occurredAt: AT });

    expect(grant.payload).toEqual(SOURCES['mission-brief']);
    expect(grant.grantId.length).toBeGreaterThan(0);
  });

  it('logs the exchange as a schema-valid ledger event carrying the grant id', async () => {
    const sink = recordingSink();
    const broker = new ContextBroker({ fabric: new BrokeredFabric(store), sink, missionId: MISSION_ID });

    const grant = await broker.request({ agentId: AGENT_ID, contract: view(), source: 'mission-brief', occurredAt: AT });

    expect(sink.events).toHaveLength(1);
    const event = sink.events[0] as { payload: { grantId: string; source: string } };
    expect(validate(LedgerEventInputSchema, event).ok).toBe(true);
    expect(event.payload.grantId).toBe(grant.grantId);
    expect(event.payload.source).toBe('mission-brief');
  });

  it('DISTRACTOR: an unentitled source is refused AND the denial is logged', async () => {
    // Silent refusal is as bad as silent permission — neither leaves a trail.
    const sink = recordingSink();
    const broker = new ContextBroker({ fabric: new BrokeredFabric(store), sink, missionId: MISSION_ID });

    await expect(
      broker.request({ agentId: AGENT_ID, contract: view(), source: 'secret:salaries', occurredAt: AT }),
    ).rejects.toBeInstanceOf(UnentitledSourceError);

    expect(sink.events).toHaveLength(1);
    const event = sink.events[0] as { type: string };
    expect(event.type).toMatch(/denied/i);
  });

  it('DISTRACTOR: entitlement is checked against THIS contract, not a global allowlist', async () => {
    const sink = recordingSink();
    const broker = new ContextBroker({ fabric: new BrokeredFabric(store), sink, missionId: MISSION_ID });
    const narrow = view({ inputs: { entitlements: ['mission-brief'], toolEntitlements: [], pinnedDecisions: [] } });

    await expect(
      broker.request({ agentId: AGENT_ID, contract: narrow, source: 'commons:ev-adoption', occurredAt: AT }),
    ).rejects.toBeInstanceOf(UnentitledSourceError);
  });
});

describe('R8 AC-2 — the fabric cannot be read around the broker', () => {
  it('a direct read with no grant is refused', async () => {
    const fabric = new BrokeredFabric(store);

    await expect(fabric.read('mission-brief', undefined)).rejects.toBeInstanceOf(UnbrokeredAccessError);
  });

  it('DISTRACTOR: the same read WITH a broker-issued grant succeeds', async () => {
    // Without this, "refuse everything" would satisfy the test above.
    const sink = recordingSink();
    const fabric = new BrokeredFabric(store);
    const broker = new ContextBroker({ fabric, sink, missionId: MISSION_ID });

    const grant = await broker.request({ agentId: AGENT_ID, contract: view(), source: 'mission-brief', occurredAt: AT });

    await expect(fabric.read('mission-brief', grant.grantId)).resolves.toEqual(SOURCES['mission-brief']);
  });

  it('DISTRACTOR: a forged grant id is refused', async () => {
    const fabric = new BrokeredFabric(store);

    await expect(fabric.read('mission-brief', 'grant-i-made-up')).rejects.toBeInstanceOf(UnbrokeredAccessError);
  });

  it('DISTRACTOR: a grant for one source cannot read another', async () => {
    // A grant is a capability for a specific source, not a general key.
    const sink = recordingSink();
    const fabric = new BrokeredFabric(store);
    const broker = new ContextBroker({ fabric, sink, missionId: MISSION_ID });

    const grant = await broker.request({ agentId: AGENT_ID, contract: view(), source: 'mission-brief', occurredAt: AT });

    await expect(fabric.read('commons:ev-adoption', grant.grantId)).rejects.toBeInstanceOf(UnbrokeredAccessError);
  });
});

describe('R8 AC-3 — an under-specified contract is restated or bounced, never guessed at', () => {
  const clear: ClarityJudge = {
    async assess() { return { restatement: 'Answer the EV market-share question with citations.', ambiguities: [] }; },
  };
  const unclear: ClarityJudge = {
    async assess() {
      return {
        restatement: 'Unclear what "the figure" refers to.',
        ambiguities: ['"the figure" is not defined', 'no time period is given'],
      };
    },
  };
  const work: SpecialistWork = {
    async execute() { return { deliverable: { answer: '22% in 2024.' }, actions: [], consulted: [], assumptions: [], effortSpent: 2 }; },
  };

  it('bounces an ambiguous contract instead of producing a deliverable', async () => {
    const outcome = await runSpecialist({
      contract: view(), agentId: AGENT_ID, judge: unclear, work,
      bundleId: 'bbbbbbbb-1111-4222-8333-444444444444', producedAt: AT,
    });

    expect(outcome.kind).toBe('bounced');
    if (outcome.kind !== 'bounced') return;
    expect(outcome.ambiguities.length).toBeGreaterThan(0);
  });

  it('DISTRACTOR: a clear contract is executed, not bounced', async () => {
    const outcome = await runSpecialist({
      contract: view(), agentId: AGENT_ID, judge: clear, work,
      bundleId: 'bbbbbbbb-1111-4222-8333-444444444444', producedAt: AT,
    });

    expect(outcome.kind).toBe('delivered');
  });

  it('DISTRACTOR: a bounced task does no work at all — bouncing is not "try anyway"', async () => {
    let executed = false;
    const spyWork: SpecialistWork = {
      async execute() { executed = true; return { deliverable: {}, actions: [], consulted: [], assumptions: [], effortSpent: 1 }; },
    };

    await runSpecialist({
      contract: view(), agentId: AGENT_ID, judge: unclear, work: spyWork,
      bundleId: 'bbbbbbbb-1111-4222-8333-444444444444', producedAt: AT,
    });

    expect(executed).toBe(false);
  });

  it('the restatement is carried either way — it is the cheap self-check', async () => {
    const outcome = await runSpecialist({
      contract: view(), agentId: AGENT_ID, judge: clear, work,
      bundleId: 'bbbbbbbb-1111-4222-8333-444444444444', producedAt: AT,
    });

    expect(outcome.restatement.length).toBeGreaterThan(0);
  });

  it('DISTRACTOR: a specialist handed a FULL contract is refused — it must never see the verification plan', async () => {
    // P2.5 made the withholding a schema guarantee; this proves the swarm
    // actually honours it rather than accepting whatever it is passed.
    await expect(
      runSpecialist({
        contract: fullContract() as unknown as WorkerContractView,
        agentId: AGENT_ID, judge: clear, work,
        bundleId: 'bbbbbbbb-1111-4222-8333-444444444444', producedAt: AT,
      }),
    ).rejects.toThrow(/verification plan|worker view/i);
  });
});
