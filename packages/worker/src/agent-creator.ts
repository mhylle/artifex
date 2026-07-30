/**
 * The Agent Creator — categorize, staff reuse-first, design on a no-bid.
 *
 * Staffing asks one question in order: *is there already a design that has
 * earned this work?* Reuse is not a micro-optimisation here — it is how the
 * swarm gets cheaper over time instead of re-inventing the same specialist every
 * mission, and it is the mechanism behind "permanence is earned" (invariant #5).
 *
 * The manifest carries a **logical** tier, never a concrete model: the Model
 * Catalog resolves it at dispatch, so models stay swappable data (ADR-0002).
 */
import type { CapabilityManifest, TaskContract } from '@artifex/shared-types';

import { computeTier } from './tier-policy.js';
import type { TaskClass } from './tier-policy.js';

/** A registered design, as the Asset Registry returns it. */
export interface RegisteredDesign {
  readonly designId: string;
  readonly category: string;
  readonly version: number;
  readonly roleInstructions: string;
  readonly capabilities: string[];
  readonly cladeScore: number | null;
  readonly observations: number;
  readonly active: boolean;
}

/** The slice of the Asset Registry staffing needs — structural, so the worker stays DB-free. */
export interface RegistryLookup {
  bestForCategory(category: string): Promise<RegisteredDesign | null>;
}

/** Authors a fresh specialist when nothing in the registry bids. */
export interface DesignAuthor {
  design(input: { readonly contract: TaskContract }): Promise<{
    readonly roleInstructions: string;
    readonly capabilities: string[];
  }>;
}

export interface StaffOptions {
  readonly contract: TaskContract;
  readonly registry: RegistryLookup;
  readonly author: DesignAuthor;
  /** How many downstream tasks consume this one. Feeds the tier policy. */
  readonly fanIn?: number;
  readonly reversible?: boolean;
  readonly taskClass?: TaskClass;
  /** Budget fraction still available. Feeds the tier policy. */
  readonly budgetHeadroom?: number;
}

/**
 * Evidence bar for a clade score to count toward a cheaper tier.
 *
 * Below this a design is not *bad*, it is **unproven** — and treating unproven as
 * proven is how one lucky run promotes itself into a permanent discount.
 */
const PROVEN_OBSERVATIONS = 3;

/** Derive a deterministic design id from the category, so a no-bid is replayable. */
function designIdFor(contract: TaskContract): string {
  const head = contract.taskId.slice(0, 24);
  const tail = contract.taskId.slice(24);
  const mixed = (BigInt(`0x${tail}`) ^ BigInt(contract.category.length + 0x9e37)).toString(16).padStart(12, '0').slice(-12);
  return `${head}${mixed}`;
}

/**
 * Build the validation harness from the contract itself (R6 AC-2).
 *
 * One check per acceptance criterion, each naming its `criterionId`. A harness
 * that says the same thing for every task measures nothing — and since permanence
 * is decided on harness evidence, a generic harness would promote designs on the
 * strength of a test that never varied.
 */
function harnessFor(contract: TaskContract): { checks: string[] } {
  return {
    checks: [
      ...contract.acceptanceCriteria.map(
        (criterion) => `[${criterion.criterionId}] ${criterion.statement}`,
      ),
      `[boundaries] Stays within scope: ${contract.boundaries.outOfScope.join('; ') || 'no stated anti-scope'}`,
    ],
  };
}

/**
 * Staff one contracted task.
 *
 * The tier is *computed* from the task's risk, never chosen by the designer — an
 * agent that picked its own model could buy itself a bigger one, which is the
 * budget equivalent of grading your own homework.
 */
export async function staff(options: StaffOptions): Promise<CapabilityManifest> {
  const { contract, registry, author } = options;

  const bid = await registry.bestForCategory(contract.category);
  const proven = bid !== null && bid.cladeScore !== null && bid.observations >= PROVEN_OBSERVATIONS;

  const design =
    bid !== null
      ? { designId: bid.designId, version: bid.version, roleInstructions: bid.roleInstructions, capabilities: bid.capabilities }
      : {
          designId: designIdFor(contract),
          version: 1,
          ...(await author.design({ contract })),
        };

  const decision = computeTier({
    blastRadius: contract.blastRadius,
    fanIn: options.fanIn ?? 0,
    reversible: options.reversible ?? true,
    taskClass: options.taskClass ?? 'generative',
    autonomyDial: contract.autonomyDial,
    budgetHeadroom: options.budgetHeadroom ?? 1,
    // Only *earned* evidence reaches the tier policy. An unproven design is
    // passed as null so it competes on the same footing as a fresh one.
    cladeScore: proven ? bid.cladeScore : null,
  });

  return {
    manifestId: contract.taskId,
    designId: design.designId,
    version: design.version,
    category: contract.category,
    roleInstructions: design.roleInstructions,
    capabilities: design.capabilities,
    // Never wider than the contract already grants — the manifest cannot
    // entitle an agent to context its task does not warrant (invariant #6).
    contextEntitlements: [...contract.inputs.entitlements],
    logicalTier: decision.tier,
    validationHarness: harnessFor(contract),
    createdAt: contract.createdAt,
  };
}
