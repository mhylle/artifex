/**
 * R35 AC-2 — the verifier is a STAFFED entity, and lineage overlap is refused.
 *
 * `independenceViolation` has existed since P35's first pass, correct and
 * tested, deciding whether a verifier may grade a producer. It had nothing to
 * decide about: Gate B's judge was a bare model call with no design behind it,
 * so `reviewerId` was the mission id and there was no verifier lineage to
 * compare. The eleventh instance of a mechanism with no producer.
 *
 * Two things had to become true before this could be built honestly. The
 * criterion says "given a task and the verifier assigned to it, WHEN STAFFING
 * OCCURS" — so a verifier has to be staffed, not conjured. And the lineage half
 * needs designs that actually have ancestors, which only became true when R28's
 * `agent_redesign` rung started setting `parent_design_id` (0 rows before).
 *
 * The refusal is the criterion's own last clause, and it is the part worth
 * getting right: a check that merely *reports* a violation and staffs the
 * verifier anyway is a log line, not a rule.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it, vi } from 'vitest';

import { ConstitutionViolation } from './constitution.js';
import { staffVerifier } from './agent-creator.js';

const AT = '2026-07-31T09:00:00.000Z';

function contract(): TaskContract {
  return {
    taskId: 'aaaaaaaa-0000-4000-8000-000000000001',
    missionId: 'aaaaaaaa-0000-4000-8000-000000000000',
    parentTaskId: null,
    category: 'summarising', depth: 1,
    objective: 'Summarise the passage.',
    acceptanceCriteria: [{ criterionId: 'c-1', statement: 'It is summarised.' }],
    boundaries: { outOfScope: ['Other passages.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: {
      doneWhen: ['Summarised.'], stopTryingWhen: ['No passage.'], maxAttempts: 3, stallLimit: 2,
    },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

const author = { design: vi.fn(async () => ({ roleInstructions: 'Grade it.', capabilities: ['text'] })) };

/** A registry whose bid and ancestry are whatever the test says. */
function registry(opts: {
  bid?: { designId: string; version: number; roleInstructions: string; capabilities: string[] } | null;
  ancestry?: Record<string, string[]>;
} = {}) {
  const registered: Array<{ designId: string; category: string; parentDesignId?: string | null }> = [];
  return {
    registered,
    lookup: {
      async bestForCategory() { return opts.bid ?? null; },
      async register(input: { designId: string; category: string; parentDesignId?: string | null }) {
        registered.push(input);
        return { version: 1 };
      },
      async ancestorsOf(designId: string) { return opts.ancestry?.[designId] ?? []; },
    },
  };
}

describe('R35 AC-2 — a verifier is staffed, with its own design', () => {
  it('staffs a verifier carrying a design id', async () => {
    const reg = registry();

    const verifier = await staffVerifier({
      contract: contract(),
      registry: reg.lookup as never,
      author,
      producerDesignId: 'design-producer',
    });

    expect(verifier.designId, 'the verifier has no design — nothing to check lineage on').toBeTruthy();
  });

  it('the verifier is a DIFFERENT design from the producer', async () => {
    const reg = registry();

    const verifier = await staffVerifier({
      contract: contract(),
      registry: reg.lookup as never,
      author,
      producerDesignId: 'design-producer',
    });

    expect(verifier.designId).not.toBe('design-producer');
  });

  it('verifiers are registered under their OWN capability, not the producer’s', async () => {
    // If verifier and producer shared a capability they would bid against each
    // other in the reuse market, and the market would hand the same design to
    // both — making a violation the NORMAL case rather than the exception.
    const reg = registry();

    await staffVerifier({
      contract: contract(),
      registry: reg.lookup as never,
      author,
      producerDesignId: 'design-producer',
    });

    expect(reg.registered[0]?.category, 'verifier and producer share a capability').not.toBe('summarising');
    expect(reg.registered[0]?.category).toMatch(/verif/i);
  });
});

describe('R35 AC-2 — a staffing that would violate independence is REFUSED', () => {
  it('refuses a bid that IS the producer’s design', async () => {
    // Identity. The bluntest violation, and the one a shared capability would
    // produce constantly.
    const reg = registry({
      bid: { designId: 'design-producer', version: 3, roleInstructions: 'x', capabilities: ['text'] },
    });

    const verifier = await staffVerifier({
      contract: contract(),
      registry: reg.lookup as never,
      author,
      producerDesignId: 'design-producer',
    });

    expect(verifier.designId, 'the producer was staffed to grade itself').not.toBe('design-producer');
    expect(verifier.refusedBid).toBe('design-producer');
  });

  it('refuses a bid that SHARES AN ANCESTOR with the producer', async () => {
    // The half that needed R28. Two designs promoted from one parent inherit its
    // prompt and its blind spots, so one grading the other is closer to
    // self-review than to independent verification — and the blind spot they
    // share is exactly the one neither will notice.
    const reg = registry({
      bid: { designId: 'design-sibling', version: 2, roleInstructions: 'x', capabilities: ['text'] },
      ancestry: { 'design-sibling': ['design-ancestor'], 'design-producer': ['design-ancestor'] },
    });

    const verifier = await staffVerifier({
      contract: contract(),
      registry: reg.lookup as never,
      author,
      producerDesignId: 'design-producer',
    });

    expect(verifier.designId, 'a sibling design was allowed to grade its own lineage').not.toBe('design-sibling');
    expect(verifier.refusedBid).toBe('design-sibling');
    expect(verifier.refusalReason).toMatch(/lineage|ancestor/i);
  });

  it('a refusal still yields a usable verifier — it authors a fresh one', async () => {
    // Refusing must not deadlock the mission. The remedy for "this verifier is
    // too close" is a verifier that is not, and the Agent Creator can make one.
    const reg = registry({
      bid: { designId: 'design-producer', version: 3, roleInstructions: 'x', capabilities: ['text'] },
    });

    const verifier = await staffVerifier({
      contract: contract(),
      registry: reg.lookup as never,
      author,
      producerDesignId: 'design-producer',
    });

    expect(verifier.designId).toBeTruthy();
    expect(verifier.roleInstructions).toBeTruthy();
  });

  it('DISTRACTOR: an INDEPENDENT bid is reused, not refused', async () => {
    // The rule must be able to say yes. If every bid were refused the reuse
    // market would be dead for verifiers and each task would author a fresh
    // grader — expensive, and it would make the refusal untestable because
    // refusing and not-refusing would look identical.
    const reg = registry({
      bid: { designId: 'design-independent', version: 4, roleInstructions: 'Grade it.', capabilities: ['text'] },
      ancestry: { 'design-independent': ['other-ancestor'], 'design-producer': ['design-ancestor'] },
    });

    const verifier = await staffVerifier({
      contract: contract(),
      registry: reg.lookup as never,
      author,
      producerDesignId: 'design-producer',
    });

    expect(verifier.designId, 'an independent incumbent was thrown away').toBe('design-independent');
    expect(verifier.refusedBid).toBeNull();
  });

  it('DISTRACTOR: unrelated ancestry does not count as shared', async () => {
    // A lineage check that fired on any non-empty ancestry would refuse every
    // bid once designs started having parents, which is the state R28 just
    // created — the check would silently become "never reuse".
    const reg = registry({
      bid: { designId: 'design-independent', version: 4, roleInstructions: 'Grade it.', capabilities: ['text'] },
      ancestry: { 'design-independent': ['ancestor-a', 'ancestor-b'], 'design-producer': ['ancestor-c'] },
    });

    const verifier = await staffVerifier({
      contract: contract(),
      registry: reg.lookup as never,
      author,
      producerDesignId: 'design-producer',
    });

    expect(verifier.designId).toBe('design-independent');
  });

  it('throws a ConstitutionViolation if even the fresh design would violate', async () => {
    // The last resort. If the Agent Creator somehow produced a design that is
    // still not independent, staffing must FAIL rather than proceed — a verifier
    // that shares the producer's blind spots produces a verdict that means
    // nothing, and a meaningless verdict is worse than a missing one because it
    // looks like evidence.
    const reg = registry({ ancestry: { 'design-producer': [] } });

    await expect(
      staffVerifier({
        contract: contract(),
        registry: reg.lookup as never,
        author,
        producerDesignId: 'design-producer',
        // Force the collision: the fresh design would be the producer itself.
        deriveDesignId: () => 'design-producer',
      }),
    ).rejects.toThrow(ConstitutionViolation);
  });
});

describe('R35 AC-2 — a freshly authored verifier is an ORIGIN', () => {
  it('registers with no parent, not with the producer as parent', async () => {
    // Found by a mutant, not by review: setting `parentDesignId: producerDesignId`
    // passed all 561 tests. It would record precisely the lineage this function
    // exists to rule out — and the effect is delayed and self-inflicted, because
    // the NEXT staffing would read that ancestry back, find the overlap, refuse
    // the verifier it just created, and author another. A refusal loop that
    // looks like the rule working.
    const reg = registry({
      bid: { designId: 'design-producer', version: 3, roleInstructions: 'x', capabilities: ['text'] },
    });

    await staffVerifier({
      contract: contract(),
      registry: reg.lookup as never,
      author,
      producerDesignId: 'design-producer',
    });

    expect(reg.registered).toHaveLength(1);
    expect(
      reg.registered[0]?.parentDesignId,
      'the verifier was recorded as descending from the design it grades',
    ).toBeNull();
  });
});

/**
 * The collision a LIVE mission found, which a fixture had masked.
 *
 * `designIdForCapability` is deterministic per capability, so the "fresh" design
 * authored after refusing a bid derived the SAME id as the bid — meaning it was
 * the same design, so it violated too, so staffing threw and the task went
 * unverified. On live mission `1139beb8` this produced `verifier.unstaffed`
 * where a fresh independent verifier was the whole point of refusing.
 *
 * The earlier "a refusal still yields a usable verifier" test passed throughout,
 * because its refused bid was `design-producer` while the derived id was the
 * capability hash — two different strings by accident of the fixture. The case
 * won for a different reason than the one asserted.
 *
 * The fix mirrors R28's redesign id: derive from what was refused, so the id
 * stays deterministic (a replay is faithful) while being distinct from the
 * design it replaces.
 */
describe('R35 AC-2 — refusing the CANONICAL verifier still yields an independent one', () => {
  it('does not re-derive the id it just refused', async () => {
    // The live shape exactly: the registry's incumbent verifier for this
    // capability shares lineage with the producer, and it is also the design the
    // capability hash would produce.
    // The stub is a HASH — deterministic in its argument, like the real
    // `designIdForCapability`. A first version returned a constant regardless of
    // input, which made both branches produce the same id no matter what the
    // implementation did, so the test could never go green. That was the test
    // being wrong, not the code.
    const hash = (capability: string) => `id(${capability})`;
    const canonical = hash('verification.summarising');
    const reg = registry({
      bid: { designId: canonical, version: 2, roleInstructions: 'x', capabilities: ['text'] },
      ancestry: { [canonical]: ['design-ancestor'], 'design-producer': ['design-ancestor'] },
    });

    const verifier = await staffVerifier({
      contract: contract(),
      registry: reg.lookup as never,
      author,
      producerDesignId: 'design-producer',
      deriveDesignId: hash,
    });

    expect(verifier.refusedBid).toBe(canonical);
    expect(verifier.designId, 'the fresh verifier IS the design that was just refused').not.toBe(canonical);
  });

  it('the replacement id is DETERMINISTIC, so a replay lands on the same design', async () => {
    // Deterministic ids are what make a replay faithful (the same argument as
    // the redesign id). A random id here would make every replay author a new
    // verifier and the registry would fill with one-shot graders.
    const hash = (capability: string) => `id(${capability})`;
    const canonical = hash('verification.summarising');
    const make = () => staffVerifier({
      contract: contract(),
      registry: registry({
        bid: { designId: canonical, version: 2, roleInstructions: 'x', capabilities: ['text'] },
        ancestry: { [canonical]: ['a'], 'design-producer': ['a'] },
      }).lookup as never,
      author,
      producerDesignId: 'design-producer',
      deriveDesignId: hash,
    });

    expect((await make()).designId).toBe((await make()).designId);
  });

  it('DISTRACTOR: with NO refusal the plain capability id is still used', async () => {
    // The replacement id must be the exception. If every verifier were staffed
    // under a producer-specific id the reuse market would be dead — a fresh
    // grader per producer, which is what the capability hash exists to avoid.
    const reg = registry();

    const verifier = await staffVerifier({
      contract: contract(),
      registry: reg.lookup as never,
      author,
      producerDesignId: 'design-producer',
      deriveDesignId: () => 'design-plain-capability',
    });

    expect(verifier.refusedBid).toBeNull();
    expect(verifier.designId).toBe('design-plain-capability');
  });
});
