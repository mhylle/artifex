/**
 * Rendering what a mission produced.
 *
 * Nothing in the dashboard rendered a deliverable at all until an owner asked
 * where theirs was: the answer sat on the trail and no lens read it. A
 * deliverable is whatever the work produced, so this assumes no shape — it
 * renders prose as prose and everything else as readable JSON, and never
 * pretends a structure is a sentence.
 */
export function readableDeliverable(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;

  // The overwhelmingly common shape is `{ answer: '…' }`, and showing a
  // requester `{"answer":"…"}` makes them read punctuation to find their own
  // answer. Unwrapped ONLY when it is the sole field: an answer travelling with
  // sources or assumptions must not have them silently dropped, or the screen
  // would show less than the trail holds.
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const [first] = entries;
    if (entries.length === 1 && first !== undefined && typeof first[1] === 'string') {
      return first[1];
    }
  }

  return JSON.stringify(value, null, 2);
}
