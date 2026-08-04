/**
 * What a restatement is allowed to change about a mission's contract (R41).
 *
 * The resumer used to spread the whole `operator.restated` payload over the
 * commissioned contract. That payload also carries the operator's `note`, and
 * the worker view forbids properties it does not define — so every specialist
 * refused the contract and the mission surrendered without executing a task.
 *
 * An ALLOW-LIST, deliberately. Naming the fields a restatement may move is the
 * only version that stays correct when `restate` grows another one: a deny-list
 * would have to be updated in a second place at exactly the moment somebody is
 * thinking about something else.
 */

/** The contract fields a restatement may replace. Everything else is the mission's. */
const RESTATABLE = ['objective', 'acceptanceCriteria'] as const;

/** Just enough of a ledger event to find the restatement. */
interface TrailEvent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export function contractAfterRestatement(
  contract: Record<string, unknown>,
  trail: readonly TrailEvent[],
): Record<string, unknown> {
  // The LAST one — "the most recent statement is the true one" (ADR-0024).
  const restated = [...trail].reverse().find((e) => e.type === 'operator.restated');
  if (restated === undefined) return { ...contract };

  const merged = { ...contract };
  for (const field of RESTATABLE) {
    const value = restated.payload[field];
    // Skipped when absent rather than assigned: the cockpit omits `objective`
    // when the operator left it alone, and writing `undefined` over it would
    // blank the objective the mission was commissioned with.
    if (value !== undefined) merged[field] = value;
  }
  return merged;
}
