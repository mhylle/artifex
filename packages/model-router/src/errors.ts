/**
 * Typed router failures.
 *
 * The guardrail this exists for: *a missing catalog tier entry is a typed error,
 * never a silent default to some arbitrary model.* Substituting a model the
 * caller did not ask for would invalidate the tier policy that chose it —
 * blast radius, fan-in and reversibility all fed that decision (ADR-0002).
 */
import type { LogicalTier } from '@artifex/shared-types';

export class NoModelForTierError extends Error {
  readonly logicalTier: LogicalTier;

  constructor(logicalTier: LogicalTier, detail?: string) {
    super(
      `No admitted model for logical tier ${logicalTier}${detail === undefined ? '' : ` (${detail})`}.`,
    );
    this.name = 'NoModelForTierError';
    this.logicalTier = logicalTier;
  }
}
