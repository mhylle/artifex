/**
 * R41 — what a restatement is allowed to change about the contract.
 *
 * The resumer spread the WHOLE `operator.restated` payload over the commissioned
 * contract. That payload also carries the operator's `note`, so the contract
 * handed to the worker gained a property the worker view forbids, and every
 * specialist refused it:
 *
 *     specialist refused the contract: it is not a worker view
 *     (a worker must never see the verification plan) — /note: unexpected property
 *
 * Observed live on mission `ef7b7b75`: three staffings, three refusals, ladder
 * exhausted, mission surrendered without a single task executing. The comment
 * above the spread already stated the intent — a restatement "names the
 * criteria and must not silently blank the budget, boundaries or dial" — and
 * the spread implemented none of it. Find-shape (h).
 *
 * Extracted from the provider factory it used to live inside, because a rule
 * that cannot be tested is exactly how this shipped.
 */
import { describe, expect, it } from 'vitest';

import { contractAfterRestatement } from './restated-contract';

const CONTRACT = {
  missionId: 'm-1',
  objective: 'Original objective.',
  acceptanceCriteria: [{ criterionId: 'c-1', statement: 'Original criterion.' }],
  budget: { floor: 1, ceiling: 40, unit: 'effort-units' },
  blastRadius: 'medium',
  autonomyDial: 'autonomous',
};

const restated = (payload: Record<string, unknown>) => ({ type: 'operator.restated', payload });

describe('contractAfterRestatement', () => {
  it('returns the contract untouched when nothing was restated', () => {
    expect(contractAfterRestatement(CONTRACT, [{ type: 'mission.started', payload: {} }]))
      .toEqual(CONTRACT);
  });

  it('takes the restated criteria and objective', () => {
    const out = contractAfterRestatement(CONTRACT, [
      restated({
        objective: 'Sharper objective.',
        acceptanceCriteria: [{ criterionId: 'r-1', statement: 'Sharper criterion.' }],
      }),
    ]);

    expect(out['objective']).toBe('Sharper objective.');
    expect(out['acceptanceCriteria']).toEqual([{ criterionId: 'r-1', statement: 'Sharper criterion.' }]);
  });

  /** The live failure, as a test. */
  it('never lets the operator NOTE reach the contract', () => {
    const out = contractAfterRestatement(CONTRACT, [
      restated({
        acceptanceCriteria: [{ criterionId: 'r-1', statement: 'Sharper criterion.' }],
        note: 'The previous attempts returned commentary rather than the artefact.',
      }),
    ]);

    expect(out, 'the note reached the worker view and every specialist refused it')
      .not.toHaveProperty('note');
  });

  /**
   * Allow-list, not deny-list. A deny-list that named `note` would pass this
   * suite and break again the day `restate` grows a third field.
   */
  it('drops a field the contract does not define, whatever it is called', () => {
    const out = contractAfterRestatement(CONTRACT, [
      restated({
        acceptanceCriteria: [{ criterionId: 'r-1', statement: 'Sharper criterion.' }],
        somethingAddedLater: 'x',
      }),
    ]);

    expect(out).not.toHaveProperty('somethingAddedLater');
  });

  it('keeps the budget, blast radius and dial the mission was commissioned with', () => {
    const out = contractAfterRestatement(CONTRACT, [
      restated({ acceptanceCriteria: [{ criterionId: 'r-1', statement: 'Sharper criterion.' }] }),
    ]);

    expect(out['budget']).toEqual(CONTRACT.budget);
    expect(out['blastRadius']).toBe('medium');
    expect(out['autonomyDial']).toBe('autonomous');
  });

  it('uses the LAST restatement, not the first', () => {
    // "The most recent statement is the true one" (ADR-0024). A fixture with
    // two restatements is the only one that can tell the two apart.
    const out = contractAfterRestatement(CONTRACT, [
      restated({ objective: 'First.', acceptanceCriteria: [{ criterionId: 'a', statement: 'A.' }] }),
      restated({ objective: 'Second.', acceptanceCriteria: [{ criterionId: 'b', statement: 'B.' }] }),
    ]);

    expect(out['objective']).toBe('Second.');
    expect(out['acceptanceCriteria']).toEqual([{ criterionId: 'b', statement: 'B.' }]);
  });

  it('DISTRACTOR: a restatement that names no objective keeps the commissioned one', () => {
    // The cockpit omits `objective` when the operator left it unchanged, and
    // spreading `undefined` over it would blank the mission's objective.
    const out = contractAfterRestatement(CONTRACT, [
      restated({ acceptanceCriteria: [{ criterionId: 'r-1', statement: 'Sharper criterion.' }] }),
    ]);

    expect(out['objective']).toBe('Original objective.');
  });
});
