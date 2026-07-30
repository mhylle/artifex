/**
 * R38 AC-2 — a constrained design space, and effort sized to the work.
 *
 * "Designs on no-bid — composed from the design playbook's TYPED BUILDING
 * BLOCKS, not blank-page prompt authorship ('a constrained design space
 * demonstrably beats freeform generation' — AFlow). Scales effort — how many
 * workers a category gets, sized to task class and budget, preventing both
 * fifty-agents-for-a-triviality and one-agent-for-an-avalanche."
 *
 * The author seam was a single hardcoded template string, which is neither
 * freehand generation nor a playbook — it was one block pretending to be a
 * design. The point of blocks is that the space is constrained *by
 * construction*: a composer that can only emit known block kinds, each filled
 * from a contract field, cannot invent an instruction the contract never
 * justified.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { BLOCK_KINDS, composeDesign, concurrencyFor } from './design-playbook.js';

const AT = '2026-07-30T09:00:00.000Z';

function contract(over: Partial<TaskContract> = {}): TaskContract {
  return {
    taskId: 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39',
    missionId: '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13', parentTaskId: null,
    category: 'research.sub-question', depth: 1,
    objective: 'Explain how a bicycle bell works.',
    acceptanceCriteria: [
      { criterionId: 'ac-1', statement: 'Names the striking mechanism.' },
      { criterionId: 'ac-2', statement: 'Says why it is audible at distance.' },
    ],
    boundaries: { outOfScope: ['No traffic law.', 'No repair instructions.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['both met.'], stopTryingWhen: ['No authoritative source exists.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
    ...over,
  };
}

describe('R38 AC-2 — the specialist is COMPOSED, not authored freehand', () => {
  it('emits one block per playbook kind, in the playbook’s order', () => {
    const design = composeDesign(contract());

    expect(design.blocks.map((b) => b.kind)).toEqual([...BLOCK_KINDS]);
  });

  it('every block’s content is traceable to a contract field', () => {
    // This is what "constrained design space" buys: nothing in the instructions
    // originates anywhere but the contract, so a design cannot quietly acquire
    // an obligation nobody agreed to.
    const design = composeDesign(contract());
    const text = design.roleInstructions;

    expect(text).toContain('Explain how a bicycle bell works.');       // objective
    expect(text).toContain('Names the striking mechanism.');           // criterion
    expect(text).toContain('Says why it is audible at distance.');     // criterion
    expect(text).toContain('No traffic law.');                         // anti-scope
    expect(text).toContain('No authoritative source exists.');         // stopping
  });

  it('DISTRACTOR: a criterion added to the contract appears in the design', () => {
    // Without this, a composer that hardcoded two criteria would pass the test
    // above while ignoring the contract entirely.
    const design = composeDesign(contract({
      acceptanceCriteria: [{ criterionId: 'ac-9', statement: 'Cites a manufacturer.' }],
    }));

    expect(design.roleInstructions).toContain('Cites a manufacturer.');
    expect(design.roleInstructions).not.toContain('Names the striking mechanism.');
  });

  it('DISTRACTOR: a contract with no anti-scope says so rather than emitting an empty block', () => {
    // A blank anti-scope block reads as "nothing is out of scope", which is a
    // claim the contract never made.
    const design = composeDesign(contract({
      boundaries: { outOfScope: [], siblingOwners: [] },
    }));

    const antiScope = design.blocks.find((b) => b.kind === 'anti_scope');
    expect(antiScope?.text).toMatch(/none stated|no stated/i);
  });

  it('DISTRACTOR: capabilities are DERIVED, not a fixed list', () => {
    // 'text' always; tool use only when the contract actually entitles it.
    // Declaring a capability the contract does not grant would let a design
    // claim reach it does not have.
    expect(composeDesign(contract()).capabilities).toEqual(['text']);

    const withTools = composeDesign(contract({
      inputs: { entitlements: [], toolEntitlements: [{ tool: 'search', scope: 'web' }] as never, pinnedDecisions: [] },
    }));
    expect(withTools.capabilities).toContain('tools');
  });
});

describe('R38 AC-2 — effort scaling sizes the wave to budget and risk', () => {
  const child = (floor: number, blastRadius: TaskContract['blastRadius'] = 'low') =>
    contract({ budget: { floor, ceiling: floor * 2, unit: 'effort-units' }, blastRadius });

  it('a generous budget carries the whole wave', () => {
    const wave = [child(1), child(1), child(1), child(1)];

    expect(concurrencyFor(contract({ budget: { floor: 1, ceiling: 100, unit: 'effort-units' } }), wave)).toBe(4);
  });

  it('a thin budget cannot carry fifty agents for a triviality', () => {
    // Ten workers whose floors total 20 cannot all be in flight under a ceiling
    // of 6. The bound is what the budget can actually pay for concurrently.
    const wave = Array.from({ length: 10 }, () => child(2));

    const concurrency = concurrencyFor(contract({ budget: { floor: 1, ceiling: 6, unit: 'effort-units' } }), wave);

    expect(concurrency).toBeLessThan(10);
    expect(concurrency).toBe(3);
  });

  it('DISTRACTOR: never returns 0 — one agent for an avalanche beats none at all', () => {
    // A budget too small for even one worker's floor must still run one, or the
    // mission stalls with no explanation. Progress with a budget overrun is
    // recoverable; a silent halt is not.
    const wave = [child(50), child(50)];

    expect(concurrencyFor(contract({ budget: { floor: 1, ceiling: 1, unit: 'effort-units' } }), wave)).toBe(1);
  });

  it('DISTRACTOR: never exceeds the wave — no phantom workers', () => {
    const wave = [child(1)];

    expect(concurrencyFor(contract({ budget: { floor: 1, ceiling: 1000, unit: 'effort-units' } }), wave)).toBe(1);
  });

  it('DISTRACTOR: HIGH blast radius runs fewer at once than low, on the same budget', () => {
    // Blast radius is the contract's own class marker, and it is the reason to
    // be cautious: many concurrent high-risk workers is exactly the avalanche
    // the criterion names. Same budget, same floors — only the risk differs.
    const budget = contract({ budget: { floor: 1, ceiling: 100, unit: 'effort-units' } });
    const low = Array.from({ length: 8 }, () => child(1, 'low'));
    const high = Array.from({ length: 8 }, () => child(1, 'high'));

    expect(concurrencyFor(budget, high)).toBeLessThan(concurrencyFor(budget, low));
  });

  it('DISTRACTOR: an empty wave is 0, not 1 — nothing to run means nothing scheduled', () => {
    expect(concurrencyFor(contract(), [])).toBe(0);
  });
});
