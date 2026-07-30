/**
 * R38 AC-0 — clustering has to be ACTIVE, not a string transform.
 *
 * `capabilityOf` normalises a proposed category to its first segment. That
 * cannot merge categories the planner never named alike — and it never names
 * them alike. Live mission `77b83c64` asked for five hand-tool descriptions and
 * the planner produced:
 *
 *     Hand Tool Overview
 *     Tool Identification & Description
 *     Tool Description
 *     Tool Identification & Instruction
 *     Woodworking Tools
 *
 * Every one of those is *describe a hand tool*. Five tasks, five designs, no
 * clustering — while the criterion asks for "materially smaller".
 *
 * So the Agent Creator now resolves each proposed category against the
 * capabilities the registry ALREADY holds, and mints a new one only when nothing
 * matches. That is what makes a taxonomy converge instead of growing by one
 * entry per task, and it is what the dossier means by the taxonomy being a
 * learnable asset rather than whatever the model said this time.
 */
import { describe, expect, it } from 'vitest';

import { resolveCapability } from './agent-creator.js';

/** The exact categories the local model produced on mission `77b83c64`. */
const LIVE = [
  'Hand Tool Overview',
  'Tool Identification & Description',
  'Tool Description',
  'Tool Identification & Instruction',
  'Woodworking Tools',
];

/** Resolves a run of categories the way staffing does, accumulating what it learns. */
function cluster(categories: readonly string[]): string[] {
  const known: string[] = [];
  return categories.map((category) => {
    const capability = resolveCapability(category, known);
    if (!known.includes(capability)) known.push(capability);
    return capability;
  });
}

describe('R38 AC-0 — a proposed category joins a capability the registry already knows', () => {
  it('collapses the five live hand-tool categories onto ONE capability', () => {
    // The failing case, verbatim. This is the property the criterion is about,
    // measured on the data that falsified the previous attempt.
    const resolved = cluster(LIVE);

    expect(new Set(resolved).size).toBe(1);
    expect(resolved[0]).toBe('hand tool overview');
  });

  it('matches on a shared token, singular or plural', () => {
    // "Woodworking Tools" joins "hand tool overview" through tool/tools. Crude
    // singularisation rather than a stemmer: the input is short noun phrases,
    // and a stemmer would be a dependency earning its keep on nothing.
    expect(resolveCapability('Woodworking Tools', ['hand tool overview'])).toBe('hand tool overview');
  });

  it('DISTRACTOR: an unrelated capability is NOT absorbed', () => {
    // Over-clustering is the failure mode on this side: reuse of the wrong
    // specialist is worse than authoring a right one. "Physics" shares no token
    // with the tool capability and must stay its own.
    // `capabilityOf` takes the first segment, so this is 'physics' — which shares
    // no token with the tool capability and correctly stays its own.
    expect(resolveCapability('Physics/Chemistry of Writing Materials', ['hand tool overview']))
      .toBe('physics');
  });

  it('DISTRACTOR: with nothing known yet, the proposal becomes the capability', () => {
    // A cold registry must still produce a usable capability rather than an
    // empty string or a throw — the first mission in a new domain is the normal
    // case, not an error.
    expect(resolveCapability('Tool Description', [])).toBe('tool description');
  });

  it('DISTRACTOR: the FIRST known capability wins, and known is ordered by evidence', () => {
    // A proposal that could join two capabilities joins the better-established
    // one. The ordering is the registry's, by observations — so the tie-break is
    // the system's own evidence rather than alphabetical luck.
    const known = ['tool description', 'tool identification'];

    expect(resolveCapability('Tool Instruction', known)).toBe('tool description');
    expect(resolveCapability('Tool Instruction', [...known].reverse())).toBe('tool identification');
  });

  it('DISTRACTOR: three genuinely different subjects still yield three capabilities', () => {
    // The earlier live mission (`96cbda91`) was three unrelated subjects, where
    // three designs was arguably CORRECT. Clustering must not flatten that.
    const resolved = cluster([
      'Instructional Writing / Technical Description',
      'Physics/Chemistry of Writing Materials',
      'Culinary History',
    ]);

    expect(new Set(resolved).size).toBe(3);
  });

  it('DISTRACTOR: an empty proposal degrades to the named fallback, not to a match', () => {
    expect(resolveCapability('', ['hand tool overview'])).toBe('uncategorised');
  });
});
