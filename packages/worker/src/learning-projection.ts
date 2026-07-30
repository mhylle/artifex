/**
 * The Learning projection — a read-only view over the audit ledger.
 *
 * The Learning Agent reasons from this and only from this. It is read-only for a
 * structural reason, not a stylistic one: a learner that can write to the
 * substrate it learns from can manufacture its own evidence, and every
 * subsequent measurement becomes unfalsifiable.
 *
 * So the class holds exactly one capability — replay — and exposes no method
 * that writes anything anywhere. The test proves this behaviourally rather than
 * by type: it hands the projection an object that *does* have `append` and
 * asserts it is never called. A type annotation is a promise; an unused
 * capability is evidence.
 */
import type { LedgerEvent } from '@artifex/shared-types';

/** The only capability the projection is given. */
export interface ProjectionSource {
  replay(filter: { missionId: string }): Promise<LedgerEvent[]>;
}

export interface DesignPerformance {
  readonly staffings: number;
  readonly tiers: number[];
}

export interface LearningReport {
  readonly missionId: string;
  readonly gateBAttempts: number;
  readonly gateBPasses: number;
  readonly escalations: number;
  /** Escalations that specifically bought a bigger model. */
  readonly tierBumps: number;
  readonly errorClasses: Record<string, number>;
  readonly byDesign: Record<string, DesignPerformance>;
}

export class LearningProjection {
  readonly #source: ProjectionSource;

  constructor(source: ProjectionSource) {
    // Deliberately narrowed. Whatever else the caller passed in — a full
    // repository, for instance — only `replay` is retained.
    this.#source = { replay: (filter) => source.replay(filter) };
  }

  async project(missionId: string): Promise<LearningReport> {
    const events = await this.#source.replay({ missionId });

    const errorClasses: Record<string, number> = {};
    const byDesign: Record<string, DesignPerformance> = {};
    let gateBAttempts = 0;
    let gateBPasses = 0;
    let escalations = 0;
    let tierBumps = 0;

    for (const event of events) {
      if (event.type === 'gate_b.verdict_issued') {
        gateBAttempts += 1;
        const payload = event.payload as { outcome?: string; findings?: Array<{ errorClass?: string }> };
        if (payload.outcome === 'pass') gateBPasses += 1;
        for (const finding of payload.findings ?? []) {
          const cls = finding.errorClass;
          if (cls !== undefined) errorClasses[cls] = (errorClasses[cls] ?? 0) + 1;
        }
      }

      if (event.type === 'escalation.rung_climbed') {
        escalations += 1;
        const payload = event.payload as { rung?: string };
        if (payload.rung === 'retry_higher_tier') tierBumps += 1;
      }

      if (event.type === 'agent.staffed') {
        const payload = event.payload as { designId?: string; logicalTier?: number };
        const designId = payload.designId;
        if (designId !== undefined) {
          const current = byDesign[designId] ?? { staffings: 0, tiers: [] };
          byDesign[designId] = {
            staffings: current.staffings + 1,
            tiers: [...current.tiers, payload.logicalTier ?? 0],
          };
        }
      }
    }

    return { missionId, gateBAttempts, gateBPasses, escalations, tierBumps, errorClasses, byDesign };
  }
}
