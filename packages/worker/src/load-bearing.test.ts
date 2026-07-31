/**
 * R30 AC-2 — a carried assumption escalates the moment it starts to matter.
 *
 * *"Given the dial permits carrying a low-stakes ambiguity as a flagged
 * assumption, when that assumption later becomes load-bearing for a task's
 * outcome, then it is escalated at that moment rather than at delivery."*
 *
 * **The trigger this file does NOT use, and why.** The plan carried into this
 * iteration was to match a flagged assumption against the assumptions a worker
 * declares for itself (R40). Measured first: 105 of 240 `task.executed` events
 * do carry declared assumptions, so there is fuel — but they are free-text prose
 * in the worker's own words, and an intake question is free-text prose in the
 * model's. Matching one to the other by string or token overlap is the
 * "measurement tool that lies" shape, and this project's own rule is to judge
 * against criteria and never diff strings.
 *
 * **What is used instead is structural and already computed.** Every intake
 * question is raised `about` a specific criterion, and the coverage partition
 * already assigns each mission criterion to the tasks that will satisfy it. So
 * an ambiguity about `m-1` becomes load-bearing exactly when a task carrying
 * `m-1` produces its outcome — no model call, no string matching, and the moment
 * is the task's, not the delivery's.
 */
import { describe, expect, it } from 'vitest';

import { loadBearingNow } from './load-bearing.js';
import type { FlaggedAssumption } from './load-bearing.js';

const flagged = (about: string, question = 'Which audience?'): FlaggedAssumption => ({
  about,
  question,
  stakes: 'low',
});

describe('R30 AC-2 — which carried assumptions just became load-bearing', () => {
  it('fires when a task carries the criterion the assumption is about', () => {
    const now = loadBearingNow([flagged('m-1')], ['m-1'], new Set());

    expect(now).toHaveLength(1);
    expect(now[0]?.about).toBe('m-1');
  });

  it('DISTRACTOR: stays silent for a task that carries a DIFFERENT criterion', () => {
    // Both sides of the discriminator. A rule that fired on every task would
    // pass the first test and make the escalation meaningless.
    expect(loadBearingNow([flagged('m-1')], ['m-2'], new Set())).toEqual([]);
    expect(loadBearingNow([flagged('m-1')], ['m-1', 'm-2'], new Set())).toHaveLength(1);
  });

  it('DISTRACTOR: fires ONCE — the moment it first matters, not on every later task', () => {
    // "Escalated at that moment" is a moment, singular. A second task covering
    // the same criterion must not re-raise it, or the attention queue refills
    // with an item the operator has already been shown.
    const already = new Set(['m-1']);

    expect(loadBearingNow([flagged('m-1')], ['m-1'], already)).toEqual([]);
  });

  it('DISTRACTOR: no flagged assumptions means nothing fires, whatever the task carries', () => {
    // The common case by far. A mission with a fully specified request must not
    // pay for this at all.
    expect(loadBearingNow([], ['m-1', 'm-2'], new Set())).toEqual([]);
  });

  it('carries the question text through, so the escalation is actionable', () => {
    // An escalation that says "an assumption became load-bearing" without saying
    // WHICH is a notification, not a decision the operator can make.
    const now = loadBearingNow([flagged('m-2', 'How long should it be?')], ['m-2'], new Set());

    expect(now[0]?.question).toBe('How long should it be?');
  });

  it('DISTRACTOR: several assumptions on one criterion all fire together', () => {
    // A fixture with ONE item cannot tell "returns the matches" from "returns
    // the first match".
    const now = loadBearingNow(
      [flagged('m-1', 'Which audience?'), flagged('m-1', 'How formal?'), flagged('m-2', 'How long?')],
      ['m-1'],
      new Set(),
    );

    expect(now).toHaveLength(2);
    expect(now.map((a) => a.question)).toEqual(['Which audience?', 'How formal?']);
  });
});
