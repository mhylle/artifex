/**
 * R34 — sampling the intent tier, and why it exists.
 *
 * On live mission `e7dddf91` the evaluative model returned red flags that were
 * the PROMPT'S OWN EXAMPLE PHRASES echoed back verbatim — "an answer shaped like
 * a verification rather than an answer" — on both attempts. It was completing a
 * pattern, not inspecting a deliverable.
 *
 * The prompt no longer offers phrasings to copy and now demands each flag quote
 * the deliverable. But a prompt fix alone is a hope, and a red flag DISCARDS
 * work that satisfied every criterion, so a single confident sample must not be
 * able to throw good work away on its own.
 *
 * Unanimity in the safe direction, which here is PASSING: a false flag destroys
 * good work outright, while a missed one leaves work that already cleared both
 * the mechanical and the criteria tiers.
 */
import { describe, expect, it } from 'vitest';

import { sampledIntent } from './runtime.js';
import type { IntentJudge } from './reviewer.js';

const INPUT = { contract: {} as never, bundle: {} as never };

/** Replies in sequence, so each sample can differ. */
function scripted(replies: Array<Awaited<ReturnType<IntentJudge['assess']>> | 'throw'>): IntentJudge {
  let i = 0;
  return {
    async assess() {
      const reply = replies[Math.min(i, replies.length - 1)]!;
      i += 1;
      if (reply === 'throw') throw new Error('model unavailable');
      return reply;
    },
  };
}

const ok = { servesIntent: true, detail: 'fine', redFlags: [] as string[] };
const flagged = (flag: string) => ({ servesIntent: true, detail: 'fine', redFlags: [flag] });
const condemn = { servesIntent: false, detail: 'misses the point', redFlags: [] as string[] };

describe('R34 — the intent tier is sampled, and unanimity is required to condemn', () => {
  it('keeps a red flag every sample raised', async () => {
    const judge = sampledIntent(scripted([flagged('quotes "42" with no units'), flagged('quotes "42" with no units'), flagged('quotes "42" with no units')]), 3);

    expect((await judge.assess(INPUT)).redFlags).toHaveLength(1);
  });

  it('DROPS a flag only one sample raised — the e7dddf91 failure', async () => {
    // One sample parroting an example phrase must not discard work three
    // separate checks were happy with.
    const judge = sampledIntent(scripted([flagged('an answer shaped like a verification'), ok, ok]), 3);

    expect((await judge.assess(INPUT)).redFlags).toEqual([]);
  });

  it('matches flags across samples despite wording differences', async () => {
    // Two samples rarely word the same observation identically, and comparing
    // raw strings would make unanimity unreachable in practice — which would
    // silently disable the whole mechanism while looking like it worked.
    const judge = sampledIntent(scripted([
      flagged('Quotes "42" with no units.'),
      flagged('quotes "42" with no units'),
      flagged('QUOTES "42" WITH NO UNITS!'),
    ]), 3);

    expect((await judge.assess(INPUT)).redFlags).toHaveLength(1);
  });

  it('condemns intent only when EVERY sample condemns it', async () => {
    const judge = sampledIntent(scripted([condemn, condemn, condemn]), 3);

    expect((await judge.assess(INPUT)).servesIntent).toBe(false);
  });

  it('DISTRACTOR: a single dissenting sample does NOT condemn', async () => {
    const judge = sampledIntent(scripted([condemn, ok, ok]), 3);

    expect((await judge.assess(INPUT)).servesIntent).toBe(true);
  });

  it('DISTRACTOR: a condemning verdict carries the CONDEMNING sample reason', async () => {
    // Reporting the passing sample's "fine" alongside a fail would leave the
    // operator reading a verdict whose reason contradicts its outcome.
    const judge = sampledIntent(scripted([condemn, condemn, condemn]), 3);

    expect((await judge.assess(INPUT)).detail).toMatch(/misses the point/);
  });

  it('DISTRACTOR: one sample repeating itself is not agreement between samples', async () => {
    // A run listing the same flag twice must count once, or a single chatty
    // sample could manufacture unanimity by itself.
    //
    // Deliberately TWO samples. A first version used three, where a doubled
    // flag reaches a count of 2 against a required 3 and is dropped by the
    // arithmetic rather than by the dedup — so removing the dedup entirely still
    // passed. At two samples the doubled flag hits exactly the threshold, which
    // is the only shape that actually tests the rule.
    const judge = sampledIntent(scripted([
      { servesIntent: true, detail: 'fine', redFlags: ['quotes \"42\"', 'quotes \"42\"'] },
      ok,
    ]), 2);

    expect((await judge.assess(INPUT)).redFlags).toEqual([]);
  });

  it('DISTRACTOR: a PASSING verdict carries a passing sample reason, not a dissenter one', async () => {
    // An operator reading "misses the point" on a verdict that passed has been
    // told the opposite of what happened.
    const judge = sampledIntent(scripted([condemn, ok, ok]), 3);

    const out = await judge.assess(INPUT);

    expect(out.servesIntent).toBe(true);
    expect(out.detail).toBe('fine');
  });

  it('DISTRACTOR: a throwing sample is no complaint, not a condemnation', async () => {
    // Failing open. A model outage must not discard work that passed the
    // mechanical and criteria tiers.
    const judge = sampledIntent(scripted(['throw', 'throw', 'throw']), 3);

    const out = await judge.assess(INPUT);

    expect(out.servesIntent).toBe(true);
    expect(out.redFlags).toEqual([]);
  });

  it('DISTRACTOR: surviving samples still decide when one throws', async () => {
    // Treating a partial outage as a total one would make the tier flicker off
    // whenever a single call failed.
    const judge = sampledIntent(scripted(['throw', condemn, condemn]), 3);

    expect((await judge.assess(INPUT)).servesIntent).toBe(false);
  });
});
