/**
 * The events belonging to the plan a mission is actually running (R41).
 *
 * A restatement replaces the specification, so work contracted before it was
 * planned against criteria that no longer exist. The worker's own fold discards
 * that plan and re-plans; every dashboard projection has to draw the same
 * conclusion or two views of one trail will disagree.
 *
 * One rule, one place. Three folds read `task.contracted` independently — the
 * mission tree, the workforce lens and the timeline lens — and a rule
 * implemented inline at one of them is how the other two came to draw a
 * rejected task tree over a mission that had since delivered something else.
 */

/**
 * Generic over the event shape: the lenses carry a `TimedEvent` (a
 * `LedgerEventView` plus `occurredAt`), and narrowing to the base type here
 * would silently strip the timestamps the timeline is built from.
 */
export function sinceLastRestatement<T extends { seq: number; type: string }>(
  events: readonly T[],
): readonly T[] {
  // By `seq`, not array position: a websocket delivers promptly, not in order.
  let cutoff = -Infinity;
  for (const event of events) {
    if (event.type === 'operator.restated' && event.seq > cutoff) cutoff = event.seq;
  }
  if (cutoff === -Infinity) return events;
  return events.filter((event) => event.seq > cutoff);
}
