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
    // A DOCUMENT: the worker returns one section per thing the criteria asked
    // for, and rendering that as raw JSON is unreadable in exactly the way the
    // owner complained about. The summary leads, then each section under its
    // own heading — prose, because that is what a report is.
    const doc = value as { answer?: unknown; sections?: unknown };
    if (Array.isArray(doc.sections) && doc.sections.length > 0) {
      const parts: string[] = [];
      if (typeof doc.answer === 'string' && doc.answer.trim() !== '') parts.push(doc.answer.trim());
      for (const raw of doc.sections) {
        const section = raw as { heading?: unknown; body?: unknown };
        const heading = typeof section.heading === 'string' ? section.heading.trim() : '';
        const body = typeof section.body === 'string' ? section.body.trim() : '';
        // A heading with no body is a promise the report did not keep; showing
        // it alone would read as a section the reader simply cannot see.
        if (heading === '' && body === '') continue;
        parts.push([heading, body].filter((p) => p !== '').join('\n\n'));
      }
      return parts.join('\n\n');
    }
    // `sections: []` is not a document. Falling through leaves the answer to be
    // rendered on its own, rather than as a heading-less shell.
    if (Array.isArray(doc.sections) && typeof doc.answer === 'string') return doc.answer;

    const entries = Object.entries(value as Record<string, unknown>);
    const [first] = entries;
    if (entries.length === 1 && first !== undefined && typeof first[1] === 'string') {
      return first[1];
    }
  }

  return JSON.stringify(value, null, 2);
}
