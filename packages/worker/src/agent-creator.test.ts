/**
 * P6 — the Agent Creator (R6).
 *
 * Staffing is reuse-first: ask the registry for a proven design, and only design
 * a new specialist on a no-bid. Either way the manifest's tier comes from the
 * Tier Policy engine, and its validation harness is tied to the actual contract.
 */
import { CapabilityManifestSchema, validate } from '@artifex/shared-types';
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { staff } from './agent-creator.js';
import type { DesignAuthor, RegistryLookup } from './agent-creator.js';

const AT = '2026-07-30T09:00:00.000Z';
const MISSION_ID = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';

function contract(over: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39',
    missionId: MISSION_ID,
    parentTaskId: MISSION_ID,
    category: 'research.sub-question',
    depth: 1,
    objective: 'Answer the sub-question with cited sources.',
    acceptanceCriteria: [
      { criterionId: 'ac-1', statement: 'Every factual claim carries a resolvable citation.' },
      { criterionId: 'ac-2', statement: 'The answer states a rate with a unit and a date.' },
    ],
    boundaries: { outOfScope: ['Do not draft the final report.'], siblingOwners: [] },
    inputs: {
      entitlements: ['mission-brief', 'knowledge-commons:adoption'],
      toolEntitlements: [],
      pinnedDecisions: [],
    },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: {
      doneWhen: ['Criterion ac-1 is met.'],
      stopTryingWhen: ['No resolvable source exists.'],
      maxAttempts: 3,
      stallLimit: 2,
    },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier', 'human_review'], humanAt: 'human_review' },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low',
    autonomyDial: 'checkpointed',
    createdAt: AT,
    ...over,
  };
}

/** Every category is a no-bid. */
const noBid: RegistryLookup = { async bestForCategory() { return null; } };

const author: DesignAuthor = {
  async design({ contract: c }) {
    return {
      roleInstructions: `You answer exactly one sub-question: ${c.objective} Cite every claim.`,
      capabilities: ['web.search', 'text.summarize'],
    };
  },
};

describe('R6 AC-1 — a no-bid produces a manifest with a prompt and a COMPUTED tier', () => {
  it('produces a capability manifest carrying system-prompt role instructions', async () => {
    const manifest = await staff({ contract: contract(), registry: noBid, author });

    expect(manifest.roleInstructions.length).toBeGreaterThan(0);
    expect(manifest.capabilities.length).toBeGreaterThan(0);
  });

  it('validates against the shared CapabilityManifest schema', async () => {
    const manifest = await staff({ contract: contract(), registry: noBid, author });
    const result = validate(CapabilityManifestSchema, manifest);

    expect(result.ok, JSON.stringify(result.ok ? {} : result.errors)).toBe(true);
  });

  it('takes its tier from the Tier Policy engine, not from a constant', async () => {
    // The proof that the tier is COMPUTED: change only the risk inputs and the
    // tier must move. A hardcoded tier would return the same number for both.
    const cheap = await staff({ contract: contract({ blastRadius: 'low' }), registry: noBid, author });
    const risky = await staff({
      contract: contract({ blastRadius: 'high' }),
      registry: noBid,
      author,
      fanIn: 12,
      reversible: false,
    });

    expect(risky.logicalTier).toBeGreaterThan(cheap.logicalTier);
  });

  it('staffs the cheapest tier the risk permits', async () => {
    const manifest = await staff({ contract: contract({ blastRadius: 'low' }), registry: noBid, author });

    expect(manifest.logicalTier).toBe(1);
  });

  it('DISTRACTOR: a no-bid mints a NEW design id rather than reusing one', async () => {
    const a = await staff({ contract: contract(), registry: noBid, author });
    const b = await staff({ contract: contract({ taskId: '9f9f9f9f-1111-4222-8333-444444444444' }), registry: noBid, author });

    expect(a.designId).not.toBe(b.designId);
  });
});

describe('R6 — reuse-first: a registry hit is a bid, and bids win', () => {
  const proven: RegistryLookup = {
    async bestForCategory() {
      return {
        designId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        category: 'research.sub-question',
        version: 4,
        roleInstructions: 'Proven researcher: answer one sub-question, cite everything.',
        capabilities: ['web.search'],
        cladeScore: 0.93,
        observations: 40,
        active: true,
      };
    },
  };

  it('reuses the proven design rather than authoring a new one', async () => {
    const manifest = await staff({ contract: contract(), registry: proven, author });

    expect(manifest.designId).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(manifest.roleInstructions).toMatch(/proven researcher/i);
    expect(manifest.version).toBe(4);
  });

  // These use `evaluative` work deliberately. The clade discount only applies
  // where the proposed tier sits ABOVE the floor — at generative/medium the two
  // already coincide, so a test there would pass no matter what the code did.
  const evaluative = { taskClass: 'evaluative' as const, contract: contract({ blastRadius: 'medium' }) };

  it('a proven clade earns a cheaper tier — reuse is how the swarm gets cheaper', async () => {
    const reused = await staff({ ...evaluative, registry: proven, author });
    const fresh = await staff({ ...evaluative, registry: noBid, author });

    expect(reused.logicalTier).toBeLessThan(fresh.logicalTier);
  });

  it('DISTRACTOR: an UNPROVEN registry entry does not win a cheaper tier', async () => {
    // Otherwise a lucky first run would promote itself into a permanent discount.
    const lucky: RegistryLookup = {
      async bestForCategory() {
        return { ...(await proven.bestForCategory('x'))!, cladeScore: 0.99, observations: 1 };
      },
    };
    const luckyManifest = await staff({ ...evaluative, registry: lucky, author });
    const freshManifest = await staff({ ...evaluative, registry: noBid, author });

    expect(luckyManifest.logicalTier).toBe(freshManifest.logicalTier);
  });
});

describe('R6 AC-2 — the validation harness is tied to the task contract', () => {
  it('derives a check from every acceptance criterion', async () => {
    const c = contract();
    const manifest = await staff({ contract: c, registry: noBid, author });

    expect(manifest.validationHarness.checks.length).toBeGreaterThanOrEqual(c.acceptanceCriteria.length);
    for (const criterion of c.acceptanceCriteria) {
      expect(
        manifest.validationHarness.checks.some((check) => check.includes(criterion.criterionId)),
        `no harness check references criterion ${criterion.criterionId}`,
      ).toBe(true);
    }
  });

  it('DISTRACTOR: the harness tracks THIS contract, not a generic template', async () => {
    // A harness that says the same thing for every task measures nothing.
    const a = await staff({ contract: contract(), registry: noBid, author });
    const b = await staff({
      contract: contract({
        acceptanceCriteria: [{ criterionId: 'zz-9', statement: 'The output is valid JSON.' }],
      }),
      registry: noBid,
      author,
    });

    expect(a.validationHarness.checks).not.toEqual(b.validationHarness.checks);
    expect(b.validationHarness.checks.some((check) => check.includes('zz-9'))).toBe(true);
  });

  it('grants only the context the contract already entitles — nothing wider', async () => {
    const c = contract();
    const manifest = await staff({ contract: c, registry: noBid, author });

    for (const entitlement of manifest.contextEntitlements) {
      expect(c.inputs.entitlements).toContain(entitlement);
    }
  });
});
