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
  /**
   * Persist a design authored on a no-bid, so it can bid next time.
   *
   * Optional because a runtime without a fabric still staffs — but when it is
   * absent, creation never feeds the market it is supposed to be the exception
   * to, and the swarm authors a fresh agent forever.
   */
  register?(input: {
    readonly designId: string;
    readonly category: string;
    readonly roleInstructions: string;
    readonly capabilities: string[];
    /**
     * The design this one was derived from, if any (R28 AC-0).
     *
     * Only a REDESIGN has a parent. A design authored because nothing bid is an
     * origin, and attributing a parent to it would invent lineage the system
     * never had — which the clade query would then aggregate as if it were real.
     */
    readonly parentDesignId?: string | null;
    /**
     * The checks this design's work will be graded against (R28 AC-2).
     *
     * Carried at registration because permanence is decided on harness
     * evidence: a design registered without one can never be promoted, so
     * omitting it here would quietly make every swarm-authored specialist
     * permanently unpromotable.
     */
    readonly validationHarness?: { readonly checks: string[] };
  }): Promise<{ readonly version: number } | void>;
  /**
   * Fold one verified outcome into a design's track record.
   *
   * Optional for the same reason, and consequential for the same reason:
   * without it `bestForCategory`'s evidence bar can never be met, so every bid
   * is a no-bid whatever the registry holds.
   */
  recordOutcome?(designId: string, score: number, effort?: number): Promise<void>;
  /**
   * The capabilities the registry already holds, best-established first (R38 AC-0).
   *
   * Optional: without it clustering falls back to normalising the proposed
   * category on its own, which cannot merge names the planner never repeated —
   * so the taxonomy grows by one entry per task and never converges.
   */
  knownCapabilities?(): Promise<string[]>;
}

/** Authors a fresh specialist when nothing in the registry bids. */
export interface DesignAuthor {
  design(input: { readonly contract: TaskContract }): Promise<{
    readonly roleInstructions: string;
    readonly capabilities: string[];
  }>;
}

export interface StaffOptions {
  /**
   * The design this staffing REPLACES, when the ladder reached `agent_redesign`
   * (R28 AC-0).
   *
   * Absent for ordinary staffing, which must keep reusing a proven incumbent —
   * a redesign path leaking into normal staffing would author a fresh design per
   * task and undo R38's reuse market entirely.
   *
   * `null` means the rung was reached but there is no incumbent to derive from,
   * which makes the new design an ORIGIN rather than pointing at a design that
   * does not exist and breaking the clade recursion on a dangling id.
   */
  readonly redesignFrom?: string | null;

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

/**
 * The capability a free-text category belongs to (R38 AC-0).
 *
 * "Clusters the approved task graph into capability categories, so a thousand
 * tasks might need twelve designs, not a thousand."
 *
 * The planner names categories at runtime, in the model's own words — real
 * examples from live missions: "Technical Writing / Tool Instruction",
 * "Content Review / Quality Assurance", "Description Task". Hashing those
 * verbatim gives every task its own design, so nothing reaches the evidence bar
 * and the reuse market has nothing to trade.
 *
 * Normalisation is DERIVED from the shape the model actually produces rather
 * than from a taxonomy someone froze into the code: take the first segment, drop
 * case and punctuation, collapse whitespace. That collapses sub-specialisations
 * of one capability onto one design while leaving genuinely different
 * capabilities apart — and it leaves the taxonomy open, which matters because
 * the dossier makes it a *learnable* asset rather than a fixed list.
 *
 * Never returns an empty string: an empty capability would hash to one shared id
 * and silently pool every unlabelled task onto a single agent.
 */
export function capabilityOf(category: string): string {
  const head = category.split('/')[0] ?? '';
  const normalised = head
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalised.length === 0 ? 'uncategorised' : normalised;
}

/**
 * Significant tokens of a capability, crudely singularised.
 *
 * A stemmer would be a dependency earning its keep on nothing: these are short
 * noun phrases the planner invented seconds ago, and the only inflection that
 * matters in practice is the plural "tools" vs "tool".
 */
function tokensOf(capability: string): string[] {
  return capability
    .split(' ')
    .map((token) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token))
    .filter((token) => token.length > 0);
}

/**
 * Resolve a proposed category against the capabilities the registry already
 * holds (R38 AC-0).
 *
 * "Clusters the approved task graph into capability categories, so a thousand
 * tasks might need twelve designs, not a thousand."
 *
 * Normalising a string cannot do this. The planner invents a fresh phrase per
 * subtask, so five requests to describe a hand tool arrived as "Hand Tool
 * Overview", "Tool Identification & Description", "Tool Description", "Tool
 * Identification & Instruction" and "Woodworking Tools" — five names for one
 * capability, sharing no common first segment. Only matching against what is
 * already known can merge them.
 *
 * The rule is a shared token, and it deliberately errs toward MERGING: the
 * criterion asks for materially fewer designs, and a slightly-wrong reuse is
 * caught downstream by the evidence bar and the clade score, whereas a taxonomy
 * that grows by one entry per task can never accumulate evidence at all.
 *
 * `known` is expected in the registry's own evidence order (most observations
 * first), so a proposal that could join two capabilities joins the
 * better-established one — the tie-break is the system's measured history rather
 * than alphabetical luck.
 */
export function resolveCapability(proposed: string, known: readonly string[]): string {
  const capability = capabilityOf(proposed);
  if (capability === 'uncategorised') return capability;

  const proposedTokens = tokensOf(capability);
  for (const candidate of known) {
    const candidateTokens = tokensOf(candidate);
    if (proposedTokens.some((token) => candidateTokens.includes(token))) return candidate;
  }
  return capability;
}

/**
 * The design id for a CATEGORY — the identity the reuse market trades on.
 *
 * Derived from the category alone, so every task of a kind resolves to one
 * registry row that can accumulate a track record. This previously mixed in
 * `contract.taskId`, which gave each task its own design: the registry filled
 * with one-observation rows, none ever reached the evidence bar, and "reuse
 * first, creation second" could not happen even in principle.
 *
 * A hash rather than a lookup table, because the taxonomy is open — categories
 * are proposed by the planner at runtime, so nothing can enumerate them ahead of
 * time. Laid out as a v4-shaped uuid because that is what the registry's primary
 * key requires.
 */
export function designIdFor(contract: TaskContract): string {
  return designIdForCapability(capabilityOf(contract.category));
}

/** The same identity, computed from an already-resolved capability. */
export function designIdForCapability(capability: string): string {
  // FNV-1a: small, stable across processes, and dependency-free. The id must be
  // identical in every worker for reuse to converge on one row.
  let hash = 0xcbf29ce4_84222325n;
  for (const codePoint of capability) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(codePoint.charCodeAt(0))) * 0x100_0001b3n);
  }
  const hex = hash.toString(16).padStart(16, '0');
  // A second pass so the low bits differ from the high ones; one 64-bit hash is
  // not enough to fill 32 hex digits without visible repetition.
  let mixed = BigInt.asUintN(64, hash * 0x9e37_79b9_7f4a_7c15n);
  const hex2 = mixed.toString(16).padStart(16, '0');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    // Version nibble 4 and variant bits 8..b, so the value is a well-formed uuid.
    `4${hex.slice(13, 16)}`,
    `8${hex2.slice(1, 4)}`,
    hex2.slice(4, 16),
  ].join('-');
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
  const { contract, registry, author, redesignFrom } = options;

  // Resolve the planner's freshly-invented category against what the registry
  // already knows (R38 AC-0), so a taxonomy converges instead of growing by one
  // entry per task. A registry that cannot answer degrades to normalising the
  // proposal alone — worse clustering, never a broken staffing.
  const known = await registry.knownCapabilities?.().catch(() => []) ?? [];
  const capability = resolveCapability(contract.category, known);

  // A REDESIGN never reuses (R28 AC-0). Every other rung of the ladder changes
  // who or how much runs; `agent_redesign` is the one that changes the DESIGN,
  // so staffing the incumbent again would leave the rung doing nothing — which
  // is exactly what it did before this existed.
  const bid = redesignFrom === undefined ? await registry.bestForCategory(capability) : null;
  const proven = bid !== null && bid.cladeScore !== null && bid.observations >= PROVEN_OBSERVATIONS;

  let design;
  if (bid !== null) {
    design = {
      designId: bid.designId,
      // The incumbent's own version, not a fresh 1: a clade score is keyed to
      // the version that earned it, and resetting it would detach the track
      // record from the thing it describes.
      version: bid.version,
      roleInstructions: bid.roleInstructions,
      capabilities: bid.capabilities,
    };
  } else {
    // A redesign must not collide with its parent: `designIdForCapability` is
    // deterministic per capability, so a second design for the same capability
    // would otherwise reuse the parent's id and the lineage would be a self-edge.
    // Deriving from the parent id keeps it deterministic — the same redesign of
    // the same design always lands on the same id, so a replay is faithful.
    const designId = typeof redesignFrom === 'string'
      ? designIdForCapability(`${capability}#redesign-of-${redesignFrom}`)
      : designIdForCapability(capability);

    design = { designId, version: 1, ...(await author.design({ contract })) };

    // Creation feeds the market it is the exception to. Without this the
    // registry never learns the design exists, so the next task of the same
    // kind authors it again from scratch — which is how "reuse first" stayed
    // theoretical while looking implemented.
    //
    // Failure is swallowed on purpose: the registry is a cost lever, not a
    // dependency, and a fabric outage must degrade the swarm to "always
    // author" rather than stop it working.
    const stored = await registry.register?.({
      designId: design.designId,
      // The resolved CAPABILITY, not the planner's phrasing — the registry's
      // distinct categories are the taxonomy, so storing raw text would make
      // `knownCapabilities` a list of one-off strings.
      category: capability,
      roleInstructions: design.roleInstructions,
      capabilities: design.capabilities,
      validationHarness: harnessFor(contract),
      // Null rather than absent when there is nothing to derive from, so the
      // registry stores an explicit "this is an origin" rather than leaving the
      // column to whatever a previous write happened to put there.
      parentDesignId: typeof redesignFrom === 'string' ? redesignFrom : null,
    }).catch(() => undefined);

    // Report the version the registry actually holds. Registration is
    // idempotent, so a category whose asset the ratchet has already advanced
    // returns that version rather than the 1 this call proposed — otherwise the
    // ledger records a version that never did the work (defect `fe690036`).
    if (stored !== undefined && stored !== null) design = { ...design, version: stored.version };
  }

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
