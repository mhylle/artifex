/**
 * The mission loop — everything assembled (R9).
 *
 * decompose → **Gate A** → staff → execute → **Gate B** → fold up, with the
 * escalation ladder on failure. This is where the pieces built in P4–P8.6 stop
 * being components and become a system.
 *
 * Three properties this function exists to guarantee, none of which any single
 * component could:
 *
 *  1. **Gate A runs before anything executes.** "Verify both ends" means the
 *     decomposition is audited *before* budget is spent on it, so a mission whose
 *     plan does not cover its own criteria never reaches a worker.
 *  2. **One failure climbs exactly one rung.** The ladder is ordered cheapest
 *     first; jumping it wastes the cheap remedies, and skipping it means
 *     rehearsing the same failure forever.
 *  3. **Surrender is a first-class outcome.** A mission that cannot succeed
 *     produces a dossier of what blocked it — not a crash, and not a fabricated
 *     success. Bounded failure is why `stopTryingWhen` and `maxAttempts` exist.
 */
import type { ErrorClass, EscalationRung, LedgerEventInput, LogicalTier, TaskContract } from '@artifex/shared-types';

import { capabilityOf, proposableCapabilities, staff, staffVerifier } from './agent-creator.js';
import { concurrencyFor } from './design-playbook.js';
import type { DesignAuthor, RegistryLookup } from './agent-creator.js';
import { decompose, foldUp } from './orchestrator.js';
import type { Planner, Reconciler } from './orchestrator.js';
import { gateA, gateB } from './reviewer.js';
import type { CompletionJudge, CoverageJudge, IntentJudge, PlanJudge } from './reviewer.js';
import { calibrationOf, probeMisses } from './calibration.js';
import type { IssuedVerdict, PlantedProbe, ReReview } from './calibration.js';
import { pedigreeOf, surrenderDossier } from './dossier.js';
import { entryRungFor, isStalled, worstClass } from './escalation.js';
import type { AttemptSignature } from './escalation.js';
import { assertFastLoopReach } from './constitution.js';
import type { HotFixTarget } from './constitution.js';
import { detectHotSpot, hotFixPlan, revertDecision } from './fast-loop.js';
import type { GateBOutcome, HotFixPlan } from './fast-loop.js';
import { runSpecialist } from './specialist.js';
import { BrokeredFabric, ContextBroker } from './context-broker.js';
import type { ContextStore } from './context-broker.js';
import type { ClarityJudge, SpecialistWork } from './specialist.js';

/**
 * Rewrites a contract the worker could not restate (defect `1e3905a4`).
 *
 * A bounce says the *specification* is unclear, so the only thing that can fix
 * it is changing the specification. Optional: without it the loop still climbs
 * the ladder and surrenders honestly, it just cannot repair the contract.
 */
export interface Clarifier {
  clarify(input: {
    readonly contract: TaskContract;
    readonly ambiguities: readonly string[];
  }): Promise<{
    readonly objective: string;
    readonly acceptanceCriteria: readonly { criterionId: string; statement: string }[] | null;
  }>;
}

/**
 * The decompose-or-delegate gate (R31).
 *
 * "Atomization is a weapon to aim, not a reflex." Work that is inherently
 * sequential and constraint-entangled is measurably *damaged* by splitting, so
 * the Orchestrator asks at every node whether to split at all — and the answer,
 * either way, is recorded.
 *
 * Optional: a runtime without a gate still runs, and records that it defaulted
 * to splitting. Silence would leave every such mission claiming a decision it
 * never made.
 */
export interface DecompositionGate {
  assess(input: { readonly contract: TaskContract }): Promise<{
    readonly keepWhole: boolean;
    readonly rationale: string;
  }>;
}

/**
 * The operator's control signals, derived from the ledger (R17).
 *
 * Deliberately a *query* rather than a stored flag: pause and cancel are facts
 * the operator appended to the trail, so the runtime reads them the same way the
 * dashboard does. Nothing holds a second copy of "is this paused", which keeps
 * invariant #1 true on the runtime side as well as the view side.
 */
export interface ControlSignals {
  check(taskId: string): Promise<'run' | 'paused' | 'cancelled'>;
  /**
   * Extra effort the operator has granted this task, folded from the trail.
   *
   * Optional so a runtime without a cockpit still enforces the contract's own
   * ceiling — a budget that stops binding wherever the cockpit is unwired would
   * be worse than no budget, because it would bind unpredictably.
   */
  grantedBudget?(taskId: string): Promise<number>;
  /**
   * The autonomy dial as it stands NOW, from the latest `operator.dial_turned`.
   *
   * `null` means the operator has not turned it, so the contract's own setting
   * governs. Read at the moment the ladder is climbed, which is what makes
   * "applies at the next gate, never retroactively" true by construction: a
   * verdict already issued is never revisited, because the dial is only ever
   * consulted going forward.
   */
  currentDial?(missionId: string): Promise<'autonomous' | 'checkpointed' | 'supervised' | null>;
}

export interface MissionSeams {
  readonly planner: Planner;
  readonly coverageJudge: CoverageJudge;
  /**
   * Gate A's two semantic clauses — atomicity and testability-as-written (R33).
   *
   * REQUIRED, alongside the coverage judge rather than among the optional
   * behavioural seams. An optional plan judge would let a mission run with two
   * of Gate A's six clauses silently unaudited while the gate still reported a
   * pass, which is precisely the failure Gate A exists to prevent.
   */
  readonly planJudge: PlanJudge;
  /**
   * Gate B's semantic INTENT tier (R34 AC-0).
   *
   * REQUIRED for the same reason `planJudge` is: an optional intent judge would
   * let a mission verify with one of Gate B's two tiers silently absent while
   * the gate still reported a pass.
   */
  readonly intentJudge: IntentJudge;
  readonly registry: RegistryLookup;
  readonly author: DesignAuthor;
  readonly clarityJudge: ClarityJudge;
  readonly work: SpecialistWork;
  readonly completionJudge: CompletionJudge;
  readonly reconciler: Reconciler;
  readonly clarifier?: Clarifier;
  /**
   * Optional: without it the loop runs exactly as before, which matters because
   * every existing caller predates operator control.
   */
  readonly control?: ControlSignals;
  /**
   * Optional (R31). Absent means "always split", which is what every caller
   * predating the gate did — but the default is still RECORDED, so no mission
   * silently claims a judgement nobody made.
   */
  readonly decompositionGate?: DecompositionGate;
  /**
   * The Knowledge Commons producer (defect `753bc6dd`).
   *
   * Optional: the store is a side benefit, and every caller predates it. A
   * mission with no commons runs exactly as before.
   */
  readonly commons?: KnowledgeCommonsSubmitter;
  /**
   * The reviewer's own calibration (R35).
   *
   * Optional: a mission runs identically without it, and the measurement is
   * about the REVIEWER rather than about this mission's work — turning it into
   * a gate would let the yardstick overrule the thing it measures.
   */
  readonly calibration?: CalibrationSeam;
  /**
   * The fast loop (R26) — bounded in-mission hot-fixes that auto-revert.
   *
   * Optional, for the same reason `commons` and `calibration` are: it is an
   * OPTIMISER, not a gate. A mission runs identically without it and no verdict
   * changes, so making it required would give a bookkeeping seam authority over
   * whether verified work counts. Its failures are swallowed on the same
   * argument — losing a delivered mission because a store write failed trades
   * the product for the receipt.
   *
   * That optionality is exactly what made defect `188c6892` possible, so note
   * where it is really supplied: `buildWorkerSeams`, which is what the deployed
   * worker binary uses. A seam nothing constructs is a seam that does not exist.
   */
  readonly fastLoop?: FastLoopSeam;
  /**
   * Learnable decomposition templates (R31 AC-2).
   *
   * Optional at the seam and REQUIRED in `WorkerDependencies`, the pattern that
   * has now caught three dead mechanisms: every existing caller predates
   * templates, and the deployed worker must not run without them.
   */
  readonly templates?: DecompositionTemplateSeam;
  /**
   * The context sources the Context Broker serves (invariant #6, defects
   * `488709be` / `753bc6dd`).
   *
   * Optional at the seam and REQUIRED in `WorkerDependencies`, the pattern that
   * has caught five dead mechanisms. Absent, a mission runs exactly as before —
   * context is an improvement, not a gate.
   */
  readonly context?: ContextStore;
  /**
   * Extra sources to request per task, beyond the contract's entitlements.
   *
   * A test seam, and it exists to make the REFUSAL path reachable: every source
   * the loop asks for by default is one the contract entitles, so without this
   * the denial branch could never be exercised end to end.
   */
  readonly extraSources?: readonly string[];
}

/**
 * What the loop needs from the template store (R31 AC-2).
 *
 * Structural, like the registry and commons seams — the worker depends on
 * `shared-types` and its own seams, never on the fabric.
 */
export interface DecompositionTemplateSeam {
  /** The recipe to guide a split of this capability, or null. */
  forCapability(capability: string): Promise<{ readonly templateId: string; readonly recipe: string } | null>;
  /** Distil a split that survived Gate A into a reusable recipe. */
  remember(input: {
    readonly capability: string;
    readonly recipe: string;
    readonly sourceMissionId: string;
  }): Promise<{ readonly templateId: string }>;
  /** Fold one more outcome — did the split this guided survive Gate A? */
  recordOutcome(templateId: string, survived: boolean): Promise<void>;
}

/**
 * What the mission loop needs to enact a hot-fix (R26).
 *
 * Structural rather than an import of `HotFixRepository`, matching the registry
 * and commons seams — the worker package depends on `shared-types` and its own
 * seams, never on the fabric.
 *
 * `apply` both logs the experiment and puts the patch in place; `resolve` both
 * records the verdict and, when reverting, restores what was there. Splitting
 * either into two calls would create a window in which the log and the asset
 * disagree, and the log is supposed to be what the asset's state means.
 */
export interface FastLoopSeam {
  /** The worker-layer asset as it stands, so a patch knows what it replaces. */
  asset(designId: string): Promise<{ readonly designId: string; readonly roleInstructions: string } | null>;
  /** Log and apply. Null when this mission already has a live experiment. */
  apply(input: {
    readonly missionId: string;
    readonly category: string;
    readonly criterionId: string;
    readonly target: HotFixTarget;
    readonly previousValue: string;
    readonly patchedValue: string;
    readonly windowObservations: number;
    readonly baselineFailureRate: number;
    readonly predictedFailureRate: number;
    readonly predictionBasis: string;
  }): Promise<string | null>;
  /** Record the verdict and, when reverting, put the previous value back. */
  resolve(input: {
    readonly hotFixId: string;
    readonly target: HotFixTarget;
    readonly previousValue: string;
    readonly revert: boolean;
    readonly reason: string;
    readonly observedFailureRate: number | null;
  }): Promise<void>;
}

/**
 * What the mission loop needs from the Knowledge Commons (defect `753bc6dd`).
 *
 * Structural rather than an import of the repository, so the worker package
 * keeps depending on `shared-types` and its own seams — the same shape the
 * registry lookup uses.
 */
export interface KnowledgeCommonsSubmitter {
  submit(entry: {
    readonly claim: string;
    readonly impact: 'low' | 'high';
    readonly provenance: {
      readonly producedByDesignId: string;
      readonly missionId: string;
      readonly taskId: string;
      readonly evidence: readonly string[];
      readonly verifiedBy: string;
    };
  }): Promise<unknown>;
}

/**
 * How the reviewer gets measured (R35).
 *
 * `reReview` is asked for a SECOND opinion on a verdict already issued, and must
 * come from a different reviewer — `calibrationOf` refuses a self re-review,
 * because a reviewer agreeing with itself measures nothing.
 *
 * `probes` are tasks whose correct verdict is already known, planted in the
 * review stream. They catch what calibration structurally cannot: a reviewer
 * consistently wrong in the same direction agrees with itself perfectly, which
 * is also why ADR-0010's unanimity sampling is silent for it (`627cd71c`).
 */
export interface CalibrationSeam {
  /** Which of these verdicts to re-review. Sampling policy belongs to the caller. */
  sample(issued: readonly IssuedVerdict[]): Promise<readonly ReReview[]>;
  /** Probes planted in this mission, if any. */
  /**
   * Probes planted for this mission, if any (R35 AC-1).
   *
   * Returns work to be REVIEWED, not merely a list of expected verdicts. It
   * carried `{taskId, expected}` alone while nothing implemented it, which could
   * never have measured anything: `probeMisses` matches those ids against
   * verdicts, and no verdict for a synthetic task would ever exist.
   */
  probes?(): Promise<readonly PlantedProbe[]>;
}

export interface Escalation {
  readonly taskId: string;
  readonly rung: EscalationRung;
  readonly fromTier: LogicalTier;
  readonly toTier: LogicalTier;
  readonly reason: string;
}

export interface MissionResult {
  readonly outcome: 'delivered' | 'surrendered';
  readonly deliverable: unknown;
  readonly trail: LedgerEventInput[];
  readonly escalations: Escalation[];
}

const FRONTIER_TIER = 3;

/** What a prior trail establishes about a mission already in flight (R41). */
interface PriorState {
  /** Every task the trail contracted, by id — the exact contracts, not summaries. */
  readonly contracts: ReadonlyMap<string, TaskContract>;
  /** Children by parent id, in contracted order. */
  readonly childrenOf: ReadonlyMap<string, TaskContract[]>;
  /** Tasks whose last Gate B verdict passed, with what they produced. */
  readonly verified: ReadonlyMap<string, unknown>;
  /**
   * Tasks a human has already answered.
   *
   * Without this a resumed mission would stop at the very rung the operator
   * just cleared, and the decision would achieve nothing — the queue would
   * refill with the item that was only moments ago answered.
   */
  readonly decided: ReadonlySet<string>;
}

/**
 * Fold a prior trail into the state a resumed run needs.
 *
 * Only two questions matter: which tasks exist, and which are already done.
 * Everything else in the trail is history the new run will not redo, so it does
 * not need re-deriving.
 *
 * Status is taken from the LAST verdict per task, not from any accumulated
 * flag — the same rule the dashboard projection uses, so a task that failed and
 * then passed on retry resumes as done rather than as broken.
 */
function foldPriorTrail(events: readonly LedgerEventInput[]): PriorState {
  const contracts = new Map<string, TaskContract>();
  const childrenOf = new Map<string, TaskContract[]>();
  const deliverables = new Map<string, unknown>();
  const lastOutcome = new Map<string, string>();
  const decided = new Set<string>();

  for (const event of events) {
    const taskId = event.taskId;
    if (taskId === null) continue;

    if (event.type === 'task.contracted') {
      const contract = event.payload['contract'];
      // Only a FULL contract is usable. A summary would force the loop to invent
      // the missing fields, and an invented contract is not the one the work was
      // graded against.
      if (contract !== undefined && contract !== null && typeof contract === 'object') {
        const typed = contract as TaskContract;
        contracts.set(taskId, typed);
        const siblings = childrenOf.get(typed.parentTaskId ?? '') ?? [];
        siblings.push(typed);
        childrenOf.set(typed.parentTaskId ?? '', siblings);
      }
      continue;
    }

    if (event.type === 'task.executed') {
      const deliverable = event.payload['deliverable'];
      if (deliverable !== undefined) deliverables.set(taskId, deliverable);
      continue;
    }

    if (event.type === 'operator.decided') {
      decided.add(taskId);
      continue;
    }

    if (event.type === 'gate_b.verdict_issued') {
      const outcome = event.payload['outcome'];
      if (typeof outcome === 'string') lastOutcome.set(taskId, outcome);
    }
  }

  const verified = new Map<string, unknown>();
  for (const [taskId, outcome] of lastOutcome) {
    if (outcome !== 'pass') continue;
    const deliverable = deliverables.get(taskId);
    // A pass with no recorded deliverable cannot be carried into fold-up, so the
    // task is treated as outstanding rather than as done-with-nothing.
    if (deliverable !== undefined) verified.set(taskId, deliverable);
  }

  return { contracts, childrenOf, verified, decided };
}

/** Either a subtree's assembled deliverable, or the surrender that ended it. */
type SubtreeOutcome =
  | { readonly ok: true; readonly deliverable: unknown }
  | { readonly ok: false; readonly result: MissionResult };

/**
 * Is this contract a leaf?
 *
 * Taken from the dossier's own definition rather than invented: splitting
 * continues "until each leaf carries exactly **one responsibility** with **one
 * verifiable outcome** — and no further". A contract with a single acceptance
 * criterion already has one verifiable outcome, so it is done being split.
 *
 * This also guarantees termination without a magic number: a split must
 * partition its parent's criteria, and one criterion cannot be partitioned.
 */
function isAtomic(contract: TaskContract): boolean {
  return contract.acceptanceCriteria.length <= 1;
}

/**
 * Is this deliverable serialised JSON rather than an answer? (defect 08db92fd)
 *
 * Returns the SHAPE that was detected, or null when the answer is fine — the
 * shape is recorded so the operator can tell the two failure modes apart, and
 * so the rate of each can be measured from the ledger later.
 *
 * Both shapes are taken from real ledger events, not imagined:
 *
 *   'document' — a whole nested object where a string was asked for:
 *                `{"summary": {"purpose": "Explain the mechanism..."}}`
 *   'fragment' — the model closed the string and kept authoring keys:
 *                `5", "explanation": "A standard hard-boiled egg...`
 *
 * The fragment pattern requires a quote, a comma, a QUOTED KEY and a colon in
 * that order. Prose uses quotes and colons constantly (`She said "boil it": ...`),
 * so keying on punctuation alone would burn escalation rungs on good work.
 */
function jsonLeak(deliverable: unknown): 'document' | 'fragment' | null {
  if (typeof deliverable !== 'object' || deliverable === null) return null;
  const answer = (deliverable as { answer?: unknown }).answer;
  if (typeof answer !== 'string') return null;

  const trimmed = answer.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) return 'document';
    } catch {
      // An unparseable brace is prose that happens to start with one, or a
      // truncated document. Truncation still reads as structure, so fall
      // through to the fragment check rather than declaring it clean.
    }
  }

  if (/"\s*,\s*"[A-Za-z_][\w-]*"\s*:/.test(answer)) return 'fragment';

  return null;
}

export async function runMission(
  mission: TaskContract,
  seams: MissionSeams,
  options: {
    /**
     * A CLOCK, not an instant (defect `74950cfc`).
     *
     * `now` used to be a single timestamp captured once and stamped on every
     * event, so a two-minute mission produced a trail in which everything
     * happened at the same moment — and the timeline lens could show no stall,
     * because there were no gaps to show.
     *
     * Determinism was the right instinct and it is preserved: a test passes
     * `() => AT` and gets exactly the old frozen behaviour. Production passes
     * `() => new Date().toISOString()` and gets the truth.
     */
    readonly now: () => string;
    /**
     * How many times to retry the SAME tier before spending an escalation rung
     * (defect `626f6596`). The ladder exists for *substantive* failure — work
     * that came back wrong. A backend hiccup is not that, and spending
     * `retry_higher_tier` on one burns a real remedy on a non-problem.
     *
     * It matters at scale rather than in the small: every leaf needs a model
     * call to survive, so with `n` leaves the failure probability compounds —
     * and fanning out is the direction this system is built to grow in.
     * Defaults to 1: enough to absorb a hiccup, not enough to hide a fault.
     */
    readonly transientRetries?: number;
    /**
     * Called for each event as it is recorded, so the trail can be persisted and
     * streamed while the mission runs rather than in a burst at the end.
     *
     * Defect `b3b4e554`: the worker appended `result.trail` only after this
     * function resolved, so a connected dashboard sat blind for the whole
     * mission and then jumped straight to the finished state. The dossier
     * promises events "streamed as they happen".
     *
     * Deliberately synchronous and failure-absorbing: the mission must not slow
     * to the speed of the ledger, and must not die because a subscriber threw.
     */
    readonly onEvent?: (event: LedgerEventInput) => void;
    /**
     * A prior trail to continue from (R41).
     *
     * The ledger is the checkpoint: rather than holding a suspended
     * continuation, the loop folds what already happened and picks up from
     * there. Absent, a mission decomposes and runs exactly as before — resume is
     * an additional entry point, never a change to a fresh run.
     */
    readonly resumeFrom?: readonly LedgerEventInput[];
  },
): Promise<MissionResult> {
  const now = options.now;
  const transientRetries = options.transientRetries ?? 1;
  const trail: LedgerEventInput[] = [];
  const escalations: Escalation[] = [];
  let seq = 0;

  /**
   * Distinguishes this run's events from any earlier run of the same mission.
   *
   * Six hex digits of randomness rather than a counter: a counter would need
   * somewhere to persist, and the whole point of resume is that the only
   * durable state is the trail itself.
   */
  const runNonce = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');

  const record = (
    taskId: string,
    family: LedgerEventInput['family'],
    type: string,
    actorKind: LedgerEventInput['actor']['kind'],
    payload: Record<string, unknown>,
    // Returns the event id so a caller can CITE what it just wrote. The
    // Knowledge Commons refuses a finding with no evidence, and the evidence it
    // wants is ledger event ids — which only this function knows.
  ): string => {
    seq += 1;
    const event: LedgerEventInput = {
      // Unique per RUN, not merely per mission (defect `5236850d`). Deterministic
      // ids were fine while a mission ran exactly once; resume made the same
      // mission legitimately produce more events later, and the id has to
      // distinguish the second telling from the first or every append is
      // rejected by the ledger's unique constraint — silently, because the
      // mission still completes.
      //
      // TASK ids stay deterministic on purpose: `childTaskId` derives them from
      // the parent, which is what makes an operator's earlier decision still
      // refer to the right task (R41). Only the event id varies.
      eventId: `${mission.taskId.slice(0, 24)}${runNonce}${seq.toString(16).padStart(6, '0')}`,
      missionId: mission.missionId,
      taskId,
      family,
      type,
      actor: { kind: actorKind, id: actorKind, displayName: null },
      payload,
      // Read per event, which is the entire fix: the trail's timestamps now
      // describe when things happened rather than when the run began.
      occurredAt: now(),
    };
    trail.push(event);

    // The trail is still returned in full — replay and the mission result do not
    // depend on anyone listening. This is an additional path, not a substitute.
    try {
      options.onEvent?.(event);
    } catch {
      // A subscriber's failure is not a mission failure. The event is already in
      // the trail, so nothing is lost that replay cannot recover.
    }

    return event.eventId;
  };

  /**
   * `reviewerId` names the VERIFIER'S DESIGN once one is staffed (R35 AC-2).
   *
   * It was the mission id — the same value for every verdict in a run, which
   * made "who reviewed this" unanswerable and left `independenceViolation`
   * nothing to rule on. Falls back to the mission id where no verifier was
   * staffed (Gate A, and any caller with no ancestry-aware registry), because a
   * missing verifier must read as "not recorded" rather than as a design id that
   * does not exist.
   */
  const verdictMeta = (n: number, reviewerDesignId?: string) => ({
    verdictId: `${mission.taskId.slice(0, 24)}${(n + 0xf00000).toString(16).padStart(12, '0')}`,
    reviewerId: reviewerDesignId ?? mission.taskId,
    issuedAt: now(),
  });

  /**
   * What the prior trail already establishes (R41).
   *
   * Only two things matter for continuing: which tasks exist (with their exact
   * contracts) and which are already done (with what they produced). Everything
   * else — escalations, verdicts, budget — is history the new run does not need
   * to re-derive, because it is not going to redo that work.
   */
  const prior = foldPriorTrail(options.resumeFrom ?? []);
  const resuming = prior.contracts.size > 0;

  if (!resuming) {
    record(mission.taskId, 'contract', 'mission.started', 'orchestrator', { objective: mission.objective });
  } else {
    record(mission.taskId, 'decision', 'mission.resumed', 'orchestrator', {
      objective: mission.objective,
      tasksRecovered: prior.contracts.size,
      alreadyVerified: prior.verified.size,
    });
  }

  /**
   * The evidence bundle a probe is reviewed with (R35 AC-1).
   *
   * Shaped so the MECHANICAL tier stays quiet, because a probe measures the
   * SEMANTIC one. Effort is set to the contract's floor so the ceiling check
   * cannot trip, and a token action is supplied when the contract granted tools
   * so the "entitled to tools, used none" check cannot either. Without that, a
   * known-GOOD probe would fail for a bookkeeping reason and be scored a miss
   * against a reviewer that did nothing wrong.
   */
  const probeBundle = (probe: PlantedProbe) => ({
    bundleId: probe.taskId,
    taskId: probe.taskId,
    agentId: 'probe',
    deliverable: probe.deliverable,
    actions: probe.contract.inputs.toolEntitlements.length === 0
      ? []
      : [{ tool: 'probe', input: {}, output: {}, at: now() } as never],
    consulted: [],
    assumptions: [],
    reflection: null,
    effortSpent: probe.contract.budget.floor,
    producedAt: now(),
  });

  // ---- the Context Broker (invariant #6) -----------------------------------
  // Built once per mission because every exchange it logs is a mission event.
  // `null` when no store is supplied, which is every caller that predates
  // brokering — their missions run exactly as before.
  const broker = seams.context === undefined
    ? null
    : new ContextBroker({
        fabric: new BrokeredFabric(seams.context),
        // The broker appends through the loop's own recorder, so a grant lands
        // in the same ordered trail as the work it enabled. A second sink would
        // be a second truth about when things happened.
        sink: { append: async (event) => { void trail.push(event); options.onEvent?.(event); } },
        missionId: mission.missionId,
      });

  /**
   * Serve a task's entitled context before it executes (defects `488709be`,
   * `753bc6dd`).
   *
   * Every source goes through the broker — that IS invariant #6, "agents
   * exchange context only through the Context Broker, and every exchange is
   * logged". A refusal is logged by the broker too, so an unentitled request is
   * as visible as a granted one.
   *
   * Failures are swallowed per source. Context is an improvement, not a gate:
   * losing verified work because a knowledge read failed would trade the product
   * for the reference material.
   */
  const brokerContext = async (
    contract: TaskContract,
    agentId: string,
  ): Promise<{ payload: unknown; consulted: Array<{ source: string; viaBrokerGrantId: string | null }> }> => {
    if (broker === null) return { payload: null, consulted: [] };

    const wanted = [...contract.inputs.entitlements, ...(seams.extraSources ?? [])];
    // The GRANT id, not just the source. `viaBrokerGrantId` exists on the
    // bundle precisely so a reader can tell brokered access from a direct
    // read — recording the source alone would lose the thing that proves
    // invariant #6 was honoured.
    const consulted: Array<{ source: string; viaBrokerGrantId: string | null }> = [];
    let payload: unknown = null;

    for (const source of wanted) {
      try {
        const { verificationPlan: _withheld, ...workerView } = contract;
        const grant = await broker.request({
          agentId, contract: workerView, source, occurredAt: now(),
        });
        consulted.push({ source, viaBrokerGrantId: grant.grantId });
        // The first granted source is the prior knowledge the worker sees.
        // Concatenating several would need a merge rule nobody has decided.
        if (payload === null) payload = grant.payload;
      } catch {
        // Denied or unavailable. The broker already recorded which.
      }
    }

    return { payload, consulted };
  };

  // ---- the fast loop (R26) -------------------------------------------------
  // Every Gate B result this mission has produced, in order, as one criterion
  // each. The fast loop's whole input, and it is derived from work already done
  // rather than measured separately — a second measurement of the same thing
  // could only disagree with the first.
  const gateBOutcomes: GateBOutcome[] = [];
  /** Which design last worked a category, so a patch knows what to aim at. */
  const designFor = new Map<string, string>();
  /** The live experiment, plus where in `gateBOutcomes` its window started. */
  let liveFix:
    | { readonly hotFixId: string; readonly plan: HotFixPlan; readonly target: HotFixTarget; readonly previousValue: string; readonly from: number }
    | null = null;

  /**
   * Fire, or judge, the one live experiment (R26).
   *
   * Called after every Gate B verdict and once more when the mission ends. The
   * second call is not tidying: a window that closes only by filling never
   * closes once the patched category stops appearing, so the hot-fix would
   * outlive the mission that made it — the one outcome AC-1 exists to prevent.
   *
   * Failures are swallowed throughout. The fast loop is an optimiser, not a
   * gate; letting a store write surrender a delivered mission would trade the
   * product for the receipt.
   */
  const runFastLoop = async (missionEnded: boolean): Promise<void> => {
    const seam = seams.fastLoop;
    if (seam === undefined) return;

    try {
      if (liveFix !== null) {
        const since = gateBOutcomes.slice(liveFix.from);
        const decision = revertDecision(liveFix.plan, since, { missionEnded });
        if (!decision.windowClosed) return;

        await seam.resolve({
          hotFixId: liveFix.hotFixId,
          target: liveFix.target,
          previousValue: liveFix.previousValue,
          revert: decision.revert,
          reason: decision.reason,
          observedFailureRate: decision.observedFailureRate,
        });
        record(mission.taskId, 'learning', 'fast_loop.hot_fix_resolved', 'learning_agent', {
          hotFixId: liveFix.hotFixId,
          outcome: decision.revert ? 'reverted' : 'kept',
          reason: decision.reason,
          observedFailureRate: decision.observedFailureRate,
          baselineFailureRate: liveFix.plan.predictedEffect.baselineFailureRate,
        });
        liveFix = null;
        return;
      }

      // One change at a time: a mission that has just closed an experiment does
      // not immediately open another on its way out the door.
      if (missionEnded) return;

      // "Repeatedly" is the CONTRACT's own `stallLimit` — already the system's
      // answer to how many times is repeatedly (R36 asks it of attempts). A
      // second number would be a second answer to one question.
      const spot = detectHotSpot(gateBOutcomes, mission.stoppingConditions.stallLimit);
      if (spot === null) return;

      const designId = designFor.get(`${spot.category}`);
      if (designId === undefined) return;
      const asset = await seam.asset(designId);
      if (asset === null) return;

      const plan = hotFixPlan(spot, asset);
      const patch = plan.patches[0]!;
      // Bar two of three. The type already refuses a non-worker target and the
      // store's CHECK constraint refuses one too; this is the one that catches a
      // target assembled at runtime from data that was never type-checked.
      assertFastLoopReach(patch.target);

      const hotFixId = await seam.apply({
        missionId: mission.missionId,
        category: plan.category,
        criterionId: plan.criterionId,
        target: patch.target,
        previousValue: asset.roleInstructions,
        patchedValue: patch.replacement,
        windowObservations: plan.bounds.windowObservations,
        baselineFailureRate: plan.predictedEffect.baselineFailureRate,
        predictedFailureRate: plan.predictedEffect.predictedFailureRate,
        predictionBasis: plan.predictedEffect.basis,
      });
      if (hotFixId === null) return;

      record(mission.taskId, 'learning', 'fast_loop.hot_fix_applied', 'learning_agent', {
        hotFixId,
        category: plan.category,
        criterionId: plan.criterionId,
        target: patch.target,
        bounds: plan.bounds,
        predictedEffect: plan.predictedEffect,
        // The CHANGE ITSELF (defect `aa6948ee`). This event named the asset, the
        // criterion, the bounds and the prediction — everything except what the
        // instructions were patched to, which is the one fact a reader most
        // needs. Invariant #1 says the ledger is the complete record of what
        // happened; a replay that can say "the role instructions changed" and
        // not what they changed to does not satisfy it.
        //
        // Both sides, because a patch is a DIFF: `patchedValue` alone would say
        // where the swarm ended up and not what it moved away from, and the
        // whole judgement of a hot-fix is whether the move helped.
        //
        // Verbatim rather than a digest. These are role-instruction blocks of a
        // few hundred characters, and a hash would make the trail auditable only
        // by someone who still had the original to compare against — which is
        // precisely what a replay does not have.
        patch: { previousValue: asset.roleInstructions, patchedValue: patch.replacement },
      });
      liveFix = {
        hotFixId, plan, target: patch.target,
        previousValue: asset.roleInstructions,
        // The window starts HERE. Counting the failures that triggered the fix
        // as evidence about the fix would guarantee it never looks better.
        from: gateBOutcomes.length,
      };
    } catch {
      // Deliberately silent — see the doc comment.
    }
  };

  /**
   * Measure the reviewer against this mission's own verdicts (R35 AC-0/AC-1).
   *
   * Runs on BOTH terminal paths, because a surrendered mission's verdicts are
   * exactly the ones most worth re-reviewing — R37's pedigree was attached to
   * only one of two paths and silently missed half the missions, and this is the
   * same shape.
   *
   * Failure is swallowed and the result is a MEASUREMENT, never a verdict. A
   * calibration that could overturn a gate would put the yardstick in the
   * business of overruling what it measures, which is the constitutional line
   * about the learner not owning the yardstick.
   */
  const runCalibration = async (): Promise<void> => {
    if (seams.calibration === undefined) return;

    // The WORK, not just the verdict: a second opinion formed from the first
    // opinion measures obedience, not calibration.
    const executed = new Map<string, { objective?: string; deliverable?: unknown }>();
    for (const e of trail) {
      if (e.taskId === null) continue;
      if (e.type === 'task.contracted') {
        const objective = (e.payload as { objective?: unknown }).objective;
        if (typeof objective === 'string') {
          executed.set(e.taskId, { ...executed.get(e.taskId), objective });
        }
      }
      if (e.type === 'task.executed') {
        executed.set(e.taskId, {
          ...executed.get(e.taskId),
          deliverable: (e.payload as { deliverable?: unknown }).deliverable,
        });
      }
    }

    const issued: IssuedVerdict[] = trail
      .filter((e) => e.type === 'gate_b.verdict_issued' && e.taskId !== null)
      .map((e) => {
        const p = e.payload as { outcome?: unknown; reviewerId?: unknown; verdictId?: unknown };
        const work = executed.get(e.taskId!) ?? {};
        return {
          taskId: e.taskId!,
          outcome: p.outcome === 'pass' ? ('pass' as const) : ('fail' as const),
          reviewerId: typeof p.reviewerId === 'string' ? p.reviewerId : 'unknown',
          verdictId: typeof p.verdictId === 'string' ? p.verdictId : 'unknown',
          ...(work.objective === undefined ? { objective: mission.objective } : { objective: work.objective }),
          deliverable: work.deliverable,
        };
      });

    if (issued.length === 0) return;

    try {
      const reReviews = await seams.calibration.sample(issued);

      // ---- probes are RUN, not merely declared (R35 AC-1) -------------------
      // The criterion says "when the Reviewer PROCESSES it", so each planted
      // probe goes through the same `gateB` with the same judges that graded the
      // mission's real work. Declaring a probe and never reviewing it would
      // measure nothing at all — which is what `probes()` returning bare
      // {taskId, expected} amounted to while nothing implemented it.
      //
      // Deliberately kept OUT of the re-review sample: there is no point asking
      // a second opinion about a case whose answer is already known, and mixing
      // probes into `issued` would let synthetic work contaminate the agreement
      // rate, the fold-up, and the designs' track records.
      const planted = (await seams.calibration.probes?.()) ?? [];
      const probeVerdicts: IssuedVerdict[] = [];
      for (const probe of planted) {
        try {
          const verdict = await gateB(
            probe.contract,
            probeBundle(probe),
            seams.completionJudge,
            seams.intentJudge,
            { verdictId: probe.taskId, reviewerId: 'probe', issuedAt: now() },
          );
          probeVerdicts.push({
            taskId: probe.taskId,
            outcome: verdict.outcome === 'pass' ? 'pass' : 'fail',
            reviewerId: 'probe',
            verdictId: probe.taskId,
            objective: probe.contract.objective,
            deliverable: probe.deliverable,
          });
        } catch {
          // An unevaluable probe is not a miss. Scoring it as one would blame
          // the reviewer for an outage.
        }
      }

      const calibration = calibrationOf(issued, reReviews);
      const misses = probeMisses(planted, probeVerdicts);

      record(mission.taskId, 'verification', 'reviewer.calibrated', 'reviewer', {
        ...calibration,
        // Planted AND processed, because they differ and the gap matters: a
        // bench full of unusable cases would report zero misses and read as a
        // perfectly calibrated reviewer. Observed live on mission `6082c48e` —
        // 4 planted, 2 processed, because a case left by an old dogfood script
        // carried `{"o": "sealed case"}` where a contract belongs.
        probesPlanted: planted.length,
        probesProcessed: probeVerdicts.length,
        // Every processed probe, not only the failures. "Zero misses" is not
        // evidence unless you can see what was actually caught — and the catch
        // is the half that shows the reviewer working.
        probeResults: probeVerdicts.map((v) => ({
          taskId: v.taskId,
          expected: planted.find((p) => p.taskId === v.taskId)?.expected ?? 'unknown',
          actual: v.outcome,
        })),
        misses,
      });
    } catch {
      // A measurement that fails is a missing measurement, not a failed mission.
    }
  };

  const surrender = (reason: string, blockers: string[]): MissionResult => {
    // The dossier is DERIVED from the trail at the moment of surrender (R37
    // AC-1), not accumulated as the mission ran. A second copy kept alongside
    // the ledger is a second truth, and the two drift.
    //
    // A surrender is a handover, not a total loss: whatever was verified stays
    // verified, and the next attempt should not have to rediscover any of it.
    record(mission.taskId, 'escalation', 'mission.surrendered', 'orchestrator', {
      reason,
      blockers,
      dossier: surrenderDossier(mission, trail, reason, blockers),
    });
    // Fire-and-forget: `surrender` is synchronous and called from deep in the
    // recursion. The record lands in the same trail either way, and awaiting
    // here would mean threading async through every failure path for a
    // measurement that must never delay a result.
    void runCalibration();
    return { outcome: 'surrendered', deliverable: null, trail, escalations };
  };

  /** Surrender from inside the recursion, carried back up rather than thrown. */
  const fail = (reason: string, blockers: string[]): SubtreeOutcome => ({
    ok: false,
    result: surrender(reason, blockers),
  });

  /**
   * How deep splitting may go.
   *
   * Derived from the mission's own contract, not chosen: a split must partition
   * acceptance criteria, so a mission with `n` criteria cannot meaningfully
   * split more than `n` levels — by then every leaf holds one criterion and
   * {@link isAtomic} stops it anyway. The bound exists only so a planner that
   * keeps inventing multi-criterion children cannot recurse forever.
   */
  const depthBound = Math.max(1, mission.acceptanceCriteria.length);

  const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  /**
   * Run one subtree: decompose, gate the plan, run each child, assemble.
   *
   * Recursive because integration is the decomposition tree walked backwards —
   * whoever split the work owns reassembling it, level by level, and every
   * assembly faces the same review gate the leaves did.
   */
  /**
   * Does arriving at this rung mean stopping for a human?
   *
   * Defined once, because there are THREE ways to climb the ladder — staffing
   * failure, bounce, Gate B failure — and they had already drifted: the human
   * rung was honoured on exactly one of them (defect `20878859`). A rule about
   * when a person gets involved cannot live in one branch of three.
   *
   * Records the wait as a side effect, so every path produces the same event
   * with the same payload rather than three near-identical copies.
   */
  const stopsForHuman = async (
    child: TaskContract,
    rung: EscalationRung,
    reasons: readonly string[],
  ): Promise<boolean> => {
    // The dial is read HERE, at the moment the ladder is climbed, which is what
    // makes "applies at the next gate, never retroactively" true by construction
    // rather than by enforcement.
    const dial = seams.control?.currentDial === undefined
      ? null
      : await seams.control.currentDial(mission.missionId).catch(() => null);
    const effectiveDial = dial ?? mission.autonomyDial;
    // "Fully autonomous" must mean nobody is asked, or the setting is decorative
    // in the other direction.
    const humanAt = effectiveDial === 'autonomous' ? null : child.escalationPolicy.humanAt ?? 'human_review';

    // A task the operator has already ruled on does not stop again, or the queue
    // would refill with the item just answered.
    if (humanAt === null || rung !== humanAt || prior.decided.has(child.taskId)) return false;

    record(child.taskId, 'escalation', 'escalation.awaiting_human', 'orchestrator', {
      objective: child.objective,
      rung,
      autonomyDial: effectiveDial,
      findings: [...reasons],
    });
    return true;
  };

  const runSubtree = async (parent: TaskContract, depth: number): Promise<SubtreeOutcome> => {
    // ---- decompose-or-delegate (R31) -----------------------------------------
    // Asked BEFORE any splitting, because the question is whether to split at
    // all. Work that is inherently sequential and constraint-entangled is
    // damaged by being cut up, so the Orchestrator aims atomization rather than
    // reflexively applying it.
    //
    // Skipped on resume: the decision is already in the trail, and re-deciding
    // could reach a different answer than the tree that was actually built.
    const alreadyDecided = prior.childrenOf.has(parent.taskId) || prior.verified.has(parent.taskId);
    let keepWhole = false;
    // WHO decided, carried to Gate A so it can audit the gate's use only where
    // the gate was used (R33 AC-0, clause six). Without this the loop's no-gate
    // default and a real gate decision are distinguishable only by matching
    // rationale prose, which is what forced the clause's first version to be
    // reverted (`bf62266d`).
    let decidedBy: 'gate' | 'default' | null = null;
    /** The template guiding this split, so its outcome can be folded back. */
    let template: { readonly templateId: string; readonly recipe: string } | null = null;

    if (!alreadyDecided) {
      let verdict: { keepWhole: boolean; rationale: string };
      if (seams.decompositionGate === undefined) {
        // Recorded even with no gate configured. A default that recorded nothing
        // would leave the mission claiming a judgement nobody made — the exact
        // shape of the "value written that nothing reads" defects this project
        // has shipped repeatedly, inverted.
        verdict = { keepWhole: false, rationale: 'No decompose-or-delegate gate configured — defaulting to split.' };
        decidedBy = 'default';
      } else {
        try {
          verdict = await seams.decompositionGate.assess({ contract: parent });
          decidedBy = 'gate';
        } catch (error) {
          // A gate that cannot answer must not cost the mission: splitting is
          // the behaviour every caller had before the gate existed.
          verdict = { keepWhole: false, rationale: `Gate could not be evaluated (${describe(error)}) — defaulting to split.` };
          // A gate that could not answer did NOT decide. Auditing its "use"
          // would fault the planner for an outage.
          decidedBy = 'default';
        }
      }

      keepWhole = verdict.keepWhole;
      record(parent.taskId, 'decision', 'decomposition.decided', 'orchestrator', {
        decision: keepWhole ? 'keep_whole' : 'split',
        decidedBy,
        rationale: verdict.rationale,
        objective: parent.objective,
        // The budget the decision implies, so a reviewer can see what "a larger
        // budget" actually meant here rather than inferring it.
        ceiling: parent.budget.ceiling,
        criterionCount: parent.acceptanceCriteria.length,
      });
    }

    // ---- decompose -----------------------------------------------------------
    // A seam that throws is a *failure*, not a crash. Model calls fail for real
    // reasons — a small model running away under constrained decoding, a backend
    // timing out — and a mission that dies on one of those loses its whole ledger
    // trail and tells the operator nothing. Surrender is the designed outcome for
    // "cannot proceed"; an unhandled exception is not.
    let children: TaskContract[] = [];
    const recovered = prior.childrenOf.get(parent.taskId);
    if (keepWhole) {
      // Deliberately nothing: the node is handed whole to a single agent below,
      // with its own full budget rather than a share of it.
    } else if (recovered !== undefined && recovered.length > 0) {
      // Rebuilt from the trail, so every id is the one it had before — which is
      // what makes an operator's earlier decision still refer to this task.
      children = recovered;
    } else {
      // ---- a learned recipe guides the split (R31 AC-2) ------------------
      // Looked up by CAPABILITY — the taxonomy R38's clustering converges — so
      // templates accumulate per kind of work rather than per task, which is
      // what makes them learnable at all. Failure is swallowed: guidance is an
      // improvement, and losing a mission because a recipe lookup failed would
      // trade the work for the advice.
      try {
        template = (await seams.templates?.forCapability(capabilityOf(parent.category))) ?? null;
      } catch {
        template = null;
      }
      if (template !== null) {
        record(parent.taskId, 'decision', 'decomposition.template_used', 'orchestrator', {
          templateId: template.templateId,
          capability: capabilityOf(parent.category),
          recipe: template.recipe,
        });
      }

      // What the registry already handles, shown to the PLANNER (defect
      // `340aa7de`). `staff()` has had this list since R38, but by staffing time
      // the name is already coined and clustering can only merge what shares a
      // token — measured cost of that ordering: 1.07 designs per category.
      // Failure is swallowed: naming guidance is an improvement, not a gate.
      // Filtered for the same reason `staff()` filters: the registry's list is
      // topped by the mission role and salted with the `verification.` namespace,
      // and suggesting either invites the planner to name a subtask after a role
      // the system stamps on contracts itself.
      const known = proposableCapabilities(
        await seams.registry.knownCapabilities?.().catch(() => []) ?? [],
      );

      try {
        children = await decompose(parent, seams.planner, {
          ...(template === null ? {} : { templateRecipe: template.recipe }),
          ...(known.length === 0 ? {} : { knownCapabilities: known }),
        });
      } catch (error) {
        return fail('decomposition failed', [describe(error)]);
      }
    }

    // ---- contract → Gate A, with ONE aimed re-split (R33 AC-1) --------------
    // A Gate A rejection used to surrender the subtree. The criterion asks for
    // the opposite: re-split FROM the verdict rather than retrying blind.
    //
    // Bounded to a single retry on purpose. A planner that cannot repair its
    // plan must not loop, and "try again with better instructions each time" is
    // a way to spend an entire budget rehearsing the same rejection.
    let resplits = 0;
    for (;;) {
    for (const child of children) {
      // Nothing is re-contracted on resume: the event is already in the trail,
      // and re-appending it would make the replay itself unfaithful.
      if (prior.contracts.has(child.taskId)) continue;
      record(child.taskId, 'contract', 'task.contracted', 'orchestrator', {
        objective: child.objective,
        ceiling: child.budget.ceiling,
        blastRadius: child.blastRadius,
        // The graph, not just the label (R15). Edges can only be drawn from data
        // that was recorded — the canvas is a projection, so anything it needs to
        // show has to exist in the trail first.
        category: child.category,
        parentTaskId: child.parentTaskId,
        dependsOn: [...child.dependencies.consumesTaskIds],
        // The contract's OWN criteria, verbatim (defect `f46ba357`). Without them
        // the trail records which criteria failed but never how many there were,
        // so per-clause compliance has no denominator and the inspector cannot
        // say "3 of 4 met". Paraphrasing here would make replay grade different
        // words than the reviewer used.
        acceptanceCriteria: child.acceptanceCriteria.map((c) => ({
          criterionId: c.criterionId,
          statement: c.statement,
        })),
        // The WHOLE contract, so the trail is self-sufficient for replay (R41).
        // The contract is the atom and "the contract is also the key into the
        // ledger" — a trail that cannot reconstruct it can describe a mission
        // but not continue one.
        contract: child,
      });
    }

    // ---- Gate A: audit the PLAN before spending anything on it ---------------
    // Skipped when the plan came from the trail: it was gated when it was first
    // proposed, and re-gating an unchanged plan would spend a model call to
    // re-derive a verdict the ledger already holds.
    // Nothing to audit when nothing was split: Gate A grades a decomposition,
    // and a node kept whole has none. Its work is still verified at Gate B.
    if (keepWhole || (recovered !== undefined && recovered.length > 0)) break;

    let aVerdict;
    try {
      aVerdict = await gateA(parent, children, seams.coverageJudge, seams.planJudge, verdictMeta(seq),
        // Only when this run actually made the decision. On a RESUME the
        // decision is already in the trail and `decidedBy` is null — auditing a
        // decision this run did not make would judge the plan against a
        // judgement it cannot see.
        decidedBy === null ? {} : { decomposition: { decidedBy, keepWhole } });
    } catch (error) {
      return fail('Gate A could not be evaluated', [describe(error)]);
    }
    record(parent.taskId, 'verification', 'gate_a.verdict_issued', 'reviewer', { ...aVerdict });

    // ---- templates accumulate evidence (R31 AC-2) ---------------------------
    // Scored on whether the split SURVIVED GATE A, not on whether the mission
    // succeeded. A template's job is to produce a well-formed decomposition;
    // blaming it for a worker that later failed would grade it on something it
    // has no influence over.
    //
    // And when a split survives with NO template guiding it, that split is the
    // evidence a template is distilled from — otherwise the criterion's given,
    // "a decomposition template in the Asset Registry matching the kind of
    // work", would be unreachable, because nothing else creates one.
    if (seams.templates !== undefined) {
      const capability = capabilityOf(parent.category);
      const survived = aVerdict.outcome === 'pass';
      try {
        if (template !== null) {
          await seams.templates.recordOutcome(template.templateId, survived);
        } else if (survived) {
          const stored = await seams.templates.remember({
            capability,
            // The recipe is the SHAPE of the split that worked, in the planner's
            // own words. Asking a model to summarise "how to split this kind of
            // work" would be a new seam and a new thing to be wrong about; the
            // objectives that passed Gate A are evidence, not a guess.
            recipe:
              `Split into ${children.length} subtasks along these lines: ` +
              children.map((c) => c.objective).join(' | '),
            sourceMissionId: mission.missionId,
          });
          record(parent.taskId, 'decision', 'decomposition.template_learned', 'learning_agent', {
            templateId: stored.templateId, capability, childCount: children.length,
          });
        }
      } catch {
        // Bookkeeping, not the mission. A template store outage must not cost a
        // plan that Gate A just approved.
      }
    }

    if (aVerdict.outcome === 'pass') break;

    const rejectedBecause = aVerdict.findings.map((f) => f.detail);

    // Second rejection: the planner had the verdict and still could not satisfy
    // it. Surrendering here is honest — the alternative is an unbounded loop.
    if (resplits >= 1) {
      return fail('Gate A rejected the decomposition', rejectedBecause);
    }

    resplits += 1;
    record(parent.taskId, 'decision', 'decomposition.resplit', 'orchestrator', {
      objective: parent.objective,
      rejectedBecause,
      detail:
        'Gate A rejected the plan; re-splitting FROM the verdict rather than retrying blind. ' +
        'Re-proposing from the same objective very often reproduces the same plan.',
    });

    try {
      children = await decompose(parent, seams.planner, { rejectedBecause });
    } catch (error) {
      return fail('re-decomposition failed', [describe(error)]);
    }
    }

    // ---- capability audit: can anything here be staffed at all? (R38 AC-3) ---
    // Asked BEFORE a single task executes, because the value of the signal is
    // that it is EARLY: a mission that no-bids across its whole graph is telling
    // the operator something the trail would otherwise only reveal after the
    // budget had been spent finding out the hard way.
    //
    // A warning, never a refusal. A first mission in a new domain no-bids on
    // everything by definition, and refusing to run would leave the swarm unable
    // to acquire a capability it does not yet have.
    if (children.length > 1) {
      const unserved: string[] = [];
      for (const child of children) {
        const bid = await seams.registry.bestForCategory(child.category).catch(() => null);
        if (bid === null) unserved.push(capabilityOf(child.category));
      }

      // SYSTEMATIC, not incidental. One unserved capability among served ones is
      // ordinary — it is how a new specialist enters the registry — and warning
      // on it would fire the signal on almost every mission and mean nothing.
      if (unserved.length === children.length) {
        record(parent.taskId, 'decision', 'staffing.capability_gap', 'agent_creator', {
          noBids: unserved.length,
          taskCount: children.length,
          capabilities: unserved,
          detail:
            'No design in the registry can serve any capability this plan needs. ' +
            'Every specialist will be authored from scratch and judged on its first attempt.',
        });
      }
    }

    // ---- per-leaf: staff → execute → Gate B → escalate ------------------------
    /**
     * What one child came to. `skip` is a task the operator cancelled: it
     * produced nothing and must not be folded, but it did not fail the mission.
     */
    type ChildOutcome =
      | { readonly kind: 'done'; readonly taskId: string; readonly objective: string; readonly deliverable: unknown }
      | { readonly kind: 'skip'; readonly taskId: string }
      | { readonly kind: 'fail'; readonly outcome: SubtreeOutcome };

    /**
     * Where the ladder goes next (R36).
     *
     * The ENTRY rung is a function of the error class; every failure after it
     * climbs exactly one. Those two rules constrain different moments, and the
     * `Math.max` is what reconciles them: a task jumps to where its failure
     * belongs, then walks from there, and never walks BACK to a cheaper remedy
     * it has already been told will not work.
     *
     * Recomputing the entry every time is what makes that non-obvious: a task
     * that failed at re_decomposition and then failed as an ordinary slip would
     * drop to rung 1 and cycle between them forever. `Math.max` makes the ladder
     * monotonic by construction rather than by hoping the classes stay ordered.
     */
    const nextRung = (current: number, errorClass: ErrorClass | null, ladder: readonly EscalationRung[]) => {
      const stepped = current + 1;
      if (errorClass === null) return stepped;
      return Math.max(stepped, entryRungFor(errorClass, ladder));
    };

    const runChild = async (contracted: TaskContract, asLeaf = false): Promise<ChildOutcome> => {
      let child = contracted;

      /**
       * What each attempt looked like, for the stall counter (R36 AC-2).
       *
       * `stallLimit` has been on every contract since P2 and was read by
       * nothing, so a task could be attempted the same way until `maxAttempts`
       * ran out — paying full price each time to learn what it already knew.
       */
      const attempts: AttemptSignature[] = [];

      // Already done, per the trail. Re-running it would spend budget to
      // reproduce a verdict the ledger already carries — and could produce a
      // DIFFERENT answer, which would make the resumed mission disagree with
      // its own history.
      const done = prior.verified.get(child.taskId);
      if (done !== undefined) {
        return { kind: 'done', taskId: child.taskId, objective: child.objective, deliverable: done };
      }

      // A task that is not yet atomic is a PARENT: it assembles, it does not
      // execute. This is the recursion the dossier specifies — "splitting
      // continues until each leaf carries exactly one responsibility with one
      // verifiable outcome — and no further".
      // `asLeaf` is the decompose-or-delegate gate's decision made binding
      // (R31). Without it a kept-whole node carrying several criteria would be
      // found non-atomic here and split one level down — the gate would appear
      // to work while changing nothing at all.
      if (!asLeaf && !isAtomic(child) && depth + 1 < depthBound) {
        const sub = await runSubtree(child, depth + 1);
        if (!sub.ok) return { kind: 'fail', outcome: sub };
        return { kind: 'done', taskId: child.taskId, objective: child.objective, deliverable: sub.deliverable };
      }

      const ladder = child.escalationPolicy.ladder;
      let rungIndex = -1;
      let tierBump = 0;
      let delivered: unknown = null;
      let settled = false;
      let cancelled = false;
      let paused = false;
      let awaitingHuman = false;

      // Bounded by the ladder AND by maxAttempts — whichever runs out first.
      const maxAttempts = Math.min(child.stoppingConditions.maxAttempts, ladder.length + 1);

      let retriesUsed = 0;

      // Effort is a currency (invariant #7), so somebody has to charge for it.
      // The ceiling is DERIVED — the contract's, plus whatever the operator has
      // granted — which is what makes R17's top-up raise a real limit rather
      // than a decorative one.
      // The design the LAST attempt ran, so a redesign can name what it
      // replaces. Loop-scoped on purpose: `manifest` is declared per attempt, so
      // reading it at staffing time read the fresh `undefined` and every
      // redesign registered as an origin (defect `cb939996`).
      let lastDesignId: string | null = null;

      const granted = seams.control?.grantedBudget === undefined
        ? 0
        : await seams.control.grantedBudget(child.taskId).catch(() => 0);
      const effectiveCeiling = child.budget.ceiling + granted;
      let spent = 0;

      for (let attempt = 0; attempt < maxAttempts && !settled; attempt += 1) {
        if (spent >= effectiveCeiling) {
          // A ceiling that stops nothing is not a ceiling. Recorded with both
          // figures so the stop is auditable and a grant can be sized against it.
          record(child.taskId, 'economic', 'task.budget_exhausted', 'orchestrator', {
            objective: child.objective, spent, ceiling: effectiveCeiling, granted,
          });

          // The ladder's budget remedy, PRODUCED though it cannot be run
          // (ADR-0011, defect `e758f460`). `budget_exhaustion` is the only class
          // entering at `agent_redesign`, and a bundle that overran the ceiling
          // has by construction pushed `spent` over it too — so this guard fired
          // before the redesign could ever be staffed, and the rung was dead.
          //
          // Both halves stay honest: no further attempt EXECUTES, so the ceiling
          // still stops the spend; but the remedy the ledger says was escalated
          // to is really authored and registered, with the design that overspent
          // as its parent. That is where lineage is born. It arrives unproven and
          // cannot be promoted without harness evidence (R28 AC-2) — it simply
          // gives the next task in this category something cheaper to bid.
          if (rungIndex >= 0 && ladder[rungIndex] === 'agent_redesign' && lastDesignId !== null) {
            try {
              const replacement = await staff({
                contract: child,
                registry: seams.registry,
                author: seams.author,
                redesignFrom: lastDesignId,
                fanIn: children.filter((c) => c.dependencies.consumesTaskIds.includes(child.taskId)).length,
                // No headroom left — that is the whole reason we are here, and
                // the tier policy should size the replacement against it.
                budgetHeadroom: 0,
              });
              record(child.taskId, 'staffing', 'agent.redesigned', 'agent_creator', {
                designId: replacement.designId,
                version: replacement.version,
                replaces: lastDesignId,
                detail:
                  `produced but not run: the task spent ${spent} against a ceiling of ${effectiveCeiling}`,
              });
            } catch (error) {
              // A remedy that could not be authored is worth recording as such —
              // silence here would read exactly like the dead rung this fixes.
              record(child.taskId, 'staffing', 'agent.redesign_failed', 'agent_creator', {
                replaces: lastDesignId, detail: describe(error),
              });
            }
          }
          break;
        }

        // Checked HERE, at the attempt boundary, and nowhere else. That is what
        // makes a pause graceful: work already in flight finishes its attempt,
        // because the only place the runtime asks is before starting the next.
        if (seams.control !== undefined) {
          const signal = await seams.control.check(child.taskId);

          if (signal === 'cancelled') {
            // Cancellation is accounted, not vanished: a task that simply
            // stopped appearing would be indistinguishable from one never
            // contracted, and cancelled work still teaches.
            record(child.taskId, 'decision', 'task.cancelled', 'human', {
              objective: child.objective, attemptsUsed: attempt,
            });
            cancelled = true;
            break;
          }

          if (signal === 'paused') {
            record(child.taskId, 'decision', 'task.paused', 'human', { objective: child.objective });
            // A paused task yields rather than spins: the mission stops here and
            // a resume starts a fresh run. Blocking would hold the worker
            // hostage to a human's lunch break.
            paused = true;
            break;
          }
        }

        let manifest;
        try {
          manifest = await staff({
            contract: child,
            registry: seams.registry,
            author: seams.author,
            // The `agent_redesign` rung, ENACTED (R28 AC-0). Until now it was a
            // name in the ladder that changed nothing: the loop climbed past it
            // and staffed the same design again. A redesign is derived from the
            // design that failed, so this is where lineage is born — and the
            // clade score has had a recursive query and no ancestry to walk
            // since R28 (defect `cb939996`).
            //
            // `undefined` on every other rung, so ordinary staffing keeps
            // reusing a proven incumbent and R38's reuse market is untouched.
            ...(rungIndex >= 0 && ladder[rungIndex] === 'agent_redesign'
              ? { redesignFrom: lastDesignId }
              : {}),
            // Both derived, and both previously supplied by nobody: the tier
            // policy has always accepted them and always received defaults.
            fanIn: children.filter((c) => c.dependencies.consumesTaskIds.includes(child.taskId)).length,
            budgetHeadroom: effectiveCeiling <= 0 ? 0 : Math.max(0, (effectiveCeiling - spent) / effectiveCeiling),
          });
        } catch (error) {
          rungIndex += 1;
          if (rungIndex >= ladder.length) break;
          record(child.taskId, 'escalation', 'escalation.rung_climbed', 'orchestrator', {
            rung: ladder[rungIndex], reason: `staffing failed: ${describe(error)}`,
          });
          escalations.push({ taskId: child.taskId, rung: ladder[rungIndex]!, fromTier: 1, toTier: 1, reason: describe(error) });
          continue;
        }
        lastDesignId = manifest.designId;
        const tier = Math.min(manifest.logicalTier + tierBump, FRONTIER_TIER) as LogicalTier;
        record(child.taskId, 'staffing', 'agent.staffed', 'agent_creator', {
          designId: manifest.designId,
          // WHICH capability the planner's raw category resolved to (defect
          // `340aa7de`). The event recorded which DESIGN ran and not what kind
          // of work it was, so the weak-spot ranker had to fall back to the raw
          // `task.contracted` name — re-splitting buckets that staffing had
          // already merged.
          capability: manifest.category,
          // The version, not just the design: a clade score attributes
          // performance to a lineage, and "which version was this" is the join key.
          version: manifest.version,
          logicalTier: tier,
          attempt: attempt + 1,
        });

        const { verificationPlan: _withheld, ...workerView } = child;
        let outcome;
        try {
          const context = await brokerContext(child, manifest.designId);
          outcome = await runSpecialist({
            contract: workerView, agentId: manifest.designId, judge: seams.clarityJudge, work: seams.work,
            bundleId: `${child.taskId.slice(0, 24)}${(attempt + 0xb00000).toString(16).padStart(12, '0')}`,
            producedAt: now(),
            priorKnowledge: context.payload,
            consulted: context.consulted,
          });
        } catch (error) {
          // Retry the same tier first. Only a repeated failure is evidence of a
          // problem the ladder can actually remedy.
          if (retriesUsed < transientRetries) {
            retriesUsed += 1;
            record(child.taskId, 'execution', 'task.retried', 'worker', {
              reason: describe(error), attempt: retriesUsed,
            });
            attempt -= 1; // a retry is not an attempt against the ladder
            continue;
          }
          record(child.taskId, 'execution', 'task.failed', 'worker', { reason: describe(error) });
          rungIndex += 1;
          if (rungIndex >= ladder.length) break;
          const rung = ladder[rungIndex]!;
          const fromTier = tier;
          if (rung === 'retry_higher_tier') tierBump += 1;
          const toTier = Math.min(manifest.logicalTier + tierBump, FRONTIER_TIER) as LogicalTier;
          escalations.push({ taskId: child.taskId, rung, fromTier, toTier, reason: describe(error) });
          record(child.taskId, 'escalation', 'escalation.rung_climbed', 'orchestrator', {
            rung, fromTier, toTier, reason: describe(error),
          });
          continue;
        }

        if (outcome.kind === 'bounced') {
          record(child.taskId, 'execution', 'task.bounced', 'worker', { ambiguities: outcome.ambiguities });

          // The error class picks the rung (R36). A bounce is a SPECIFICATION
          // fault: the contract could not be restated, so nothing about running it
          // again — at any size of model — addresses the problem. Climbing one rung
          // from the bottom lands on `retry_higher_tier`, and measurement across
          // the local ladder showed a bigger model is *worse* at this gate
          // (2b 33% false-bounce, 9b 17%, 12b 58%), so the default remedy actively
          // increased the chance of bouncing again.
          // Generalised into `entryRungFor` (R36): this site had the rule inline
          // and every other escalation site ignored the class entirely.
          rungIndex = nextRung(rungIndex, 'specification_fault', ladder);
          if (rungIndex >= ladder.length) break;

          const rung = ladder[rungIndex]!;
          const reason = `contract was bounced as ambiguous: ${outcome.ambiguities.join('; ')}`;
          escalations.push({ taskId: child.taskId, rung, fromTier: tier, toTier: tier, reason });
          record(child.taskId, 'escalation', 'escalation.rung_climbed', 'orchestrator', { rung, reason });

          // A bounce climbs the ladder like anything else, so it can arrive at
          // the human rung too — and until defect `20878859` it walked straight
          // past. Bouncing is not a rare path: it is how the system answers an
          // unclear contract, and the clarity judge false-bounces 17-58% of the
          // time depending on model.
          if (await stopsForHuman(child, rung, outcome.ambiguities)) {
            awaitingHuman = true;
            break;
          }

          // Enact the rung rather than merely recording it: rewrite the contract
          // the worker could not read. Without a clarifier the loop still climbs
          // and surrenders — honestly, but unable to repair anything.
          if (seams.clarifier !== undefined) {
            try {
              const rewritten = await seams.clarifier.clarify({
                contract: child,
                ambiguities: outcome.ambiguities,
              });
              child = {
                ...child,
                objective: rewritten.objective,
                ...(rewritten.acceptanceCriteria === null
                  ? {}
                  : { acceptanceCriteria: [...rewritten.acceptanceCriteria] }),
              };
              record(child.taskId, 'decision', 'task.recontracted', 'orchestrator', {
                objective: child.objective, reason: 'rewritten after a bounce',
              });
            } catch (error) {
              // A clarifier that fails leaves the original contract standing; the
              // ladder has already advanced, so this cannot loop.
              record(child.taskId, 'decision', 'task.recontract_failed', 'orchestrator', {
                reason: describe(error),
              });
            }
          }
          continue;
        }

        // ---- the deliverable must be an ANSWER, not JSON (defect 08db92fd) --
        // Measured at 2 of 65 executions: the model returns serialised JSON in a
        // field declared as a plain string, which passes schema validation
        // because it genuinely IS a non-empty string. Checked BEFORE Gate B for
        // the same reason as the floor — the reviewer reads the deliverable as
        // prose and may well find the criterion met, recording a pass on work
        // that is unreadable.
        const malformed = jsonLeak(outcome.bundle.deliverable);
        if (malformed !== null) {
          record(child.taskId, 'decision', 'task.malformed_deliverable', 'orchestrator', {
            objective: child.objective,
            shape: malformed,
            detail:
              'The deliverable is serialised JSON rather than an answer — the model wrote structure into a field that asked for prose.',
          });

          // Costs a rung, not the task. Corruption runs at roughly 3%, so a
          // retry overwhelmingly returns something good; failing outright would
          // throw away the other 97%.
          //
          // Classed as a SCHEMA VIOLATION (R36): the model wrote structure into
          // a field that asked for prose, which is a formatting failure rather
          // than a thinking one, and a bigger model holds structure better.
          rungIndex = nextRung(rungIndex, 'schema_violation', ladder);
          if (rungIndex >= ladder.length) break;
          const rung = ladder[rungIndex]!;
          if (rung === 'retry_higher_tier') tierBump += 1;
          const toTier = Math.min(manifest.logicalTier + tierBump, FRONTIER_TIER) as LogicalTier;
          escalations.push({
            taskId: child.taskId, rung, fromTier: tier, toTier,
            reason: `delivered ${malformed} instead of an answer`,
          });
          record(child.taskId, 'escalation', 'escalation.rung_climbed', 'orchestrator', {
            rung, fromTier: tier, toTier, reason: 'malformed deliverable',
          });
          continue;
        }

        // ---- the effort FLOOR binds too (R40 AC-2) --------------------------
        // "Budgets bind in both directions": a ceiling prevents runaway effort,
        // a floor prevents drive-by shallow work. Checked BEFORE Gate B on
        // purpose — the floor is a claim about effort, and the reviewer does not
        // measure effort. Passing thin work to a judge that may well approve it
        // would record a pass for work nobody did.
        if (outcome.bundle.effortSpent < child.budget.floor) {
          record(child.taskId, 'decision', 'task.below_effort_floor', 'orchestrator', {
            objective: child.objective,
            effortSpent: outcome.bundle.effortSpent,
            floor: child.budget.floor,
            detail:
              "Delivered below the contract's effort floor — treated as drive-by shallow work, not cheap success.",
          });

          // Costs a rung, not the task: the ladder exists so a shallow attempt
          // can be retried by something with more to spend. An ordinary slip
          // (R36) — the work was done, just too thinly.
          rungIndex = nextRung(rungIndex, 'execution_error', ladder);
          if (rungIndex >= ladder.length) break;
          const rung = ladder[rungIndex]!;
          if (rung === 'retry_higher_tier') tierBump += 1;
          const toTier = Math.min(manifest.logicalTier + tierBump, FRONTIER_TIER) as LogicalTier;
          escalations.push({
            taskId: child.taskId, rung, fromTier: tier, toTier,
            reason: `delivered ${outcome.bundle.effortSpent} against a floor of ${child.budget.floor}`,
          });
          record(child.taskId, 'escalation', 'escalation.rung_climbed', 'orchestrator', {
            rung, fromTier: tier, toTier, reason: 'below effort floor',
          });
          continue;
        }

        spent += outcome.bundle.effortSpent;
        const executedEventId = record(child.taskId, 'execution', 'task.executed', 'worker', {
          bundleId: outcome.bundle.bundleId,
          // Cost belongs in the trail: value-per-effort is the system's fitness
          // function, and it cannot be computed from a bundle id.
          effortSpent: outcome.bundle.effortSpent,
          ceiling: child.budget.ceiling,
          // "deliverables with evidence bundles" is what the execution family is
          // specified to hold. Without it a resumed mission knows a task passed
          // but not what it produced, so fold-up would have nothing to assemble.
          deliverable: outcome.bundle.deliverable,
          // The rest of the bundle (R40 AC-1). "Its deliverable must be
          // verifiable by a stranger who watched none of the work" — which the
          // trail could not support while it carried only the answer. This is
          // also the producer defect `d0d555db` was waiting for: assumptions
          // now reach the ledger, so a requester can be told what was taken for
          // granted rather than shown an honest blank.
          //
          // Recorded even when empty: absent and empty are different claims,
          // and "nothing was assumed" must not be indistinguishable from
          // "nobody recorded it".
          actions: outcome.bundle.actions,
          consulted: outcome.bundle.consulted,
          assumptions: outcome.bundle.assumptions,
        });

        // ---- the verifier is STAFFED, and lineage overlap is refused (R35 AC-2)
        // Gate B's judge was a bare model call, so "the verifier shares no design
        // lineage with the author" had nothing to check. Staffing one gives the
        // constitutional rule a subject — and the refusal, when it fires, is
        // recorded rather than silently absorbed, because a rule nobody can see
        // working is indistinguishable from one that never fires.
        //
        // Failure is swallowed: independence is a property of the REVIEW, and a
        // registry outage must degrade it to the old unattributed reviewer
        // rather than stop a mission from being verified at all.
        let verifierDesignId: string | undefined;
        try {
          const verifier = await staffVerifier({
            contract: child,
            registry: seams.registry,
            author: seams.author,
            producerDesignId: manifest.designId,
          });
          verifierDesignId = verifier.designId;
          record(child.taskId, 'staffing', 'verifier.staffed', 'agent_creator', {
            designId: verifier.designId,
            version: verifier.version,
            producerDesignId: manifest.designId,
            ...(verifier.refusedBid === null
              ? {}
              : { refusedBid: verifier.refusedBid, refusalReason: verifier.refusalReason }),
          });
        } catch (error) {
          record(child.taskId, 'staffing', 'verifier.unstaffed', 'agent_creator', {
            producerDesignId: manifest.designId, reason: describe(error),
          });
        }

        let bVerdict;
        try {
          bVerdict = await gateB(
            child, outcome.bundle, seams.completionJudge, seams.intentJudge, verdictMeta(seq, verifierDesignId),
          );
        } catch (error) {
          record(child.taskId, 'verification', 'gate_b.unevaluable', 'reviewer', { reason: describe(error) });
          rungIndex += 1;
          if (rungIndex >= ladder.length) break;
          const rung = ladder[rungIndex]!;
          const fromTier = tier;
          if (rung === 'retry_higher_tier') tierBump += 1;
          const toTier = Math.min(manifest.logicalTier + tierBump, FRONTIER_TIER) as LogicalTier;
          escalations.push({ taskId: child.taskId, rung, fromTier, toTier, reason: describe(error) });
          record(child.taskId, 'escalation', 'escalation.rung_climbed', 'orchestrator', {
            rung, fromTier, toTier, reason: describe(error),
          });
          continue;
        }
        const verdictEventId = record(child.taskId, 'verification', 'gate_b.verdict_issued', 'reviewer', { ...bVerdict });

        // ---- the fast loop's input (R26) ---------------------------------
        // One outcome per criterion, keyed by the CATEGORY that did the work.
        // A criterion is failed when a finding names it; Gate B records findings
        // only for failures, so absence is the pass.
        const failedCriteria = new Set(bVerdict.findings.map((f) => f.criterionId));
        designFor.set(child.category, manifest.designId);
        for (const criterion of child.acceptanceCriteria) {
          gateBOutcomes.push({
            taskId: child.taskId,
            category: child.category,
            criterionId: criterion.criterionId,
            passed: !failedCriteria.has(criterion.criterionId),
          });
        }
        await runFastLoop(false);

        // The design's track record, folded from the verdict the reviewer just
        // issued (R38/R28). Derived, not invented: a pass is 1 and a fail is 0,
        // because Gate B's verdict is the only measurement of a design the
        // system actually has.
        //
        // Without this the Asset Registry can never reach its evidence bar
        // (`observations >= 3`), so every bid is a no-bid however much the
        // registry holds — the registry was inert for exactly this reason
        // (defect `41f7555c`). Failure is swallowed: a track record is a cost
        // lever, not a reason to lose verified work.
        await seams.registry.recordOutcome?.(
          manifest.designId,
          bVerdict.outcome === 'pass' ? 1 : 0,
          // The COST axis of the Pareto front (R28 AC-1), taken from the effort
          // this attempt actually spent. Omitting it leaves `mean_effort` null
          // forever, and a front that needs both axes would stay permanently
          // empty — the cost half of "cheaper-but-adequate" with no data.
          outcome.bundle.effortSpent,
        ).catch(() => undefined);

        if (bVerdict.outcome === 'pass') {
          // ---- the finding reaches the commons (defect `753bc6dd`) ----------
          // Submitted ONLY here. Gate B's pass is the admission ticket: doing it
          // at execution would fill the store with the unreviewed output that
          // quarantine exists to keep out.
          //
          // The claim is the verified deliverable keyed to the objective that
          // produced it. A cleverer producer would ask a model to extract
          // "reusable knowledge" — a new seam and a new thing to be wrong about
          // — but the store was built guilty-until-proven-useful precisely so
          // the producer need not be a perfect judge: everything lands in
          // quarantine, and only a stranger's re-derivation publishes a
          // high-impact claim. A parochial finding sits there harmlessly.
          //
          // Impact is DERIVED from blast radius, which already says what being
          // wrong costs; a second scale could only disagree with the first.
          //
          // Failure is swallowed for the same reason the track record's is: a
          // knowledge store is a side benefit, and losing verified work because
          // a bookkeeping write failed trades the product for the receipt.
          await seams.commons?.submit({
            claim: `${child.objective} ${JSON.stringify(outcome.bundle.deliverable)}`,
            impact: child.blastRadius === 'high' ? 'high' : 'low',
            provenance: {
              producedByDesignId: manifest.designId,
              missionId: mission.missionId,
              taskId: child.taskId,
              evidence: [executedEventId, verdictEventId],
              verifiedBy: 'gate_b',
            },
          }).catch(() => undefined);

          delivered = outcome.bundle.deliverable;
          settled = true;
          break;
        }

        // ---- the stall counter (R36 AC-2) -----------------------------------
        // Recorded BEFORE the rung is chosen, because a stall changes which rung
        // is correct: repeating an attempt has told us that whatever is wrong is
        // not something another identical attempt will find.
        attempts.push({
          tier,
          designId: manifest.designId,
          errorClasses: bVerdict.findings.map((f) => f.errorClass),
        });

        const stalled = isStalled(attempts, child.stoppingConditions.stallLimit);
        if (stalled) {
          record(child.taskId, 'decision', 'task.stalled', 'orchestrator', {
            objective: child.objective,
            attempts: attempts.length,
            stallLimit: child.stoppingConditions.stallLimit,
            detail:
              `The same attempt has repeated ${child.stoppingConditions.stallLimit} times — same tier, ` +
              `same design, same failure. Another identical attempt would learn nothing the last two did not.`,
          });
        }

        // ---- the error class picks where the ladder is entered (R36) --------
        // The WORST class among the findings, because a verdict naming both a
        // specification fault and an ordinary slip has told us the task is
        // specified wrong; retrying it would rehearse exactly that.
        const entryClass = worstClass(bVerdict.findings.map((f) => f.errorClass), ladder);

        // A stall outranks the verdict's own class. `execution_error` would send
        // an identical attempt back to `retry_same`, which is precisely the
        // thing that has already failed twice.
        rungIndex = nextRung(rungIndex, stalled ? 'stall' : entryClass, ladder);
        if (rungIndex >= ladder.length) break;
        const rung = ladder[rungIndex]!;

        if (await stopsForHuman(child, rung, bVerdict.findings.map((f) => f.detail))) {
          awaitingHuman = true;
          break;
        }
        const fromTier = tier;
        // A tier bump IS a rung, so only that rung changes the tier; the others
        // change who or what runs, not how much model is thrown at it.
        if (rung === 'retry_higher_tier') tierBump += 1;
        const toTier = Math.min(manifest.logicalTier + tierBump, FRONTIER_TIER) as LogicalTier;

        escalations.push({
          taskId: child.taskId, rung, fromTier, toTier,
          reason: bVerdict.findings.map((f) => f.detail).join('; '),
        });
        record(child.taskId, 'escalation', 'escalation.rung_climbed', 'orchestrator', {
          rung, fromTier, toTier,
          errorClasses: bVerdict.findings.map((f) => f.errorClass),
          // WHICH class chose the rung. An escalation that skipped rungs without
          // saying why reads like a bug to whoever finds it in the trail.
          entryClass,
        });
      }

      if (cancelled) {
        // Excluded from the assembly: folding a deliverable the operator stopped
        // would put the cancelled work in the result anyway.
        return { kind: 'skip', taskId: child.taskId };
      }

      if (awaitingHuman) {
        return { kind: 'fail', outcome: fail(
          `task ${child.taskId} awaits a human decision`,
          [`"${child.objective}" reached the human rung of its escalation ladder`],
        ) };
      }

      if (paused) {
        return { kind: 'fail', outcome: fail(
          `task ${child.taskId} is paused by an operator`,
          [`"${child.objective}" is paused — resume it to continue this mission`],
        ) };
      }

      if (!settled) {
        return { kind: 'fail', outcome: fail(
          `task ${child.taskId} exhausted its escalation ladder`,
          [`"${child.objective}" could not be verified within ${maxAttempts} attempts`],
        ) };
      }

      return { kind: 'done', taskId: child.taskId, objective: child.objective, deliverable: delivered };
    };

    // ---- kept whole: one agent, the node's own full budget (R31 AC-1) --------
    if (keepWhole) {
      const outcome = await runChild(parent, true);
      if (outcome.kind === 'fail') return outcome.outcome;
      if (outcome.kind === 'skip') {
        return fail(
          `task ${parent.taskId} was cancelled`,
          [`"${parent.objective}" was cancelled by an operator before it produced anything`],
        );
      }
      // No fold-up: there are no siblings to reconcile. Folding one deliverable
      // would spend a model call to rephrase it, and rephrasing is exactly the
      // damage keeping the work whole was meant to avoid.
      return { ok: true, deliverable: outcome.deliverable };
    }

    // ---- schedule across the dependency graph (R32) ---------------------------
    // Everything whose declared inputs are satisfied runs at once; only a real
    // edge causes a wait. Before this, siblings ran in declaration order and the
    // timeline lens measured the cost: waits of 3s/11s/19s against runs of
    // 7s/8s/7s, each lane queued behind the sum of its predecessors.
    const within = new Set(children.map((c) => c.taskId));
    /** Produced a usable, GATE-B-VERIFIED output. */
    const verified = new Set<string>();
    const results = new Map<string, { objective: string; deliverable: unknown }>();

    // An edge to something outside this sibling set is not ours to wait on —
    // only these siblings are being scheduled here.
    const ready = (c: TaskContract): boolean =>
      c.dependencies.consumesTaskIds.every((id) => !within.has(id) || verified.has(id));

    let pending = [...children];
    while (pending.length > 0) {
      const ready_ = pending.filter(ready);
      // Effort scaling (R38 AC-2): only as many run at once as the parent's
      // budget can carry at their floors, narrowed further when the wave
      // carries blast radius. Without this the scheduler starts everything
      // ready, which is the "fifty agents for a triviality" half of the
      // criterion — and on a large graph it commits the whole budget before
      // the first verdict comes back.
      const wave = ready_.slice(0, concurrencyFor(parent, ready_));

      if (wave.length === 0) {
        // Nothing can start and nothing is running. Either a producer was
        // cancelled, or a cycle slipped past Gate A. Surrender naming the
        // blocked tasks rather than waiting forever — a scheduler that hangs
        // tells the operator nothing at all.
        return fail(
          'no task can start — every remaining task is waiting on an input that will never arrive',
          pending.map((c) => `"${c.objective}" waits on ${c.dependencies.consumesTaskIds.join(', ')}`),
        );
      }

      pending = pending.filter((c) => !wave.includes(c));

      const outcomes = await Promise.all(wave.map((c) => runChild(c)));

      // Every outcome in the wave is folded in before any failure is returned,
      // so work that WAS verified stays verified in the trail. Losing it would
      // make a resumed mission (R41) redo what the ledger already paid for.
      let failure: SubtreeOutcome | null = null;
      for (const outcome of outcomes) {
        if (outcome.kind === 'fail') failure ??= outcome.outcome;
        else if (outcome.kind === 'done') {
          verified.add(outcome.taskId);
          results.set(outcome.taskId, { objective: outcome.objective, deliverable: outcome.deliverable });
        }
      }
      if (failure !== null) return failure;
    }

    // Assembled in DECLARATION order, not completion order: fold-up must not
    // depend on which sibling happened to finish first, or the same mission
    // could fold differently on a re-run.
    const completed = children
      .map((c) => results.get(c.taskId))
      .filter((r): r is { objective: string; deliverable: unknown } => r !== undefined);

    // ---- fold up -------------------------------------------------------------
    let folded;
    try {
      folded = await foldUp(parent, completed, seams.reconciler);
    } catch (error) {
      return fail('fold-up failed', [describe(error)]);
    }
    const isMission = parent.taskId === mission.taskId;
    record(parent.taskId, 'contract', isMission ? 'mission.folded' : 'task.folded', 'orchestrator', {
      childCount: folded.childCount,
      conflicts: folded.conflicts,
      // Only the MISSION fold carries a pedigree (R37 AC-0). An inner fold is
      // an intermediate step, and attaching a whole-mission account to each one
      // would repeat the same growing blob at every level of the tree.
      ...(isMission ? { pedigree: pedigreeOf(mission, trail) } : {}),
    });


    return { ok: true, deliverable: folded.deliverable };
  };

  const root = await runSubtree(mission, 0);

  // The fast loop's window closes with the mission, on BOTH terminal paths and
  // BEFORE the surrender returns (R26 AC-1). Placed here rather than inside
  // `surrender` for two reasons: the surrender path returns immediately below,
  // so a mechanism attached only to the delivered path would silently miss half
  // the missions — the exact shape R37's pedigree had — and it is awaited, so a
  // mission can never finish with an experiment still patched into the registry.
  // Nobody is coming to tidy up.
  await runFastLoop(true);

  if (!root.ok) return root.result;

  // ---- one terminal event for EVERY delivered mission (R37 AC-0) ------------
  // The pedigree used to hang off `mission.folded`, and a mission the
  // decompose-or-delegate gate keeps WHOLE never folds — it delivered with no
  // pedigree and no terminal event at all, which is also why the fleet view had
  // nothing to mark such a mission finished with. Found on live mission
  // d042175f, where the worker logged "delivered" and the trail simply stopped.
  //
  // Recorded here rather than in the fold so it fires on both paths exactly
  // once. The fold keeps its own pedigree for the split case, where it is the
  // event that actually assembled the result.
  record(mission.taskId, 'contract', 'mission.delivered', 'orchestrator', {
    objective: mission.objective,
    pedigree: pedigreeOf(mission, trail),
  });

  await runCalibration();

  return { outcome: 'delivered', deliverable: root.deliverable, trail, escalations };
}
