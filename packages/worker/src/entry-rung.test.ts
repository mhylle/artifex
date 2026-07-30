/**
 * R36 — the error class picks the ENTRY rung, and the stall counter guards
 * repetition.
 *
 * Both inputs already existed and neither was read where it mattered.
 * `errorClass` was set on every finding, counted by the learning projection and
 * written into the `escalation.rung_climbed` payload, while the ladder did
 * `rungIndex += 1` unconditionally — so a specification fault climbed from rung
 * 1 exactly like an execution slip and rehearsed the mistake it had just been
 * told about. `ErrorClassSchema`'s own doc comment says it "selects the
 * escalation rung"; the comment was the requirement and the code was the defect.
 *
 * `stallLimit` was copied parent-to-child and read nowhere at all.
 *
 * The two rules coexist because they constrain different things: AC-1 fixes the
 * ENTRY rung by class, and the loop's existing invariant ("one failure climbs
 * exactly one rung") governs every step after it. So a task jumps to where its
 * failure belongs and then walks from there — it never walks BACKWARDS to a
 * cheaper remedy it has already been told will not work.
 */
import type { ErrorClass, EscalationRung } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { entryRungFor, isStalled, worstClass } from './escalation.js';

const FULL: EscalationRung[] = [
  'retry_same',
  'retry_higher_tier',
  'different_agent',
  'agent_redesign',
  're_decomposition',
  'human_review',
];

describe('R36 AC-0 — a specification fault enters at re-decomposition', () => {
  it('jumps straight to re_decomposition rather than rung 1', async () => {
    expect(entryRungFor('specification_fault', FULL)).toBe(FULL.indexOf('re_decomposition'));
  });

  it('a coordination failure also re-decomposes — siblings that did not fit is a PLAN fault', () => {
    // The plan said these pieces would compose. They did not. Retrying either
    // piece alone cannot discover the seam between them.
    expect(entryRungFor('coordination_failure', FULL)).toBe(FULL.indexOf('re_decomposition'));
  });
});

describe('R36 AC-1 — the entry rung is a function of the CLASS, not of attempt count', () => {
  it('an execution slip enters at rung 1 — retry with the verdict as feedback', () => {
    expect(entryRungFor('execution_error', FULL)).toBe(0);
  });

  it('a capability gap enters at a different agent, not a retry', () => {
    // Rung 2. The same agent retried is the same agent: if it lacks the
    // capability, another attempt by it is a rehearsal, not a remedy.
    const rung = entryRungFor('capability_gap', FULL);

    expect(FULL[rung]).toBe('different_agent');
    expect(rung).toBeGreaterThan(0);
  });

  it('a schema violation buys a bigger model — it is a formatting failure, not a thinking one', () => {
    expect(FULL[entryRungFor('schema_violation', FULL)]).toBe('retry_higher_tier');
  });

  it('DISTRACTOR: a rung the ladder lacks falls back to rung 1, not to the TOP', () => {
    // A contract may authorise only a short ladder. Returning a rung it never
    // granted would let the loop take a remedy the contract withheld.
    //
    // A first version only asserted the index was in range, which a fallback to
    // `ladder.length - 1` also satisfies — and that fallback would silently send
    // every unmappable failure straight to the most expensive remedy available.
    // A contract that granted only cheap rungs did not quietly grant the top one.
    const short: EscalationRung[] = ['retry_same', 'retry_higher_tier'];

    expect(entryRungFor('specification_fault', short)).toBe(0);
  });

  it('a STALL enters at a different agent — a plain retry is the one remedy guaranteed not to help', () => {
    // Without this the loop would prescribe an identical attempt as the remedy
    // for an identical attempt having failed.
    expect(FULL[entryRungFor('stall', FULL)]).toBe('different_agent');
    expect(entryRungFor('stall', FULL)).toBeGreaterThan(entryRungFor('execution_error', FULL));
  });

  it('DISTRACTOR: a class with no mapping falls back to rung 1 rather than to surrender', () => {
    // Unknown means unknown. Escalating an unclassified failure straight to the
    // top would spend every remedy on a problem nobody has diagnosed.
    expect(entryRungFor('verification_failure', FULL)).toBeLessThanOrEqual(1);
  });

  it('DISTRACTOR: budget exhaustion does NOT enter cheaply — no retry can afford it', () => {
    // A task that ran out of budget cannot be fixed by spending more of it in
    // the same way. This is the one class where the cheap rungs are pointless.
    expect(entryRungFor('budget_exhaustion', FULL)).toBeGreaterThan(FULL.indexOf('different_agent'));
  });
});

describe('R36 AC-2 — the stall counter trips before a third identical attempt', () => {
  const attempt = (tier: number, designId: string, findings: ErrorClass[]) => ({
    tier, designId, errorClasses: findings,
  });

  it('trips when the same task was attempted the same way twice', () => {
    const history = [
      attempt(1, 'd-1', ['execution_error']),
      attempt(1, 'd-1', ['execution_error']),
    ];

    expect(isStalled(history, 2)).toBe(true);
  });

  it('DISTRACTOR: two attempts that DIFFER are progress, not a stall', () => {
    // A tier bump changed what ran. That is the ladder working, and calling it
    // a stall would trip on exactly the mechanism meant to break stalls.
    const history = [
      attempt(1, 'd-1', ['execution_error']),
      attempt(2, 'd-1', ['execution_error']),
    ];

    expect(isStalled(history, 2)).toBe(false);
  });

  it('DISTRACTOR: a different FAILURE is progress even at the same tier and agent', () => {
    // The task moved: it now fails somewhere else. That is information, and the
    // next attempt has something new to work with.
    const history = [
      attempt(1, 'd-1', ['execution_error']),
      attempt(1, 'd-1', ['schema_violation']),
    ];

    expect(isStalled(history, 2)).toBe(false);
  });

  it('DISTRACTOR: one attempt is never a stall — there is nothing to repeat yet', () => {
    expect(isStalled([attempt(1, 'd-1', ['execution_error'])], 2)).toBe(false);
  });

  it('DISTRACTOR: the limit is the CONTRACT stallLimit, not a constant', () => {
    // A contract that tolerates three identical attempts must get three. Baking
    // in 2 would make `stallLimit` decorative — which is exactly what it was.
    const history = [
      attempt(1, 'd-1', ['execution_error']),
      attempt(1, 'd-1', ['execution_error']),
    ];

    expect(isStalled(history, 3)).toBe(false);
    expect(isStalled([...history, attempt(1, 'd-1', ['execution_error'])], 3)).toBe(true);
  });

  it('DISTRACTOR: only the MOST RECENT run of identical attempts counts', () => {
    // Two identical attempts, then a change, then ONE attempt matching the
    // earlier pair. The run from the end is length 1, so this is not a stall —
    // but counting matches anywhere in history would find three and trip on a
    // task that already climbed out of that rut.
    //
    // The trailing attempt is what makes this test bite: an earlier version
    // ended at the differing attempt, where "count anywhere" and "count the
    // trailing run" happen to agree, so a mutant replacing the `break` with a
    // `continue` survived.
    const history = [
      attempt(1, 'd-1', ['execution_error']),
      attempt(1, 'd-1', ['execution_error']),
      attempt(2, 'd-2', ['capability_gap']),
      attempt(1, 'd-1', ['execution_error']),
    ];

    expect(isStalled(history, 2)).toBe(false);
  });

  it('DISTRACTOR: enough history but a SHORT trailing run is not a stall', () => {
    // Four attempts against a limit of 3, where only the last two match. The
    // length guard passes, so the trailing-run count is the only thing standing
    // between this and a false trip — and a hardcoded limit of 2 would trip it.
    const history = [
      attempt(1, 'd-1', ['execution_error']),
      attempt(2, 'd-2', ['capability_gap']),
      attempt(3, 'd-3', ['execution_error']),
      attempt(3, 'd-3', ['execution_error']),
    ];

    expect(isStalled(history, 3)).toBe(false);
  });
});

describe('R36 — the WORST class among findings picks the entry rung', () => {
  it('a verdict naming both a spec fault and a slip enters at the spec fault rung', () => {
    // Entering at the slip's cheap rung would retry a description already known
    // to be broken, and the slip would very likely recur because its cause was
    // never touched.
    expect(worstClass(['execution_error', 'specification_fault'], FULL)).toBe('specification_fault');
  });

  it('DISTRACTOR: order does not decide it — the same pair reversed gives the same answer', () => {
    // Taking the FIRST finding's class would make the entry rung depend on the
    // order a judge happened to list its findings in.
    expect(worstClass(['specification_fault', 'execution_error'], FULL)).toBe('specification_fault');
  });

  it('DISTRACTOR: no findings means no diagnosis — fall back rather than guess', () => {
    expect(worstClass([], FULL)).toBeNull();
  });
});
