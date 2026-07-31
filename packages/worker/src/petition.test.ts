/**
 * R29 — the amendment protocol's other half.
 *
 * R11 proved the emitter CANNOT mutate the Constitution. How a petition is
 * evaluated and ratified did not exist: `ProposalEmitter` was complete, tested,
 * and never constructed (defect `d08191c8`), so invariant #4's only outward
 * channel had no producer at all.
 *
 * The dossier's sentence is the specification: "Petitions argued from evidence,
 * evaluated on the sealed bench, ratified out-of-band per the autonomy dial."
 * Three clauses, and the middle one is the load-bearing one — R25 split the
 * bench precisely so that "nothing that optimizes against a benchmark may also
 * own it", and a petition evaluated on the OPEN slice would be scored on the
 * very cases the learner has been tuning against.
 */
import { describe, expect, it } from 'vitest';

import {
  evaluateOnSealedBench,
  petitionRefusal,
  petitionFromWeakSpots,
  ratificationState,
  type Petition,
} from './petition.js';

const petition = (over: Partial<Petition> = {}): Petition => ({
  missionId: 'aaaaaaaa-0000-4000-8000-000000000000',
  title: 'Raise the floor for root decomposition',
  rationale: 'Tier-1 planners run away on nested schemas.',
  evidenceEventIds: ['e-1', 'e-2'],
  targets: 'constitution',
  ...over,
});

const sealed = (caseId: string) => ({ caseId, slice: 'sealed' as const });

describe('R29 AC-0 — a petition is ARGUED FROM EVIDENCE', () => {
  it('accepts a petition carrying ledger evidence', async () => {
    expect(petitionRefusal(petition())).toBeNull();
  });

  it('REFUSES a petition with no evidence', async () => {
    // "Petitions argued from evidence." An unevidenced petition is an opinion,
    // and the emitter's own doc comment already says so about proposals.
    expect(petitionRefusal(petition({ evidenceEventIds: [] }))).toMatch(/evidence/i);
  });

  it('REFUSES a petition with no rationale', async () => {
    expect(petitionRefusal(petition({ rationale: '   ' }))).toMatch(/rationale|argued/i);
  });
});

describe('R29 AC-0 — evaluation is bound to the SEALED slice', () => {
  it('evaluates against sealed cases and reports the tally', async () => {
    const result = evaluateOnSealedBench(petition(), [
      { case: sealed('c-1'), supportsPetition: true },
      { case: sealed('c-2'), supportsPetition: true },
      { case: sealed('c-3'), supportsPetition: false },
    ]);

    expect(result.evaluated).toBe(3);
    expect(result.supported).toBe(2);
  });

  it('REFUSES to evaluate an OPEN case, however it was labelled', async () => {
    // The whole reason R25 split the bench. The open slice is what the Learning
    // Agent optimises against, so a petition scored on it would be graded by the
    // thing it has been tuning — and this is a petition to change the rules,
    // which is exactly when that matters most.
    //
    // Refused rather than filtered: silently dropping the open cases would let a
    // caller believe a 30-case evaluation happened when 3 cases were scored.
    expect(() =>
      evaluateOnSealedBench(petition(), [
        { case: sealed('c-1'), supportsPetition: true },
        { case: { caseId: 'c-open', slice: 'open' }, supportsPetition: true },
      ]),
    ).toThrow(/sealed/i);
  });

  it('DISTRACTOR: an evaluation over NO cases is unevaluated, not unanimous', async () => {
    // Zero of zero is 100% by arithmetic and nothing by evidence. A petition
    // that "passed" an empty bench would be the strongest possible argument
    // built on no measurement at all.
    const result = evaluateOnSealedBench(petition(), []);

    expect(result.verdict).toBe('unevaluated');
    expect(result.supported).toBe(0);
  });

  it('DISTRACTOR: a petition the bench does not support is reported as unsupported', async () => {
    // The rule must be able to say no, and BOTH verdicts must be reachable — a
    // reporter that always said "supported" would pass a test that only ever
    // checked the supported case.
    const result = evaluateOnSealedBench(petition(), [
      { case: sealed('c-1'), supportsPetition: false },
      { case: sealed('c-2'), supportsPetition: false },
    ]);

    expect(result.verdict).toBe('unsupported');
  });

  it('a MAJORITY is not enough — support must be unanimous on the sealed slice', async () => {
    // This is a change to the rules the system is measured by. ADR-0010's
    // unanimity applies in the direction that preserves the STATUS QUO here:
    // the conservative outcome for an amendment is not to amend, so one sealed
    // case arguing against is enough to leave the Constitution alone.
    const result = evaluateOnSealedBench(petition(), [
      { case: sealed('c-1'), supportsPetition: true },
      { case: sealed('c-2'), supportsPetition: true },
      { case: sealed('c-3'), supportsPetition: false },
    ]);

    expect(result.verdict).toBe('unsupported');
  });
});

describe('R29 AC-1 — a petition REMAINS a proposal until a human decides', () => {
  it('is pending when no decision has been recorded', async () => {
    expect(ratificationState('pet-1', []).status).toBe('pending');
  });

  it('is ratified only when a human decision says so', async () => {
    const state = ratificationState('pet-1', [
      { petitionId: 'pet-1', decision: 'ratified', decidedBy: 'operator' },
    ]);

    expect(state.status).toBe('ratified');
  });

  it('is rejected when the human says no', async () => {
    // Both outcomes, because a reader that mapped every decision to "ratified"
    // would pass a test that only checked the yes case — and this is the one
    // place in the system where a wrong yes changes the rules themselves.
    const state = ratificationState('pet-1', [
      { petitionId: 'pet-1', decision: 'rejected', decidedBy: 'operator' },
    ]);

    expect(state.status).toBe('rejected');
  });

  it('DISTRACTOR: a decision by the LEARNING AGENT does not ratify anything', async () => {
    // Invariant #4 in one assertion. "Ratified out-of-band" means by someone
    // other than the thing proposing, and a decision the learner recorded for
    // itself is not out-of-band by any reading.
    const state = ratificationState('pet-1', [
      { petitionId: 'pet-1', decision: 'ratified', decidedBy: 'learning_agent' },
    ]);

    expect(state.status, 'the learner ratified its own amendment').toBe('pending');
    expect(state.refused).toMatch(/out-of-band|learner|itself/i);
  });

  it('DISTRACTOR: a decision about a DIFFERENT petition leaves this one pending', async () => {
    const state = ratificationState('pet-1', [
      { petitionId: 'pet-other', decision: 'ratified', decidedBy: 'operator' },
    ]);

    expect(state.status).toBe('pending');
  });
});

/**
 * R29 AC-2 (DISTRACTOR) — no quantity of evidence lets the learner ratify.
 *
 * Asserted STRUCTURALLY, not by testing that a method nobody wrote is absent.
 * The difference matters: "there is no `apply`" is true of every typo, whereas
 * "the emitter's entire surface is one method that appends and returns" is a
 * property a future edit would have to break deliberately.
 */
describe('R29 AC-2 — the learner cannot ratify its own amendment', () => {
  it('the constitutional core is FROZEN, so a write throws rather than silently failing', async () => {
    const { CONSTITUTIONAL_CORE } = await import('./proposal-emitter.js');

    expect(Object.isFrozen(CONSTITUTIONAL_CORE)).toBe(true);
    expect(() => {
      (CONSTITUTIONAL_CORE as unknown as Record<string, unknown>)['reviewIndependence'] = false;
    }).toThrow();
    expect(CONSTITUTIONAL_CORE.reviewIndependence, 'the core changed').toBe(true);
  });

  it('the emitter offers NO way to apply, adopt or ratify — its whole surface is propose', async () => {
    // The structural form. A test asserting `emitter.apply === undefined` passes
    // for a hundred reasons; asserting the surface is EXACTLY `propose` fails the
    // moment anyone adds a second verb, which is when it should.
    const { ProposalEmitter } = await import('./proposal-emitter.js');

    const surface = Object.getOwnPropertyNames(ProposalEmitter.prototype)
      .filter((n) => n !== 'constructor')
      .sort();

    expect(surface).toEqual(['propose']);
  });

  it('DISTRACTOR: overwhelming evidence still leaves the petition PENDING', async () => {
    // The criterion's own wording — "a petition with overwhelming supporting
    // evidence". A unanimous sealed-bench verdict is the strongest argument the
    // system can produce, and it still ratifies nothing.
    const strong = evaluateOnSealedBench(petition(), [
      { case: sealed('c-1'), supportsPetition: true },
      { case: sealed('c-2'), supportsPetition: true },
      { case: sealed('c-3'), supportsPetition: true },
    ]);

    expect(strong.verdict).toBe('supported');
    // …and yet:
    expect(ratificationState('pet-1', []).status, 'evidence alone ratified an amendment').toBe('pending');
  });
});

describe('R29 AC-0 — the trigger: a weak spot the learner cannot remedy itself', () => {
  const spot = (over: Record<string, unknown> = {}) => ({
    category: 'summarising', severity: 3, observations: 4,
    reasons: ['spent 58 of 60 budget (97%) — a budget-versus-value outlier'],
    ...over,
  });

  it('petitions when a category is budget-bound', async () => {
    const p = petitionFromWeakSpots({
      missionId: 'aaaaaaaa-0000-4000-8000-000000000000',
      weakSpots: [spot()],
      evidenceEventIds: ['e-1'],
    });

    expect(p, 'no petition where the learner has no remedy of its own').not.toBeNull();
    expect(p?.targets).toBe('constitution');
    expect(petitionRefusal(p!), 'the petition it files would be refused').toBeNull();
  });

  it('DISTRACTOR: a weak spot the learner CAN remedy does not petition', async () => {
    // The learner may rewrite prompts, playbooks and taxonomies freely. An
    // escalation hot spot is addressable that way, so petitioning about it would
    // ask a human to ratify something the learner is already allowed to do —
    // and an amendment protocol that fired routinely would make the Constitution
    // a suggestion.
    const p = petitionFromWeakSpots({
      missionId: 'aaaaaaaa-0000-4000-8000-000000000000',
      weakSpots: [spot({ reasons: ['7 escalations across 9 verdicts — an escalation hot spot'] })],
      evidenceEventIds: ['e-1'],
    });

    expect(p).toBeNull();
  });

  it('DISTRACTOR: no weak spots at all means no petition', async () => {
    expect(petitionFromWeakSpots({
      missionId: 'aaaaaaaa-0000-4000-8000-000000000000',
      weakSpots: [], evidenceEventIds: ['e-1'],
    })).toBeNull();
  });

  it('DISTRACTOR: no evidence means no petition, rather than an unarguable one', async () => {
    // Filing something `petitionRefusal` would reject is worse than filing
    // nothing: it puts an unarguable item in front of a human.
    expect(petitionFromWeakSpots({
      missionId: 'aaaaaaaa-0000-4000-8000-000000000000',
      weakSpots: [spot()], evidenceEventIds: [],
    })).toBeNull();
  });
});
