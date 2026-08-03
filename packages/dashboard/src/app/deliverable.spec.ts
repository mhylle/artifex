/**
 * Rendering what a mission produced.
 *
 * The owner of a delivered mission: "there is no place where I can see what was
 * delivered." Nothing in the dashboard rendered a deliverable at all — the
 * answer sat on the trail and no lens read it (find-shape (o)).
 *
 * A deliverable is whatever the work produced, so this cannot assume a shape.
 * It renders prose as prose and anything else as readable JSON, and never
 * pretends a structure is a sentence.
 */
import { readableDeliverable } from './deliverable';

describe('readableDeliverable', () => {
  it('renders the answer field as prose, not as JSON', () => {
    // The overwhelmingly common shape. Showing {"answer":"..."} to a requester
    // makes them read punctuation to find their own answer.
    expect(readableDeliverable({ answer: 'Ice floats because it is less dense.' }))
      .toBe('Ice floats because it is less dense.');
  });

  it('renders a bare string unchanged', () => {
    expect(readableDeliverable('Just the text.')).toBe('Just the text.');
  });

  it('renders an unfamiliar shape as readable JSON rather than [object Object]', () => {
    const out = readableDeliverable({ parts: ['a', 'b'], count: 2 });

    expect(out).toContain('"parts"');
    expect(out).toContain('"count"');
    expect(out).not.toContain('[object Object]');
  });

  it('DISTRACTOR: an object with an answer AND other fields keeps the other fields', () => {
    // Reducing to `.answer` would silently discard evidence that travelled with
    // it — the trail would hold more than the screen showed.
    const out = readableDeliverable({ answer: 'Blue.', sources: ['a'] });

    expect(out).toContain('Blue.');
    expect(out).toContain('sources');
  });

  it('DISTRACTOR: null and undefined render as nothing, not as "null"', () => {
    expect(readableDeliverable(null)).toBe('');
    expect(readableDeliverable(undefined)).toBe('');
  });

  it('DISTRACTOR: a non-string answer is not passed off as prose', () => {
    const out = readableDeliverable({ answer: 42 });

    expect(out).toContain('42');
    expect(out).toContain('answer');
  });
});
