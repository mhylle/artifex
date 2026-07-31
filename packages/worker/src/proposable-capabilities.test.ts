/**
 * The registry's capability list is fed to a planner and to `resolveCapability`,
 * and it contains categories neither of them may ever use.
 *
 * MEASURED against the live registry before anything was built. `agent_design`
 * holds 35 distinct categories. Eleven are `verification.*`. The single
 * highest-observation entry — the FIRST thing `resolveCapability` tries, because
 * the list is ordered by observations DESC — is `mission`, with 57:
 *
 *     mission                                | 57
 *     scientific terminology                 | 15
 *     Physics/Chemistry of Writing Materials |  6
 *     hand tools overview                    |  5
 *     verification.scientific definitions    |  4
 *     research.dogfood.1785397657889         |  3
 *
 * Neither `mission` nor `verification.*` is ever proposed by a planner. Artifex
 * assigns both itself: `verification.` in `verifierCapabilityOf` below, and
 * `mission` at intake in the API's mission-intake service, which is the contract
 * for task zero. They are ROLES the system stamps on a contract, not capability
 * categories the swarm has learned to do.
 *
 * Leaving them in does two separate kinds of damage:
 *
 *   - `staff()` resolves a producer's proposed category against the list, and
 *     `resolveCapability` returns the first candidate sharing ANY token. So a
 *     producer proposal can be staffed under a VERIFICATION capability — the
 *     design that exists to check the work would be hired to do it.
 *   - The planner is shown the list as suggestions, so it is invited to name a
 *     subtask `mission`, or `research.dogfood.1785397657889`.
 *
 * The rule is deliberately not a hand-written blocklist of observed junk. It is
 * the two places the CODE writes a category rather than the planner, and each is
 * derived from the constant that writes it.
 */
import { describe, expect, it } from 'vitest';

import { proposableCapabilities, verifierCapabilityOf } from './agent-creator.js';

describe('R38 — only capabilities a planner could have proposed are proposable', () => {
  it('drops the verification namespace the system generates for itself', () => {
    // Derived from the generator rather than typed as a literal: if the prefix
    // ever changes, this test moves with it instead of silently passing.
    const generated = verifierCapabilityOf('scientific terminology');

    expect(proposableCapabilities([generated, 'scientific terminology'])).toEqual([
      'scientific terminology',
    ]);
  });

  it('drops the mission role the API stamps on task zero', () => {
    expect(proposableCapabilities(['mission', 'hand tools overview'])).toEqual([
      'hand tools overview',
    ]);
  });

  it('preserves the registry ORDER, which is the evidence tie-break', () => {
    // `resolveCapability` takes the FIRST candidate sharing a token, and the
    // registry hands the list back ordered by observations. Filtering must not
    // become a re-sort: doing so would silently change which capability a
    // proposal joins.
    const known = ['mission', 'scientific terminology', 'verification.physics', 'hand tools overview'];

    expect(proposableCapabilities(known)).toEqual(['scientific terminology', 'hand tools overview']);
  });

  it('DISTRACTOR: a real capability that merely CONTAINS the word verification survives', () => {
    // The rule is the generated PREFIX, not the word. A swarm that learns to do
    // verification work as a subject — "verification of measurement data" — has
    // earned a capability like any other, and dropping it would delete a real
    // one to remove a synthetic one.
    expect(proposableCapabilities(['verification of measurement data'])).toEqual([
      'verification of measurement data',
    ]);
  });

  it('DISTRACTOR: a capability that merely contains the word mission survives', () => {
    // `mission` is excluded as the exact role name, not as a substring. "mission
    // planning" or "commission analysis" are ordinary capabilities.
    expect(proposableCapabilities(['mission planning', 'commission analysis'])).toEqual([
      'mission planning',
      'commission analysis',
    ]);
  });

  it('DISTRACTOR: a list of nothing but structural roles becomes empty, not unfiltered', () => {
    // The tempting "if the filter would empty the list, return it unfiltered"
    // guard is exactly wrong: a cold registry is the ordinary state of a young
    // system, and `resolveCapability` already degrades correctly to plain
    // normalisation on an empty list. Falling back to the raw list would hand
    // the planner `mission` precisely when it has nothing better to copy.
    expect(proposableCapabilities(['mission', 'verification.physics'])).toEqual([]);
  });
});

/**
 * The paste. `planner.ts` renders the suggestion list as
 * `knownCapabilities.join('; ')`, and the model copied a chunk of that sentence
 * straight into the `category` field. Two rows in the live ledger prove it:
 *
 *     scientific writing; verification.scientific_writing
 *     scientific writing; verification.scientific terminology
 *
 * Filtering the list (above) removes the `verification.*` half of this specific
 * paste but cannot stop pasting — any two capabilities can be copied together.
 * So the normaliser has to treat a category naming several capabilities the same
 * way it already treats a category naming a sub-specialisation: take the first
 * segment. The planner's own first answer is the one it meant.
 */
describe('R38 — a category that pasted the suggestion list normalises to its first capability', () => {
  it('takes the first segment of a semicolon-joined paste', async () => {
    const { capabilityOf } = await import('./agent-creator.js');

    expect(capabilityOf('scientific writing; verification.scientific_writing')).toBe(
      'scientific writing',
    );
  });

  it('DISTRACTOR: the existing slash rule still holds', async () => {
    // An additive change to a normaliser has to prove the old behaviour
    // survives — this function assigns design ids, so a change of meaning
    // re-partitions the whole registry.
    const { capabilityOf } = await import('./agent-creator.js');

    expect(capabilityOf('Technical Writing / Tool Identification')).toBe('technical writing');
  });

  it('DISTRACTOR: an ordinary category with no separator is untouched', async () => {
    const { capabilityOf } = await import('./agent-creator.js');

    expect(capabilityOf('Hand Tools Overview')).toBe('hand tools overview');
  });

  it('DISTRACTOR: a category that is ONLY a separator still never returns empty', async () => {
    // An empty capability hashes to one shared id and silently pools every
    // unlabelled task onto a single agent — the function's own stated hazard.
    const { capabilityOf } = await import('./agent-creator.js');

    expect(capabilityOf(';')).toBe('uncategorised');
  });
});
