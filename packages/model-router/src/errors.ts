/**
 * Typed router failures.
 *
 * The guardrail this exists for: *a missing catalog tier entry is a typed error,
 * never a silent default to some arbitrary model.* Substituting a model the
 * caller did not ask for would invalidate the tier policy that chose it —
 * blast radius, fan-in and reversibility all fed that decision (ADR-0002).
 */
import type { LogicalTier } from '@artifex/shared-types';

/**
 * Raised when admission is attempted for a tier that has no probes.
 *
 * Returning `admitted: true` after running zero probes would be the rubber
 * stamp ADR-0008 exists to prevent — and it would be indistinguishable from a
 * genuine pass. Tier 0 is no-LLM by definition, so it legitimately has none.
 */
export class NoProbesForTierError extends Error {
  readonly logicalTier: LogicalTier;

  constructor(logicalTier: LogicalTier) {
    super(
      `No admission probes defined for logical tier ${logicalTier}; refusing to admit a model no probe has tested.`,
    );
    this.name = 'NoProbesForTierError';
    this.logicalTier = logicalTier;
  }
}

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
