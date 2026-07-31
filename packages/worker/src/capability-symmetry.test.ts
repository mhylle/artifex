/**
 * Defect `e34d178e` — both sides of the capability comparison must be normalised.
 *
 * `resolveCapability` normalised the PROPOSAL with `capabilityOf` (first segment,
 * lowercase, punctuation stripped) and then compared its tokens against the
 * registry category **verbatim**. Two sides of one comparison, normalised
 * differently: house find-shape (k).
 *
 * Measured against the live registry before the fix: **12 of 24 proposable
 * categories were unreachable for reuse** — every token they own is capitalised
 * or punctuated, so no proposal could ever match them. Among them
 * `Description Task`, `Hand Tool Overview`, `Tool Identification & Description`,
 * `Instructional Writing / Technical Description`. A thirteenth,
 * `Physics/Chemistry of Writing Materials`, was matchable only through the
 * stopword `of`.
 *
 * Those rows carry the observations. Making them unreachable does not merely
 * lose a merge — it silently caps R38's "reuse beats creation whenever the
 * record supports it" at the rows that happen to be lowercase.
 *
 * **The defect's own warning was measured and did not hold.** It said
 * symmetrising without also tightening the token rule would make over-merge
 * worse. Simulated over all 115 distinct raw proposals in the live ledger,
 * against a registry that GROWS as production's does: 31 capabilities before,
 * 30 after, 9 proposals resolving differently — and every one of the 9 inspected
 * individually is a correct merge (five physics proposals joining the physics
 * row; `Culinary Instruction` and `Shogi Instruction` joining an instruction
 * capability; `Kitchenware Description` and `Description Task` joining a
 * description capability). The prediction is retracted, with the measurement.
 *
 * The tightening it proposed — matching on the HEAD noun instead of any shared
 * token — was measured and REJECTED. It splits R38 AC-0's own live evidence:
 * the five hand-tool categories from mission `77b83c64` that the criterion is
 * pinned on become four capabilities instead of one, because `overview`,
 * `description` and `instruction` are different heads. See ADR-0019.
 */
import { describe, expect, it } from 'vitest';

import { capabilityOf, resolveCapability } from './agent-creator.js';

/** Registry categories exactly as the live `agent_design` table holds them. */
const LIVE_REGISTRY = [
  'Technical Description / Instructional Content',
  'Hand Tool Overview',
  'Description Task',
];

describe('defect e34d178e — a capitalised registry category is reachable for reuse', () => {
  it('resolves a proposal onto a capitalised category it shares a capability with', () => {
    // The live shape: the registry holds `Technical Description / Instructional
    // Content` (2 observations) and the planner proposes another description
    // task. Before the fix `Description` never equalled `description`, so the
    // row with the evidence could not be joined.
    expect(resolveCapability('Kitchenware Description', LIVE_REGISTRY)).toBe(
      'Technical Description / Instructional Content',
    );
  });

  it('returns the category VERBATIM, because that is the key the registry is queried by', () => {
    // `bestForCategory(capability)` looks the row up by exact string. Returning
    // a normalised form would find nothing and author a fresh design — reuse
    // that resolves correctly and then fails to reuse.
    const resolved = resolveCapability('Tool Description', ['Hand Tool Overview']);

    expect(resolved).toBe('Hand Tool Overview');
    expect(resolved, 'the candidate was normalised on the way out').not.toBe(
      capabilityOf('Hand Tool Overview'),
    );
  });

  it('DISTRACTOR: the candidate is normalised by capabilityOf, not merely lowercased', () => {
    // `capabilityOf` takes the FIRST SEGMENT, so `Physics/Chemistry of Writing
    // Materials` is the capability `physics` — everything after the slash is the
    // subject it happened to be about, which is exactly what the first-segment
    // rule exists to drop.
    //
    // A lazy fix that lowercased the candidate instead would leave `writing` and
    // `materials` as live tokens, and a writing task would be staffed by a
    // physics design. Both halves are asserted: the physics proposal MUST join
    // it and the writing proposal MUST NOT.
    const known = ['Physics/Chemistry of Writing Materials'];

    expect(resolveCapability('Physics / Data Analysis', known)).toBe(
      'Physics/Chemistry of Writing Materials',
    );
    expect(resolveCapability('Writing Materials Guide', known)).toBe('writing materials guide');
  });

  it('DISTRACTOR: an unrelated capitalised category is still NOT absorbed', () => {
    // Normalising both sides increases matching, and the failure mode on this
    // side is reuse of the wrong specialist. A capability sharing no token stays
    // its own however the case falls.
    expect(resolveCapability('Sailing Fundamentals', LIVE_REGISTRY)).toBe('sailing fundamentals');
  });

  it('DISTRACTOR: the old lowercase matching still works, unchanged', () => {
    // The change is additive. R38 AC-0's live evidence — five names for one job
    // from mission `77b83c64` — must still collapse onto one capability.
    const known: string[] = [];
    const resolved = [
      'Hand Tool Overview',
      'Tool Identification & Description',
      'Tool Description',
      'Tool Identification & Instruction',
      'Woodworking Tools',
    ].map((category) => {
      const capability = resolveCapability(category, known);
      if (!known.includes(capability)) known.push(capability);
      return capability;
    });

    expect(new Set(resolved).size, 'the five-hand-tool collapse regressed').toBe(1);
    expect(resolved[0]).toBe('hand tool overview');
  });

  it('DISTRACTOR: evidence order still decides between two candidates it could join', () => {
    // `known` arrives in the registry's observation order, so a proposal that
    // could join two capabilities joins the better-established one. Asserted in
    // BOTH orders — a rule that ignored the ordering would pass one of them by
    // luck.
    const known = ['Tool Description', 'Tool Identification'];

    expect(resolveCapability('Tool Instruction', known)).toBe('Tool Description');
    expect(resolveCapability('Tool Instruction', [...known].reverse())).toBe('Tool Identification');
  });
});
