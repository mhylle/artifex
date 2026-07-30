/**
 * R38 AC-0 and AC-3 — capability clustering, and the early surrender signal.
 *
 * "Clusters the approved task graph into capability categories, so a thousand
 * tasks might need twelve designs, not a thousand." Today the planner emits a
 * free-text category per subtask — "Technical Writing / Tool Instruction",
 * "Description Task", "Content Review / Quality Assurance" — and `designIdFor`
 * hashes them verbatim. Two tasks of the same kind therefore get two designs,
 * neither of which ever reaches the evidence bar, and the reuse market has
 * nothing to trade.
 *
 * The clustering here is DERIVED from the shape the model actually produces
 * rather than from an invented taxonomy: a category is normalised to its first
 * segment, lowercased, punctuation stripped. That is enough to collapse
 * "Technical Writing / Tool Instruction" and "Technical Writing / Manuals" onto
 * one capability without anybody deciding in advance what capabilities exist —
 * which matters, because the taxonomy is supposed to be a *learnable* asset, not
 * a list someone froze into the code.
 */
import type { TaskContract } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { capabilityOf, designIdFor } from './agent-creator.js';

const AT = '2026-07-30T09:00:00.000Z';

function contract(category: string): TaskContract {
  return {
    taskId: 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39',
    missionId: '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13', parentTaskId: null,
    category, depth: 1,
    objective: 'Do the thing.',
    acceptanceCriteria: [{ criterionId: 'ac-1', statement: 'It is done.' }],
    boundaries: { outOfScope: ['Not the rest.'], siblingOwners: [] },
    inputs: { entitlements: [], toolEntitlements: [], pinnedDecisions: [] },
    dependencies: { consumesTaskIds: [], mayRequest: [] },
    stoppingConditions: { doneWhen: ['ac-1 met.'], stopTryingWhen: ['No source.'], maxAttempts: 3, stallLimit: 2 },
    budget: { floor: 1, ceiling: 10, unit: 'effort-units' },
    escalationPolicy: { ladder: ['retry_higher_tier'], humanAt: null },
    verificationPlan: { depth: 'single', requiredAgreement: null },
    blastRadius: 'low', autonomyDial: 'autonomous', createdAt: AT,
  };
}

describe('R38 AC-0 — free-text categories cluster into capabilities', () => {
  it('collapses sub-specialisations of one capability onto the same design', () => {
    // Both of these are real shapes the local model produced on live missions.
    const a = designIdFor(contract('Technical Writing / Tool Instruction'));
    const b = designIdFor(contract('Technical Writing / Manuals and Guides'));

    expect(capabilityOf('Technical Writing / Tool Instruction')).toBe('technical writing');
    expect(a).toBe(b);
  });

  it('ignores case, punctuation and spacing — the model is not consistent about them', () => {
    for (const variant of ['Technical Writing', 'technical  writing', 'Technical-Writing!', '  TECHNICAL WRITING  ']) {
      expect(capabilityOf(variant)).toBe('technical writing');
    }
  });

  it('DISTRACTOR: genuinely different capabilities still get different designs', () => {
    // Clustering everything onto one capability would "achieve" AC-0 by making
    // one agent do everything — reuse of the wrong specialist is worse than no
    // reuse at all.
    expect(capabilityOf('Content Review / Quality Assurance')).not.toBe(capabilityOf('Technical Writing / Manuals'));
    expect(designIdFor(contract('Content Review / QA'))).not.toBe(designIdFor(contract('Technical Writing / Manuals')));
  });

  it('DISTRACTOR: a category with no separator survives intact rather than being emptied', () => {
    expect(capabilityOf('Description Task')).toBe('description task');
    expect(capabilityOf('mission')).toBe('mission');
  });

  it('DISTRACTOR: an empty or punctuation-only category degrades to a named fallback, never to ""', () => {
    // An empty capability would hash to one shared design id, silently pooling
    // every unlabelled task onto a single agent.
    expect(capabilityOf('')).toBe('uncategorised');
    expect(capabilityOf('  //  ')).toBe('uncategorised');
  });

  it('materially fewer designs than tasks — the property AC-0 is actually about', () => {
    // Ten tasks drawn from three capabilities. The count that matters is
    // distinct DESIGNS, which is what the registry accumulates evidence on.
    const categories = [
      'Technical Writing / Tool Instruction',
      'Technical Writing / Manuals',
      'Technical Writing / Reference',
      'Content Review / QA',
      'Content Review / Editing',
      'Content Review / Fact Check',
      'Research / Sources',
      'Research / Synthesis',
      'Research / Background',
      'Technical Writing / Summaries',
    ];

    const designs = new Set(categories.map((c) => designIdFor(contract(c))));

    expect(categories).toHaveLength(10);
    expect(designs.size).toBe(3);
  });
});
