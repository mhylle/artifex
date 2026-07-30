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
import type { EscalationRung, LedgerEventInput, LogicalTier, TaskContract } from '@artifex/shared-types';

import { staff } from './agent-creator.js';
import type { DesignAuthor, RegistryLookup } from './agent-creator.js';
import { decompose, foldUp } from './orchestrator.js';
import type { Planner, Reconciler } from './orchestrator.js';
import { gateA, gateB } from './reviewer.js';
import type { CompletionJudge, CoverageJudge } from './reviewer.js';
import { runSpecialist } from './specialist.js';
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
  ): void => {
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
  };

  const verdictMeta = (n: number) => ({
    verdictId: `${mission.taskId.slice(0, 24)}${(n + 0xf00000).toString(16).padStart(12, '0')}`,
    reviewerId: mission.taskId,
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

  const surrender = (reason: string, blockers: string[]): MissionResult => {
    record(mission.taskId, 'escalation', 'mission.surrendered', 'orchestrator', { reason, blockers });
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

    if (!alreadyDecided) {
      let verdict: { keepWhole: boolean; rationale: string };
      if (seams.decompositionGate === undefined) {
        // Recorded even with no gate configured. A default that recorded nothing
        // would leave the mission claiming a judgement nobody made — the exact
        // shape of the "value written that nothing reads" defects this project
        // has shipped repeatedly, inverted.
        verdict = { keepWhole: false, rationale: 'No decompose-or-delegate gate configured — defaulting to split.' };
      } else {
        try {
          verdict = await seams.decompositionGate.assess({ contract: parent });
        } catch (error) {
          // A gate that cannot answer must not cost the mission: splitting is
          // the behaviour every caller had before the gate existed.
          verdict = { keepWhole: false, rationale: `Gate could not be evaluated (${describe(error)}) — defaulting to split.` };
        }
      }

      keepWhole = verdict.keepWhole;
      record(parent.taskId, 'decision', 'decomposition.decided', 'orchestrator', {
        decision: keepWhole ? 'keep_whole' : 'split',
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
      try {
        children = await decompose(parent, seams.planner);
      } catch (error) {
        return fail('decomposition failed', [describe(error)]);
      }
    }

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
    if (!keepWhole && (recovered === undefined || recovered.length === 0)) {
    let aVerdict;
    try {
      aVerdict = await gateA(parent, children, seams.coverageJudge, verdictMeta(seq));
    } catch (error) {
      return fail('Gate A could not be evaluated', [describe(error)]);
    }
    record(parent.taskId, 'verification', 'gate_a.verdict_issued', 'reviewer', { ...aVerdict });

    if (aVerdict.outcome === 'fail') {
      return fail('Gate A rejected the decomposition', aVerdict.findings.map((f) => f.detail));
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

    const runChild = async (contracted: TaskContract, asLeaf = false): Promise<ChildOutcome> => {
      let child = contracted;

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
          manifest = await staff({ contract: child, registry: seams.registry, author: seams.author });
        } catch (error) {
          rungIndex += 1;
          if (rungIndex >= ladder.length) break;
          record(child.taskId, 'escalation', 'escalation.rung_climbed', 'orchestrator', {
            rung: ladder[rungIndex], reason: `staffing failed: ${describe(error)}`,
          });
          escalations.push({ taskId: child.taskId, rung: ladder[rungIndex]!, fromTier: 1, toTier: 1, reason: describe(error) });
          continue;
        }
        const tier = Math.min(manifest.logicalTier + tierBump, FRONTIER_TIER) as LogicalTier;
        record(child.taskId, 'staffing', 'agent.staffed', 'agent_creator', {
          designId: manifest.designId,
          // The version, not just the design: a clade score attributes
          // performance to a lineage, and "which version was this" is the join key.
          version: manifest.version,
          logicalTier: tier,
          attempt: attempt + 1,
        });

        const { verificationPlan: _withheld, ...workerView } = child;
        let outcome;
        try {
          outcome = await runSpecialist({
            contract: workerView, agentId: manifest.designId, judge: seams.clarityJudge, work: seams.work,
            bundleId: `${child.taskId.slice(0, 24)}${(attempt + 0xb00000).toString(16).padStart(12, '0')}`,
            producedAt: now(),
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
          const reDecomposition = ladder.indexOf('re_decomposition');
          rungIndex = reDecomposition > rungIndex ? reDecomposition : rungIndex + 1;
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

        spent += outcome.bundle.effortSpent;
        record(child.taskId, 'execution', 'task.executed', 'worker', {
          bundleId: outcome.bundle.bundleId,
          // Cost belongs in the trail: value-per-effort is the system's fitness
          // function, and it cannot be computed from a bundle id.
          effortSpent: outcome.bundle.effortSpent,
          ceiling: child.budget.ceiling,
          // "deliverables with evidence bundles" is what the execution family is
          // specified to hold. Without it a resumed mission knows a task passed
          // but not what it produced, so fold-up would have nothing to assemble.
          deliverable: outcome.bundle.deliverable,
        });

        let bVerdict;
        try {
          bVerdict = await gateB(child, outcome.bundle, seams.completionJudge, verdictMeta(seq));
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
        record(child.taskId, 'verification', 'gate_b.verdict_issued', 'reviewer', { ...bVerdict });

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
          delivered = outcome.bundle.deliverable;
          settled = true;
          break;
        }

        // ---- exactly ONE rung per failure -----------------------------------
        rungIndex += 1;
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
          rung, fromTier, toTier, errorClasses: bVerdict.findings.map((f) => f.errorClass),
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
      const wave = pending.filter(ready);

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
    record(parent.taskId, 'contract', parent.taskId === mission.taskId ? 'mission.folded' : 'task.folded', 'orchestrator', {
        childCount: folded.childCount, conflicts: folded.conflicts,
      });


    return { ok: true, deliverable: folded.deliverable };
  };

  const root = await runSubtree(mission, 0);
  if (!root.ok) return root.result;

  return { outcome: 'delivered', deliverable: root.deliverable, trail, escalations };
}
