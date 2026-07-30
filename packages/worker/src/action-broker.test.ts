/**
 * P8.5 — the Action Broker (R13), per ADR-0006/0007.
 *
 * The sibling of the Context Broker: context is what an agent may KNOW, actions
 * are what it may DO. Every invocation is entitlement-scoped by the contract and
 * lands on the ledger, because an unmediated tool call is an unlogged side effect
 * and the ledger is supposed to be the complete record (invariant #1).
 */
import { LedgerEventInputSchema, validate } from '@artifex/shared-types';
import type { TaskContract, WorkerContractView } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import {
  ActionBroker,
  RatificationRequiredError,
  RiskClassNotAdmittedError,
  ToolNotEntitledError,
  admissibleRiskClasses,
  requiresRatification,
} from './action-broker.js';
import type { ToolDescriptor } from './action-broker.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';
const TASK_ID = 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39';
const AGENT_ID = '7b2d9e10-4c58-4a3f-b6e2-1f8c0d5a9b47';

function view(over: Partial<TaskContract> = {}): WorkerContractView {
  const full: TaskContract = {
    taskId: TASK_ID, missionId: MISSION_ID, parentTaskId: MISSION_ID,
    category: 'research.sub-question', depth: 1,
    objective: 'Answer the sub-question with cited sources.',
    acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'Every claim carries a citation.' }],
    boundaries: { outOfScope: ['Do not draft the report.'], siblingOwners: [] },
    inputs: {
      entitlements: ['mission-brief'],
      toolEntitlements: [
        { entitlementId: 'te-1', toolId: 'web.search', riskClass: 'read', scope: 'Entitled sources only.' },
      ],
      pinnedDecisions: [],
    },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['ac-1 met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier', 'human_review'], humanAt: 'human_review' },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'high', autonomyDial: 'autonomous', createdAt: AT,
    ...over,
  };
  const { verificationPlan: _withheld, ...rest } = full;
  return rest;
}

const SEARCH: ToolDescriptor = {
  toolId: 'web.search',
  riskClass: 'read',
  description: 'Search the entitled corpus.',
  async invoke(args) { return { hits: 3, top: `result for ${String((args as { q?: string }).q)}` }; },
};

/** Exists FOR THE REJECTION TESTS. Deliberately wired to nothing that touches the world. */
const PUBLISH: ToolDescriptor = {
  toolId: 'api.publish',
  riskClass: 'write',
  description: 'Write-class descriptor used only to prove the guard refuses it.',
  async invoke() { throw new Error('api.publish must never actually run in v0'); },
};

function recordingSink() {
  const events: unknown[] = [];
  return { events, append: async (e: unknown) => { events.push(e); } };
}

function brokerWith(sink: ReturnType<typeof recordingSink>) {
  return new ActionBroker({ tools: [SEARCH, PUBLISH], sink, missionId: MISSION_ID });
}

describe('R13 AC-0 — every invocation is a first-class ledger event', () => {
  it('returns a structured ActionRecord and logs exactly one action event', async () => {
    const sink = recordingSink();
    const record = await brokerWith(sink).invoke({
      agentId: AGENT_ID, contract: view(), toolId: 'web.search', args: { q: 'ev adoption' }, occurredAt: AT,
    });

    expect(record.outcome).toBe('ok');
    expect(record.viaBrokerGrantId.length).toBeGreaterThan(0);
    expect(record.resultDigest.length).toBeGreaterThan(0);
    expect(sink.events).toHaveLength(1);
  });

  it('the event is schema-valid, filed under the action family, and carries the grant', async () => {
    const sink = recordingSink();
    const record = await brokerWith(sink).invoke({
      agentId: AGENT_ID, contract: view(), toolId: 'web.search', args: { q: 'ev adoption' }, occurredAt: AT,
    });

    const event = sink.events[0] as { family: string; type: string; payload: Record<string, unknown> };
    expect(validate(LedgerEventInputSchema, event).ok).toBe(true);
    expect(event.family).toBe('action');
    expect(event.type).toBe('action.invoked');
    expect(event.payload['grantId']).toBe(record.viaBrokerGrantId);
    expect(event.payload['toolId']).toBe('web.search');
    expect(event.payload['resultDigest']).toBe(record.resultDigest);
  });

  it('replaying the events reproduces the full set of actions taken', async () => {
    const sink = recordingSink();
    const broker = brokerWith(sink);
    for (const q of ['a', 'b', 'c']) {
      await broker.invoke({ agentId: AGENT_ID, contract: view(), toolId: 'web.search', args: { q }, occurredAt: AT });
    }

    expect(sink.events).toHaveLength(3);
    expect(sink.events.every((e) => (e as { family: string }).family === 'action')).toBe(true);
  });
});

describe('R13 AC-1 — an ungranted tool is refused AND logged, never silent', () => {
  it('raises a typed error', async () => {
    const sink = recordingSink();

    await expect(
      brokerWith(sink).invoke({ agentId: AGENT_ID, contract: view(), toolId: 'api.publish', args: {}, occurredAt: AT }),
    ).rejects.toBeInstanceOf(ToolNotEntitledError);
  });

  it('DISTRACTOR: the denial is LOGGED — silently ignoring it is not a refusal', async () => {
    const sink = recordingSink();
    await brokerWith(sink)
      .invoke({ agentId: AGENT_ID, contract: view(), toolId: 'api.publish', args: {}, occurredAt: AT })
      .catch(() => undefined);

    expect(sink.events).toHaveLength(1);
    const event = sink.events[0] as { type: string; payload: Record<string, unknown> };
    expect(event.type).toBe('action.denied');
    expect(event.payload['reason']).toMatch(/entitle/i);
  });

  it('DISTRACTOR: the tool never runs — silently permitting it is not a refusal either', async () => {
    // PUBLISH.invoke throws if reached, so a leak surfaces as the wrong error.
    const sink = recordingSink();
    const error = await brokerWith(sink)
      .invoke({ agentId: AGENT_ID, contract: view(), toolId: 'api.publish', args: {}, occurredAt: AT })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ToolNotEntitledError);
  });

  it('an unknown tool id is refused rather than treated as ungranted-but-harmless', async () => {
    const sink = recordingSink();

    await expect(
      brokerWith(sink).invoke({ agentId: AGENT_ID, contract: view(), toolId: 'nope.nothing', args: {}, occurredAt: AT }),
    ).rejects.toThrow(/unknown tool/i);
  });
});

describe('R13 AC-3 — blast radius bounds the reachable tools', () => {
  it('encodes the ADR-0007 table', () => {
    expect(admissibleRiskClasses('low')).toEqual(['read']);
    expect(admissibleRiskClasses('medium')).toEqual(['read', 'compute']);
    expect(admissibleRiskClasses('high')).toEqual(['read', 'compute', 'write']);
  });

  it('refuses a write-class tool from a LOW blast-radius contract even when entitled', async () => {
    // The rule: a declared blast radius must COVER the tools used. Writing to the
    // world under a "low" declaration would make the task's real blast radius
    // exceed its declared one, invalidating the tier and depth already assigned.
    const sink = recordingSink();
    const entitledButLow = view({
      blastRadius: 'low',
      inputs: {
        entitlements: ['mission-brief'],
        toolEntitlements: [{ entitlementId: 'te-2', toolId: 'api.publish', riskClass: 'write', scope: 'anywhere' }],
        pinnedDecisions: [],
      },
    });

    await expect(
      brokerWith(sink).invoke({ agentId: AGENT_ID, contract: entitledButLow, toolId: 'api.publish', args: {}, occurredAt: AT }),
    ).rejects.toBeInstanceOf(RiskClassNotAdmittedError);
    expect((sink.events[0] as { type: string }).type).toBe('action.denied');
  });

  it('DISTRACTOR: a read-class search from a properly entitled contract SUCCEEDS', async () => {
    // Proves the guard is not simply denying everything.
    const sink = recordingSink();
    const record = await brokerWith(sink).invoke({
      agentId: AGENT_ID, contract: view({ blastRadius: 'low' }), toolId: 'web.search', args: { q: 'x' }, occurredAt: AT,
    });

    expect(record.outcome).toBe('ok');
  });
});

describe('R13 AC-3 — the autonomy dial gates what needs a human first', () => {
  it('encodes the ADR-0007 table', () => {
    expect(requiresRatification('autonomous')).toEqual([]);
    expect(requiresRatification('checkpointed')).toEqual(['write']);
    expect(requiresRatification('supervised')).toEqual(['compute', 'write']);
  });

  const supervisedWrite = view({
    blastRadius: 'high',
    autonomyDial: 'supervised',
    inputs: {
      entitlements: ['mission-brief'],
      toolEntitlements: [{ entitlementId: 'te-2', toolId: 'api.publish', riskClass: 'write', scope: 'anywhere' }],
      pinnedDecisions: [],
    },
  });

  it('denies an unratified write under a supervised dial, and logs it', async () => {
    const sink = recordingSink();

    await expect(
      brokerWith(sink).invoke({ agentId: AGENT_ID, contract: supervisedWrite, toolId: 'api.publish', args: {}, occurredAt: AT }),
    ).rejects.toBeInstanceOf(RatificationRequiredError);
    expect((sink.events[0] as { type: string }).type).toBe('action.denied');
  });

  it('DISTRACTOR: the same call proceeds once ratified', async () => {
    // Without this, "always deny writes under supervision" would pass above.
    const sink = recordingSink();
    const permissive: ToolDescriptor = { ...PUBLISH, async invoke() { return { published: true }; } };
    const broker = new ActionBroker({ tools: [SEARCH, permissive], sink, missionId: MISSION_ID });

    const record = await broker.invoke({
      agentId: AGENT_ID, contract: supervisedWrite, toolId: 'api.publish', args: {},
      occurredAt: AT, ratification: { ratifiedBy: 'operator@example.com', ratifiedAt: AT },
    });

    expect(record.outcome).toBe('ok');
  });

  it('DISTRACTOR: an autonomous dial needs no ratification for the same write', async () => {
    const sink = recordingSink();
    const permissive: ToolDescriptor = { ...PUBLISH, async invoke() { return { published: true }; } };
    const broker = new ActionBroker({ tools: [SEARCH, permissive], sink, missionId: MISSION_ID });

    const record = await broker.invoke({
      agentId: AGENT_ID, contract: { ...supervisedWrite, autonomyDial: 'autonomous' },
      toolId: 'api.publish', args: {}, occurredAt: AT,
    });

    expect(record.outcome).toBe('ok');
  });
});

describe('R13 — a failing tool is recorded, not swallowed', () => {
  it('records outcome "error" and still logs the invocation', async () => {
    const sink = recordingSink();
    const broken: ToolDescriptor = { ...SEARCH, async invoke() { throw new Error('upstream 503'); } };
    const broker = new ActionBroker({ tools: [broken], sink, missionId: MISSION_ID });

    const record = await broker.invoke({
      agentId: AGENT_ID, contract: view(), toolId: 'web.search', args: { q: 'x' }, occurredAt: AT,
    });

    expect(record.outcome).toBe('error');
    expect(record.resultDigest).toMatch(/503/);
    expect(sink.events).toHaveLength(1);
  });
});
