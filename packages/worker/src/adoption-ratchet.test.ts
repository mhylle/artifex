/**
 * R28's ratchet, reached from the science loop's adopt step.
 *
 * `AssetRegistryRepository.proposeDelta` was complete, correct, and called by
 * nothing but its own tests — find-shape (l), the seventh instance this
 * session. A candidate that WON its bench recorded `learning.candidate_evaluated`
 * and stopped there, so `agent_design_delta` was empty after every mission and
 * no measured win had ever changed a design.
 */
import { describe, expect, it } from 'vitest';
import { deltaProposalFor } from './adoption-ratchet.js';

const HOT_FIX = {
  hotFixId: 'hf-1',
  targetAssetId: 'design-7',
  targetKind: 'role_instructions',
  patchedValue: 'State the assumption you are working under before answering.',
};

const ADOPTED = {
  adopt: true,
  reason: 'won the held-out slice',
  evidence: { candidateId: 'hf-1', wins: 3, losses: 1, heldOutWon: true },
};

describe('deltaProposalFor', () => {
  it('turns an adopted candidate into a proposal the registry can ratchet', () => {
    const proposal = deltaProposalFor(ADOPTED, HOT_FIX, ['evt-1']);

    expect(proposal, 'an adopted candidate produced no proposal').not.toBeNull();
    expect(proposal?.designId).toBe('design-7');
    expect(proposal?.changes).toEqual([
      { field: 'roleInstructions', to: HOT_FIX.patchedValue },
    ]);
    // Non-empty or `proposeDelta` throws: "only measured wins enter".
    expect(proposal?.justifiedBy).toEqual(['evt-1']);
    // 3 of 4 runs won.
    expect(proposal?.candidateScore).toBeCloseTo(0.75);
  });

  it('does not propose a candidate the science loop rejected', () => {
    const rejected = { ...ADOPTED, adopt: false, reason: 'lost the held-out slice' };
    expect(deltaProposalFor(rejected, HOT_FIX, ['evt-1'])).toBeNull();
  });

  /**
   * The distractor that stops the score becoming a count. A proposal whose
   * score is outside 0..1 is a `RangeError` from the registry, and wins alone
   * would send `3` for a candidate that won three of four.
   */
  it('scores as a rate, never as a tally', () => {
    const lopsided = {
      ...ADOPTED,
      evidence: { candidateId: 'hf-1', wins: 9, losses: 3, heldOutWon: true },
    };
    const score = deltaProposalFor(lopsided, HOT_FIX, ['evt-1'])?.candidateScore;
    expect(score).toBeCloseTo(0.75);
    expect(score).toBeLessThanOrEqual(1);
  });

  /**
   * A candidate that was adopted having run nothing would divide by zero and
   * send `NaN`, which the registry stores as a null score rather than refusing.
   */
  it('refuses a proposal with no runs behind it', () => {
    const unrun = {
      ...ADOPTED,
      evidence: { candidateId: 'hf-1', wins: 0, losses: 0, heldOutWon: null },
    };
    expect(deltaProposalFor(unrun, HOT_FIX, ['evt-1'])).toBeNull();
  });

  /**
   * The registry can only move `roleInstructions` and `capabilities`. The fast
   * loop patches role instructions today, and a future kind that names a field
   * the ratchet cannot apply must not be silently mapped onto one it can.
   */
  it('refuses a target the ratchet has no field for', () => {
    const otherKind = { ...HOT_FIX, targetKind: 'playbook_step' };
    expect(deltaProposalFor(ADOPTED, otherKind, ['evt-1'])).toBeNull();
  });

  it('refuses a proposal carrying no evidence', () => {
    expect(deltaProposalFor(ADOPTED, HOT_FIX, [])).toBeNull();
  });
});
