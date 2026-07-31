/**
 * R26 AC-2 — the fast loop's reach is bounded BY CONSTRUCTION, not by convention.
 *
 * The criterion's own words, and they set the bar: a rule that holds because
 * every call site remembers to check it is a convention. This project has been
 * burned by that shape repeatedly — nine features have been found that were
 * present in the vocabulary and unreachable or unenforced in fact.
 *
 * So the bound is stated three times, in three places that fail independently:
 *
 *   1. the TYPE — `HotFixTarget.layer` is the literal `'worker'`, so a playbook
 *      target does not compile;
 *   2. the GUARD — `checkFastLoopReach` is a pure constitutional predicate, for
 *      the data that arrives at runtime having never been type-checked (a ledger
 *      replay, a repository read, a model's output);
 *   3. the STORE — a CHECK constraint on `hot_fix`, so a patch above the worker
 *      layer cannot be persisted even by code that bypassed the guard.
 *
 * This file covers (1) and (2). The store's constraint is proved in
 * memory-fabric's integration suite, by planting a row and watching Postgres
 * refuse it — the only way to test a claim about the database.
 *
 * Note the deliberate asymmetry with `proposal-emitter.ts`: a PROPOSAL may
 * target the constitution, because arguing that a rule should change is the
 * amendment protocol working. A hot-fix may not, because it ACTS. The
 * distinction between arguing and acting is the whole design, and the two
 * vocabularies differ for that reason rather than by oversight.
 */
import { describe, expect, it } from 'vitest';

import { ConstitutionViolation, assertFastLoopReach, checkFastLoopReach } from './constitution.js';

describe('R26 AC-2 — anything above the worker layer is refused', () => {
  it('permits a worker-layer role-instruction patch', async () => {
    // The rule has to be able to say yes, or the fast loop cannot exist.
    const ruling = checkFastLoopReach({
      layer: 'worker', kind: 'role_instructions', assetId: 'design-1',
    });

    expect(ruling.permitted).toBe(true);
  });

  it('permits a worker-layer knowledge patch', async () => {
    const ruling = checkFastLoopReach({
      layer: 'worker', kind: 'knowledge', assetId: 'knowledge-1',
    });

    expect(ruling.permitted).toBe(true);
  });

  it('refuses a meta-agent PLAYBOOK', async () => {
    // Named explicitly by the criterion. A playbook shapes how every future
    // agent is designed, so a mid-mission patch to one changes work nobody has
    // reviewed and that this mission will never see the results of.
    const ruling = checkFastLoopReach({
      layer: 'meta', kind: 'playbook', assetId: 'design-playbook',
    } as never);

    expect(ruling.permitted).toBe(false);
    expect(ruling.detail).toMatch(/playbook|worker layer/i);
  });

  it('refuses a REVIEWER RUBRIC', async () => {
    // Named explicitly by the criterion, and the sharpest case: a system that
    // can patch its own marking scheme mid-run can make any failure disappear
    // without improving anything. That is the yardstick problem (invariant #4)
    // in its fastest form.
    const ruling = checkFastLoopReach({
      layer: 'meta', kind: 'reviewer_rubric', assetId: 'gate-b',
    } as never);

    expect(ruling.permitted).toBe(false);
  });

  it('refuses the CONSTITUTIONAL CORE', async () => {
    const ruling = checkFastLoopReach({
      layer: 'core', kind: 'constitution', assetId: 'review-independence',
    } as never);

    expect(ruling.permitted).toBe(false);
  });

  it('DISTRACTOR: an UNKNOWN layer is refused even when its KIND is a permitted one', async () => {
    // The one that decides whether this is a bound or a blocklist. A guard
    // written as "refuse meta and core" permits every layer nobody thought of,
    // and new layers are exactly what a self-improving system grows.
    //
    // The `kind` here must be a PERMITTED one, and that is the whole point of
    // this fixture. A first version used `kind: 'planner_prompt'`, and the
    // blocklist mutant survived all 27 tests — the kind check refused it and the
    // layer check was never exercised. Two guards masking each other, the same
    // shape that hid a bug in R28's selection query.
    //
    // The Orchestrator has role instructions too, and they are above the worker
    // layer. Only `worker` passes.
    const ruling = checkFastLoopReach({
      layer: 'orchestration', kind: 'role_instructions', assetId: 'orchestrator',
    } as never);

    expect(ruling.permitted, 'an unrecognised layer was permitted by default').toBe(false);
    expect(ruling.detail).toMatch(/worker layer only|not 'orchestration'/i);
  });

  it('DISTRACTOR: the worker layer with an unknown KIND is refused too', async () => {
    // The same argument one level down. "Worker layer" is not a blank cheque
    // over everything a worker touches — its budget and its contract are not
    // its prompt, and neither is the fast loop's to rewrite.
    const ruling = checkFastLoopReach({
      layer: 'worker', kind: 'budget_ceiling', assetId: 'design-1',
    } as never);

    expect(ruling.permitted, 'an unrecognised worker-layer kind was permitted').toBe(false);
  });

  it('assertFastLoopReach throws a ConstitutionViolation carrying its clause', async () => {
    // Call sites that cannot continue need the throwing form, and the ledger
    // needs to record WHICH clause was breached rather than "something failed".
    expect(() =>
      assertFastLoopReach({ layer: 'core', kind: 'constitution', assetId: 'x' } as never),
    ).toThrow(ConstitutionViolation);

    try {
      assertFastLoopReach({ layer: 'meta', kind: 'playbook', assetId: 'x' } as never);
      expect.unreachable('the guard permitted a meta-layer patch');
    } catch (error) {
      expect((error as ConstitutionViolation).clause).toBe('fast-loop-reach');
    }
  });
});
