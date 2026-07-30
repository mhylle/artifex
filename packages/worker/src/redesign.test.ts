/**
 * R28 AC-0's missing producer — the `agent_redesign` rung, enacted.
 *
 * The clade score is an observation-weighted recursive CTE over
 * `parent_design_id`, and AC-0 could never be satisfied because **no design had
 * ancestors**: `reparent` was called only from its own test, and nothing else
 * set the column.
 *
 * The producer was already in the vocabulary and did nothing. `agent_redesign`
 * is a rung of the escalation ladder, and grepping the worker found no site that
 * enacted it — the ladder climbed past and staffed the same design again.
 *
 * A redesign is by definition DERIVED from the design that failed, so enacting
 * the rung is exactly where lineage is born.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { staff } from './agent-creator.js';
import type { RegisteredDesign, RegistryLookup } from './agent-creator.js';

const AT = '2026-07-31T09:00:00.000Z';

function contract(over: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39',
    missionId: 'aaaaaaaa-0000-4000-8000-000000000000',
    parentTaskId: 'aaaaaaaa-0000-4000-8000-000000000000',
    category: 'research.sub-question', depth: 1,
    objective: 'Answer one sub-question.',
    acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'It is answered.' }],
    boundaries: { outOfScope: ['Not the others.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['ac-1 met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_same', 'agent_redesign'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
    ...over,
  };
}

const incumbent = (): RegisteredDesign => ({
  designId: 'dddddddd-eeee-4fff-8aaa-000000000001',
  category: 'research sub question',
  version: 4,
  roleInstructions: 'The incumbent instructions.',
  capabilities: ['text'],
  cladeScore: 0.8,
  observations: 5,
  active: true,
});

function registryOf(bid: RegisteredDesign | null) {
  const registered: Array<{ designId: string; parentDesignId?: string | null }> = [];
  const lookup: RegistryLookup = {
    async bestForCategory() { return bid; },
    async register(input) { registered.push(input); return { version: 1 }; },
  };
  return { lookup, registered };
}

const author = { async design() { return { roleInstructions: 'Rewritten.', capabilities: ['text'] }; } };

describe('R28 AC-0 — a redesign records the design it was derived from', () => {
  it('authors a NEW design rather than reusing the incumbent', async () => {
    // The whole point of the rung. Reusing the design that just failed is what
    // the ladder does at every OTHER rung; `agent_redesign` is the one that
    // changes the design itself.
    const { lookup } = registryOf(incumbent());

    const manifest = await staff({
      contract: contract(), registry: lookup, author,
      redesignFrom: incumbent().designId,
    });

    expect(manifest.designId).not.toBe(incumbent().designId);
  });

  it('registers the outgoing design as its PARENT — this is where lineage is born', async () => {
    const { lookup, registered } = registryOf(incumbent());

    await staff({ contract: contract(), registry: lookup, author, redesignFrom: incumbent().designId });

    expect(registered[0]?.parentDesignId).toBe(incumbent().designId);
  });

  it('a redesign of a redesign chains, so a clade is more than two deep', async () => {
    // The clade query aggregates a whole LINEAGE. If every redesign pointed at
    // the same original, the recursion would have nothing to recurse through.
    const { lookup, registered } = registryOf(incumbent());

    const first = await staff({
      contract: contract(), registry: lookup, author, redesignFrom: incumbent().designId,
    });
    await staff({ contract: contract(), registry: lookup, author, redesignFrom: first.designId });

    expect(registered[1]?.parentDesignId).toBe(first.designId);
    expect(registered[1]?.designId).not.toBe(first.designId);
  });

  it('DISTRACTOR: ordinary staffing records NO parent — most designs have no ancestor', async () => {
    // A design authored because nothing bid is an origin, not a descendant.
    // Attributing a parent to it would invent lineage the system never had.
    const { lookup, registered } = registryOf(null);

    await staff({ contract: contract(), registry: lookup, author });

    expect(registered[0]?.parentDesignId ?? null).toBeNull();
  });

  it('DISTRACTOR: ordinary staffing still REUSES a proven incumbent', async () => {
    // Without `redesignFrom`, the reuse market must behave exactly as before —
    // a redesign path that leaked into normal staffing would author a fresh
    // design for every task and undo R38 entirely.
    const { lookup, registered } = registryOf(incumbent());

    const manifest = await staff({ contract: contract(), registry: lookup, author });

    expect(manifest.designId).toBe(incumbent().designId);
    expect(registered).toEqual([]);
  });

  it('DISTRACTOR: a redesign with no incumbent to derive from is an ORIGIN, not a child', async () => {
    // The rung can be reached on a task whose design was authored fresh and
    // never registered. Pointing at a parent that does not exist would break the
    // clade recursion on a dangling id.
    const { lookup, registered } = registryOf(null);

    await staff({ contract: contract(), registry: lookup, author, redesignFrom: null });

    expect(registered[0]?.parentDesignId ?? null).toBeNull();
  });
});
