/**
 * R39 AC-0 — more than one mission may be in flight at once.
 *
 * "Instance per mission, shared brain: isolated execution, collective learning."
 * The BullMQ consumer was constructed with `concurrency: 1`, so a second mission
 * simply waited and the fleet view could only ever show "a list of one" — the
 * exact phrase the requirement uses for what it is fixing.
 *
 * The VALUE is a policy choice and ADR-0021 says so openly: nothing the system
 * measures determines how many missions a host should run. Task-level
 * concurrency IS derived — `concurrencyFor` reads it off the parent's budget and
 * blast radius — but a mission has no parent contract to read, and the real
 * bottleneck is a single local Ollama, which the worker cannot see.
 *
 * What IS derived is the SHAPE: the default must exceed 1, or "instance per
 * mission" is false by default and the fleet view stays the list of one that
 * R39 exists to end.
 */
import { describe, expect, it } from 'vitest';

import { missionConcurrency } from './runtime.js';

describe('R39 AC-0 — the worker runs more than one mission at a time', () => {
  it('defaults above one, so a second mission does not simply wait', () => {
    expect(missionConcurrency({})).toBeGreaterThan(1);
  });

  it('takes the operator override when one is set', () => {
    // "No arbitrary caps anywhere" (project principle #3). The default is a
    // starting point, not a ceiling baked into the binary.
    expect(missionConcurrency({ WORKER_CONCURRENCY: '9' })).toBe(9);
  });

  it('DISTRACTOR: an explicit 1 is honoured — serialising on purpose is legitimate', () => {
    // The override has to be able to go DOWN as well as up. An operator
    // debugging an interleaved trail, or running against a model server that
    // serialises anyway, is entitled to ask for one at a time.
    //
    // This is the assertion a `Math.max(2, ...)` implementation fails, and such
    // an implementation would pass every other test here.
    expect(missionConcurrency({ WORKER_CONCURRENCY: '1' })).toBe(1);
  });

  it('DISTRACTOR: junk and out-of-range values fall back rather than disabling the worker', () => {
    // A `concurrency: 0` consumer accepts no jobs at all — a typo in an
    // environment variable would silently stop the swarm, and it would look
    // exactly like an empty queue. Both sides asserted, because a rule that
    // rejected everything would pass the first half alone.
    const fallback = missionConcurrency({});
    expect(missionConcurrency({ WORKER_CONCURRENCY: 'lots' })).toBe(fallback);
    expect(missionConcurrency({ WORKER_CONCURRENCY: '0' })).toBe(fallback);
    expect(missionConcurrency({ WORKER_CONCURRENCY: '-3' })).toBe(fallback);
    expect(missionConcurrency({ WORKER_CONCURRENCY: '2.5' })).toBe(fallback);
    // CONTROL: the fallback is a usable value, not an accidental zero.
    expect(fallback).toBeGreaterThan(1);
  });
});
