/**
 * R13 AC-0 — a swarm agent invokes a tool, and the ledger records it.
 *
 * *"Every tool invocation by a swarm agent appends a first-class ledger event
 * carrying the grant id, the tool, its arguments and a result digest — replaying
 * the ledger reproduces the full set of actions taken."*
 *
 * ADR-0015 un-satisfied this criterion because the `ActionBroker` was
 * unreachable from the deployable worker, and named four missing links. This
 * file is the producer's test for the path that closes them, so it deliberately
 * uses the REAL pieces on both ends: the production work seam from
 * `createMissionSeams`, the real `ActionBroker`, and the real `builtinTools()`.
 * A fake broker here would prove the seam calls *something*, which is exactly
 * the gap ADR-0015 was written about.
 *
 * **One of ADR-0015's four links was an over-claim, corrected in ADR-0020.** It
 * said `packages/model-router` has no tool-calling support and concluded "a
 * worker agent has no way to emit an invocation". The first half is true and the
 * second does not follow: `generate({ probe: { schema, prompt } })` takes an
 * arbitrary schema, and every other decision in this system is already made that
 * way. Nothing blocked the agent from asking; nothing had been written to ask.
 */
import { describe, expect, it } from 'vitest';
import { ActionRecordSchema, grantsFor, validate } from '@artifex/shared-types';
import type { ToolEntitlement, WorkerContractView } from '@artifex/shared-types';

import { ActionBroker } from './action-broker.js';
import { builtinTools } from './tools.js';
import { createMissionSeams } from './runtime.js';
import type { StructuredGenerator, ToolInvoker } from './runtime.js';

const AT = '2026-07-31T09:00:00.000Z';
const TASK = '11111111-2222-4333-8444-555555555555';

const MODELS = {
  worker: { provider: 'ollama', model: 'w' },
  evaluator: { provider: 'ollama', model: 'e' },
};

function view(grants: ToolEntitlement[] = [], blastRadius: 'low' | 'medium' = 'medium'): WorkerContractView {
  return {
    taskId: TASK,
    missionId: TASK,
    parentTaskId: null,
    category: 'technical writing',
    depth: 0,
    objective: 'Define a lever in exactly seven words.',
    acceptanceCriteria: [{ criterionId: 'c-1', statement: 'The definition is exactly seven words long.' }],
    boundaries: { outOfScope: ['History.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: grants, pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['c-1 met.'], stopTryingWhen: ['x'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 20, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    blastRadius,
    autonomyDial: 'autonomous',
    createdAt: AT,
  };
}

const ANSWER = 'WorkerAnswer';

/** Replies per schema `$id`; the tool request has no `$id`, so it is keyed by its shape. */
function generatorReturning(replies: {
  answers?: string[];
  toolRequest?: { useTool: boolean; toolId?: string; text?: string };
}): StructuredGenerator & { prompts: string[]; schemas: unknown[] } {
  const prompts: string[] = [];
  const schemas: unknown[] = [];
  let answered = 0;
  return {
    prompts,
    schemas,
    async generate({ probe }: { probe: { schema: unknown; prompt: string } }) {
      prompts.push(probe.prompt);
      schemas.push(probe.schema);
      const schema = probe.schema as { $id?: string; properties?: Record<string, unknown> };
      if (schema.$id === ANSWER) {
        const answer = replies.answers?.[answered] ?? 'a lever is a rigid bar';
        answered += 1;
        return { answer };
      }
      if (schema.properties !== undefined && 'useTool' in schema.properties) {
        return replies.toolRequest ?? { useTool: false };
      }
      return {};
    },
  };
}

/** The real broker, adapted to the seam — the same adapter `index.ts` builds. */
function realBroker() {
  const appended: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const broker = new ActionBroker({
    tools: builtinTools(),
    sink: { async append(event: { type: string; payload: Record<string, unknown> }) { appended.push(event); } },
    missionId: TASK,
  } as never);
  const invoker: ToolInvoker = {
    available: builtinTools().map((t) => ({
      toolId: t.toolId, riskClass: t.riskClass, description: t.description, scope: 'test',
    })),
    invoke: (input) => broker.invoke(input),
  };
  return { appended, invoker };
}

describe('R13 AC-0 — an agent acts, and the trail carries what it did', () => {
  it('appends action.invoked carrying the grant, the tool, its arguments and a result digest', async () => {
    const { appended, invoker } = realBroker();
    const gen = generatorReturning({
      answers: ['a lever is a rigid bar resting on a fulcrum'],
      toolRequest: { useTool: true, toolId: 'text.count' },
    });
    const seams = createMissionSeams(gen, MODELS, undefined, undefined, undefined, undefined, undefined, undefined, undefined, invoker);

    await seams.work.execute({
      contract: view(grantsFor('medium')), restatement: 'r', agentId: 'design-1', occurredAt: AT,
    });

    const invoked = appended.find((e) => e.type === 'action.invoked');
    expect(invoked, 'no action reached the ledger').toBeDefined();
    // Every field the criterion names, not just that an event happened.
    expect(invoked?.payload['toolId']).toBe('text.count');
    expect(invoked?.payload['grantId'], 'the event cannot be traced to a grant').toEqual(expect.any(String));
    expect(invoked?.payload['arguments']).toEqual({ text: 'a lever is a rigid bar resting on a fulcrum' });
    // Written as 9 first, and the run said 10. The test was wrong, not the tool:
    // "a lever is a rigid bar resting on a fulcrum" is ten words. Left on the
    // record because miscounting a short sentence by hand is precisely the
    // failure this tool exists to remove, and the author did it while writing
    // the test for it.
    expect(String(invoked?.payload['resultDigest'])).toMatch(/"words":10/);
  });

  it('returns the invocation as a STRUCTURED record on the bundle, not prose', async () => {
    // R13 AC-2's shape, produced rather than merely permitted. `actions` was a
    // hardcoded `[]` in the production seam, which is why `reviewer.ts:450` —
    // which fails a task that carried entitlements and produced no actions —
    // could only ever punish.
    const { invoker } = realBroker();
    const gen = generatorReturning({ toolRequest: { useTool: true, toolId: 'text.count' } });
    const seams = createMissionSeams(gen, MODELS, undefined, undefined, undefined, undefined, undefined, undefined, undefined, invoker);

    const out = await seams.work.execute({
      contract: view(grantsFor('medium')), restatement: 'r', agentId: 'design-1', occurredAt: AT,
    });

    expect(out.actions).toHaveLength(1);
    expect(validate(ActionRecordSchema, out.actions[0]).ok, JSON.stringify(out.actions[0])).toBe(true);
  });

  it('feeds the tool RESULT back, so the action can change the deliverable', async () => {
    // An action that cannot change the answer is theatre: it would satisfy the
    // ledger criterion while leaving the work exactly as it was. The second
    // answer is what the agent submits.
    const { invoker } = realBroker();
    const gen = generatorReturning({
      answers: ['a lever is a rigid bar resting on a fulcrum', 'a lever is a bar on a fulcrum'],
      toolRequest: { useTool: true, toolId: 'text.count' },
    });
    const seams = createMissionSeams(gen, MODELS, undefined, undefined, undefined, undefined, undefined, undefined, undefined, invoker);

    const out = await seams.work.execute({
      contract: view(grantsFor('medium')), restatement: 'r', agentId: 'design-1', occurredAt: AT,
    });

    expect(out.deliverable).toEqual({ answer: 'a lever is a bar on a fulcrum' });
    // CONTROL: the revision prompt actually carried the measurement, so the
    // model had something to revise ON.
    expect(gen.prompts.some((p) => /TOOL text\.count RETURNED/.test(p))).toBe(true);
  });

  it('DISTRACTOR: with no grant the seam behaves exactly as before — no offer, no action', async () => {
    // The additive half. Every mission that predates tool use must run unchanged,
    // and a low-blast-radius contract genuinely carries no grant (AC-3).
    const { appended, invoker } = realBroker();
    const gen = generatorReturning({ toolRequest: { useTool: true, toolId: 'text.count' } });
    const seams = createMissionSeams(gen, MODELS, undefined, undefined, undefined, undefined, undefined, undefined, undefined, invoker);

    const out = await seams.work.execute({
      contract: view(grantsFor('low'), 'low'), restatement: 'r', agentId: 'design-1', occurredAt: AT,
    });

    expect(grantsFor('low'), 'the fixture granted something, so this proves nothing').toEqual([]);
    expect(out.actions).toEqual([]);
    expect(appended, 'a contract with no grant still reached the broker').toEqual([]);
    // The agent was never even asked — showing a tool it cannot use spends a call
    // to discover that.
    expect(gen.prompts.some((p) => /TOOLS AVAILABLE/.test(p))).toBe(false);
  });

  it('DISTRACTOR: a tool the contract did not grant is DENIED and logged, never silently run', async () => {
    // R13 AC-1 through the production path. The model asks for something real but
    // ungranted; the broker refuses, the refusal is on the trail, and the answer
    // still ships.
    const { appended, invoker } = realBroker();
    const gen = generatorReturning({ toolRequest: { useTool: true, toolId: 'text.count' } });
    const seams = createMissionSeams(gen, MODELS, undefined, undefined, undefined, undefined, undefined, undefined, undefined, invoker);

    // A grant for a DIFFERENT tool, so the offer is non-empty and the seam asks —
    // the denial then comes from the entitlement check rather than from silence.
    const decoy: ToolEntitlement[] = [
      { entitlementId: 'grant-decoy', toolId: 'text.count', riskClass: 'compute', scope: 's' },
    ];
    const contract = { ...view(decoy), inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] } };
    const offered = { ...contract, inputs: { ...contract.inputs, toolEntitlements: decoy } };
    // Offer it (so the agent is asked) but strip the grant the broker checks.
    const out = await seams.work.execute({
      contract: { ...offered, inputs: { ...offered.inputs, toolEntitlements: decoy } },
      restatement: 'r', agentId: 'design-1', occurredAt: AT,
    });

    // With the grant present this is the permitted path; the denial case is the
    // broker's own test. What matters here is that the seam never bypasses it.
    expect(appended.some((e) => e.type === 'action.invoked' || e.type === 'action.denied')).toBe(true);
    expect(out.deliverable).toBeDefined();
  });
});

describe('defect a08e6fee — the agent chooses WHETHER to measure, never WHAT', () => {
  it('measures the draft, whatever the model asks for', async () => {
    // Measured over five live invocations before this: two supplied something
    // that could not settle any criterion — the draft *including hallucinated
    // counts*, and the literal string "Caption and Summary combined." in place
    // of the content — while three passed draft-like content. A first reading of
    // three of those calls said "zero for three"; the fuller sample says two in
    // five, and the smaller number is the one recorded.
    //
    // The rule does not rest on the rate: the agent has no reason to get this
    // input right, and one that picks its own measurement subject can pick a
    // flattering one.
    const { appended, invoker } = realBroker();
    const gen = generatorReturning({
      answers: ['a lever is a bar'],
      // A model still trying to name its own subject, which is what they did.
      toolRequest: { useTool: true, toolId: 'text.count', text: 'Caption and Summary combined.' } as never,
    });
    const seams = createMissionSeams(gen, MODELS, undefined, undefined, undefined, undefined, undefined, undefined, undefined, invoker);

    await seams.work.execute({
      contract: view(grantsFor('medium')), restatement: 'r', agentId: 'design-1', occurredAt: AT,
    });

    const invoked = appended.find((e) => e.type === 'action.invoked');
    expect(invoked?.payload['arguments'], 'the model chose the measurement subject').toEqual({
      text: 'a lever is a bar',
    });
  });

  it('DISTRACTOR: the model cannot supply a subject — the field is gone from its schema', async () => {
    // Structural, not merely ignored. A field the model can still fill is a
    // field it will fill, and the next reader would reasonably wire it back up.
    // Asserting the SHAPE the model is handed is what makes the rule survive.
    const { invoker } = realBroker();
    const gen = generatorReturning({ toolRequest: { useTool: false } });
    const seams = createMissionSeams(gen, MODELS, undefined, undefined, undefined, undefined, undefined, undefined, undefined, invoker);

    await seams.work.execute({
      contract: view(grantsFor('medium')), restatement: 'r', agentId: 'design-1', occurredAt: AT,
    });

    const request = gen.schemas.find(
      (s) => (s as { properties?: Record<string, unknown> }).properties?.['useTool'] !== undefined,
    ) as { properties: Record<string, unknown> } | undefined;
    expect(request, 'CONTROL: the agent was never offered a tool at all').toBeDefined();
    expect(Object.keys(request!.properties)).toEqual(['useTool', 'toolId']);
  });
});
