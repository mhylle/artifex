/**
 * The Reviewer — Gate A before execution, Gate B after (invariant #3).
 *
 * Both judgements are semantic, so both take a judge seam (model-backed in
 * production). What is *not* delegated is the bookkeeping around the judgement,
 * and that separation is the whole design: a judge is an LLM, and an LLM asked
 * to assess five criteria will sometimes return four. If the gate simply trusted
 * the list it was handed, a silently-skipped criterion would read as a pass —
 * the gate would stop gating while still reporting success.
 *
 * So the deterministic half enforces two rules the judge cannot bend:
 *   - **every** criterion in the contract must be accounted for; an omission is a
 *     failure, never an implicit pass;
 *   - the judge may not report on criteria the contract never had, because a
 *     judge inventing criteria is grading a different task.
 */
import type { EvidenceBundle, LedgerEventInput, TaskContract, Verdict } from '@artifex/shared-types';

import { affirmsTestability } from './judge-consistency.js';

/** One entry in a verdict's findings list. */
type Finding = Verdict['findings'][number];

export interface VerdictMeta {
  readonly verdictId: string;
  readonly reviewerId: string;
  readonly issuedAt: string;
}

export interface CoverageJudge {
  assess(input: {
    readonly parent: TaskContract;
    readonly children: readonly TaskContract[];
  }): Promise<{ readonly coverage: ReadonlyArray<{ readonly criterionId: string; readonly coveredByTaskIds: readonly string[] }> }>;
}

/**
 * The two Gate A clauses that genuinely need judgement (R33 AC-0).
 *
 * Everything else the dossier names — stopping conditions, boundary overlap,
 * pinned decisions between coupled siblings, cycles — is decidable from the
 * contracts themselves, and a check that needs no model must not cost one.
 *
 * These two do not decide themselves:
 *   - **atomicity**: "exactly one responsibility with one verifiable outcome"
 *     is about what the objective MEANS, not its shape.
 *   - **testability as written**: a criterion can mean something checkable and
 *     fail to say it. The grader reads the words, so the words are what is
 *     audited.
 */
export interface PlanJudge {
  audit(input: {
    readonly parent: TaskContract;
    readonly children: readonly TaskContract[];
  }): Promise<{
    readonly tasks: ReadonlyArray<{
      readonly taskId: string;
      readonly atomic: boolean;
      readonly detail: string;
    }>;
    readonly untestable: ReadonlyArray<{
      readonly taskId: string;
      readonly criterionId: string;
      readonly detail: string;
    }>;
    /**
     * Siblings whose scopes overlap — two tasks doing the same work.
     *
     * This started as a deterministic check: two children owning the same
     * parent criterion. The existing suite rejected that immediately and was
     * right to. A criterion is routinely met JOINTLY — two tasks each doing part
     * of it is ordinary partitioning, not duplication — so shared coverage says
     * nothing about overlap. Overlap is about scope of WORK, which the coverage
     * map cannot express, so it is judged rather than computed.
     */
    readonly overlaps: ReadonlyArray<{
      readonly taskIds: readonly string[];
      readonly detail: string;
    }>;
  }>;
}

export interface CompletionJudge {
  assess(input: {
    readonly contract: TaskContract;
    readonly bundle: EvidenceBundle;
  }): Promise<{
    readonly criteria: ReadonlyArray<{ readonly criterionId: string; readonly met: boolean; readonly detail: string }>;
    readonly redFlags: readonly string[];
  }>;
}

/**
 * Gate A — is this decomposition atomic and complete *before* anything runs?
 *
 * An uncovered criterion is a `specification_fault`, not an execution error, and
 * that classification matters: the error class picks the escalation rung, and
 * retrying a task that was specified wrong just burns budget rehearsing the same
 * mistake. A spec fault jumps straight to re-decomposition.
 */
/** What Gate A needs beyond the plan itself (R33 AC-0's sixth clause). */
export interface GateAOptions {
  /**
   * The decompose-or-delegate decision this plan was made under, if one was
   * made (R31).
   *
   * `decidedBy` is the field that matters, and it exists because the first
   * version of the sixth clause had to be reverted without it. The loop splits
   * by default when no gate is wired and records that it did — so a one-child
   * plan is incoherent when a GATE chose to split, and entirely correct when the
   * loop's documented default did. Distinguishing them by matching rationale
   * prose would be a convention; a field is a fact.
   *
   * Absent means no decision was reported, and Gate A audits nothing it was not
   * told about — inventing a decision to audit would be the opposite of this
   * criterion.
   */
  readonly decomposition?: {
    readonly decidedBy: 'gate' | 'default';
    readonly keepWhole: boolean;
  };
}

export async function gateA(
  parent: TaskContract,
  children: readonly TaskContract[],
  judge: CoverageJudge,
  planJudge: PlanJudge,
  meta: VerdictMeta,
  options: GateAOptions = {},
): Promise<Verdict> {
  if (children.length === 0) {
    throw new Error(`Gate A on ${parent.taskId}: no children — an empty decomposition cannot cover anything`);
  }

  // A cycle is checked BEFORE the judge is asked, because it needs no model and
  // because a plan that cannot execute should not cost a model call to reject.
  const cycle = findDependencyCycle(children);

  const { coverage } = await judge.assess({ parent, children });
  const covered = new Map(coverage.map((c) => [c.criterionId, c.coveredByTaskIds]));

  // Iterate the CONTRACT's criteria, not the judge's answer. A criterion the
  // judge never mentioned is uncovered by definition — silence is not coverage.
  const findings = parent.acceptanceCriteria
    .filter((criterion) => (covered.get(criterion.criterionId)?.length ?? 0) === 0)
    .map((criterion) => ({
      criterionId: criterion.criterionId,
      errorClass: 'specification_fault' as const,
      failingStep: 'Gate A coverage check',
      detail: `No child task covers "${criterion.statement}" — the decomposition would leave it unmet.`,
    }));

  for (const task of children) {
    // ---- stopping conditions are PRESENT ------------------------------------
    // Work with no stated end is not a task. Without these the escalation ladder
    // has nothing to measure against and a stalled task runs until the budget
    // is gone, which is the most expensive possible way to discover it.
    const stopping = task.stoppingConditions;
    if (stopping.doneWhen.length === 0 || stopping.stopTryingWhen.length === 0) {
      findings.push({
        criterionId: task.acceptanceCriteria[0]?.criterionId ?? 'plan',
        errorClass: 'specification_fault' as const,
        failingStep: 'Gate A stopping-conditions check',
        detail:
          `Task ${task.taskId} ("${task.objective}") declares ` +
          `${stopping.doneWhen.length === 0 ? 'no doneWhen' : 'no stopTryingWhen'} — ` +
          `work with no stated end cannot be stopped, only abandoned when the budget runs out.`,
      });
    }
  }

  // ---- pinned decisions WHERE SIBLINGS MUST FIT TOGETHER --------------------
  // Only where they are actually coupled. Demanding pinned decisions from tasks
  // that never meet would fail almost every valid plan, and a check that fires
  // on everything tells you nothing.
  //
  // Coupled siblings told nothing about how to fit will each pick a reasonable
  // convention, and the conventions will differ. That is discovered at fold-up,
  // after both have been paid for.
  const siblingIds = new Set(children.map((c) => c.taskId));
  for (const task of children) {
    const consumesSibling = task.dependencies.consumesTaskIds.some((id) => siblingIds.has(id));
    if (consumesSibling && task.inputs.pinnedDecisions.length === 0) {
      findings.push({
        criterionId: task.acceptanceCriteria[0]?.criterionId ?? 'plan',
        errorClass: 'specification_fault' as const,
        failingStep: 'Gate A pinned-decision check',
        detail:
          `Task ${task.taskId} consumes a sibling's output but carries no pinned decisions. ` +
          `Siblings that must fit together and were told nothing about how will each choose a ` +
          `reasonable convention, and the conventions will not match.`,
      });
    }
  }

  // ---- the two semantic clauses -------------------------------------------
  const plan = await planJudge.audit({ parent, children });
  const byId = new Map(children.map((c) => [c.taskId, c]));

  for (const task of plan.tasks) {
    if (task.atomic) continue;
    findings.push({
      criterionId: byId.get(task.taskId)?.acceptanceCriteria[0]?.criterionId ?? 'plan',
      errorClass: 'specification_fault' as const,
      failingStep: 'Gate A atomicity check',
      detail:
        `Task ${task.taskId} is not atomic: ${task.detail}. ` +
        `Splitting continues until each leaf carries exactly one responsibility with one ` +
        `verifiable outcome — and no further.`,
    });
  }

  // ---- boundaries: NON-OVERLAPPING (the exhaustive half is coverage above) --
  for (const overlap of plan.overlaps) {
    findings.push({
      criterionId: byId.get(overlap.taskIds[0] ?? '')?.acceptanceCriteria[0]?.criterionId ?? 'plan',
      errorClass: 'specification_fault' as const,
      failingStep: 'Gate A boundary check (overlapping)',
      detail:
        `Tasks ${overlap.taskIds.join(', ')} overlap in scope: ${overlap.detail}. ` +
        `Boundaries must be non-overlapping as well as exhaustive — duplicated work is paid for ` +
        `twice and hands the fold-up two answers to one question.`,
    });
  }

  // Only criteria the DECOMPOSITION introduced. A criterion inherited verbatim
  // from the parent was not a planning decision, and criteria are partitioned,
  // never invented — the planner carries the parent's `criterionId` and wording
  // through unchanged, so it CANNOT reword one.
  //
  // Judging those produces a rejection no re-split can repair: observed live on
  // mission d55b7f62, where the gate rejected "Stopping power is compared"
  // (the requester's own words from intake) twice and surrendered. Untestable
  // intake is R30's job — "interrogate until testable, then flag what remains" —
  // and catching it here instead grades the wrong agent for the wrong decision.
  const inherited = new Set(parent.acceptanceCriteria.map((c) => c.criterionId));

  for (const bad of plan.untestable) {
    if (inherited.has(bad.criterionId)) continue;
    // A judge arguing against its own verdict (defect `627cd71c`). Observed live
    // on mission `02a7d050`: flagged untestable, with a detail reading "The
    // criterion is TESTABLE." Unanimity sampling is silent here by construction
    // — it needs all samples to agree before rejecting, and a model that fills
    // the boolean the same wrong way every time agrees with itself perfectly.
    //
    // Discarded rather than rewritten: the finding's only content is a rationale
    // that refutes it, so there is nothing left to act on. Discarding preserves
    // the plan, which is the direction ADR-0010 says to err in when a judge
    // cannot be trusted.
    if (affirmsTestability(bad.detail)) continue;
    findings.push({
      criterionId: bad.criterionId,
      errorClass: 'specification_fault' as const,
      failingStep: 'Gate A testability check',
      detail:
        `Criterion ${bad.criterionId} on task ${bad.taskId} is not testable as written: ${bad.detail}. ` +
        `The grader reads the words, so the words are what must be checkable.`,
    });
  }

  if (cycle !== null) {
    findings.push({
      // Attributed to the parent's first criterion: the cycle is a fault in the
      // PLAN as a whole, not in any one criterion, and the verdict schema files
      // every finding against a criterion.
      criterionId: parent.acceptanceCriteria[0]?.criterionId ?? 'plan',
      errorClass: 'specification_fault' as const,
      failingStep: 'Gate A dependency-graph check',
      detail:
        `The declared dependencies form a cycle (${cycle.join(' → ')}) — the plan cannot execute in any order. ` +
        `Refused here rather than at execution time, where it would be a scheduler waiting forever.`,
    });
  }

  // ---- sane use of the decompose-or-delegate gate (R33 AC-0, clause six) -----
  // Audited ONLY where a gate actually decided. The loop's no-gate default also
  // "splits", and faulting the planner for the loop's own default is what forced
  // the first version of this clause to be reverted (`bf62266d`).
  const decision = options.decomposition;
  if (decision?.decidedBy === 'gate') {
    if (!decision.keepWhole && children.length === 1) {
      findings.push({
        criterionId: parent.acceptanceCriteria[0]?.criterionId ?? 'plan',
        errorClass: 'specification_fault' as const,
        failingStep: 'Gate A decompose-or-delegate check',
        detail:
          'The gate chose to SPLIT and the plan produced exactly one child. That is the decision made ' +
          'incoherently: it pays a planning round-trip and a fold-up to hand the same work to the same ' +
          'single agent. Either the work was atomic and the gate should have kept it whole, or it was ' +
          'not and the split should have produced siblings.',
      });
    }

    if (decision.keepWhole && children.length > 1) {
      findings.push({
        criterionId: parent.acceptanceCriteria[0]?.criterionId ?? 'plan',
        errorClass: 'specification_fault' as const,
        failingStep: 'Gate A decompose-or-delegate check',
        detail:
          `The gate decided to KEEP WHOLE and the plan split into ${children.length} children anyway. ` +
          'The gate withholds atomization from work that sequential entanglement damages, so a plan ' +
          'that overrides it has discarded the one judgement made specifically about whether to split.',
      });
    }
  }

  return {
    verdictId: meta.verdictId,
    taskId: parent.taskId,
    gate: 'A',
    outcome: findings.length === 0 ? 'pass' : 'fail',
    reviewerId: meta.reviewerId,
    verificationDepth: parent.verificationPlan.depth,
    findings,
    redFlags: [],
    issuedAt: meta.issuedAt,
  };
}

/**
 * The first dependency cycle among these siblings, or `null` if the graph is
 * acyclic (R32 AC-2).
 *
 * Depth-first with an explicit *on-stack* marker rather than a plain "seen" set.
 * That distinction is the whole algorithm: a node seen again on the CURRENT path
 * is a cycle, while a node seen again on a different path is just a shared
 * dependency. Conflating them rejects a diamond — two independent tasks feeding
 * one consumer — which is the most common legitimate shape there is.
 *
 * Edges pointing outside this sibling set are ignored, not treated as faults: a
 * contract may legitimately consume something from elsewhere in the tree, and
 * only these siblings are being audited here.
 */
function findDependencyCycle(children: readonly TaskContract[]): string[] | null {
  const within = new Set(children.map((c) => c.taskId));
  const edges = new Map(
    children.map((c) => [c.taskId, c.dependencies.consumesTaskIds.filter((id) => within.has(id))]),
  );

  const done = new Set<string>();
  const onStack = new Set<string>();
  const path: string[] = [];

  const walk = (taskId: string): string[] | null => {
    if (onStack.has(taskId)) return [...path.slice(path.indexOf(taskId)), taskId];
    if (done.has(taskId)) return null;

    onStack.add(taskId);
    path.push(taskId);
    for (const next of edges.get(taskId) ?? []) {
      const found = walk(next);
      if (found !== null) return found;
    }
    path.pop();
    onStack.delete(taskId);
    done.add(taskId);
    return null;
  };

  for (const child of children) {
    const found = walk(child.taskId);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Gate B — did the delivered work meet the contract?
 *
 * Checked against the contract's acceptance criteria, *exactly* those. The
 * verdict returned here is immutable in the only sense that matters: it is
 * appended to the audit ledger, where a database trigger rejects UPDATE and
 * DELETE outright. Immutability is not a property of this object — it is a
 * property of where the object goes.
 */
/**
 * Gate B's semantic tier (R34 AC-0) - does the output serve the parent's INTENT?
 *
 * Separate from the completion judge on purpose. That one asks "was each
 * criterion met", which a deliverable can satisfy sentence by sentence while
 * missing what was actually wanted. Acceptance criteria are structurally bad at
 * catching that, because they are the letter and this is the spirit.
 */
export interface IntentJudge {
  assess(input: {
    readonly contract: TaskContract;
    readonly bundle: EvidenceBundle;
  }): Promise<{
    readonly servesIntent: boolean;
    readonly detail: string;
    /** Structural suspicion: a verification-shaped answer, a too-exact fit. */
    readonly redFlags: readonly string[];
  }>;
}

/**
 * Gate B's mechanical tier (R34 AC-0) - the contract's testable checks.
 *
 * Deterministic, and deliberately so. These are facts about the bundle and the
 * contract, not judgements: an empty deliverable, effort past the ceiling, a
 * task equipped with tools that took no actions. A model asked "does this meet
 * the criteria" will sometimes answer yes to nothing at all, and the defence is
 * not a better prompt - it is not asking.
 */
function mechanicalChecks(contract: TaskContract, bundle: EvidenceBundle): Finding[] {
  const findings: Finding[] = [];
  const criterionId = contract.acceptanceCriteria[0]?.criterionId ?? 'plan';

  const empty =
    bundle.deliverable === null ||
    bundle.deliverable === undefined ||
    (typeof bundle.deliverable === 'string' && bundle.deliverable.trim() === '') ||
    (typeof bundle.deliverable === 'object' && Object.keys(bundle.deliverable as object).length === 0);

  if (empty) {
    findings.push({
      criterionId,
      errorClass: 'verification_failure' as const,
      failingStep: 'Gate B mechanical tier',
      detail: 'The deliverable is empty. Nothing was produced, whatever the completion judge reported.',
    });
  }

  if (bundle.effortSpent > contract.budget.ceiling) {
    findings.push({
      criterionId,
      // BUDGET EXHAUSTION, not a generic verification failure (defect
      // `e758f460`). This is the only finding in the system that means "the
      // budget ran out", and `budget_exhaustion` is the only error class routing
      // to the `agent_redesign` rung — so while this said `verification_failure`
      // the rung was unreachable, and with it design lineage and R28 AC-0.
      //
      // Deliberately left wrong until `effortSpent` became a real measurement:
      // while it was a hardcoded 1 no task could exceed any ceiling, so fixing
      // the class first would have created a second route that never fires,
      // which is exactly how the first dead route came to exist.
      errorClass: 'budget_exhaustion' as const,
      failingStep: 'Gate B mechanical tier',
      detail:
        `Spent ${bundle.effortSpent} against a ceiling of ${contract.budget.ceiling}. ` +
        `Effort is a currency, and work that overran its budget was not the work that was contracted.`,
    });
  }

  // "Missing work products", decided as a fact. A contract that granted tools
  // and came back with no actions did not do the work it was equipped for,
  // whatever the prose claims. Tasks with no tool grants are pure reasoning and
  // are not faulted for taking no actions - most tasks are.
  if (contract.inputs.toolEntitlements.length > 0 && bundle.actions.length === 0) {
    findings.push({
      criterionId,
      errorClass: 'verification_failure' as const,
      failingStep: 'Gate B mechanical tier',
      detail:
        `The contract granted ${contract.inputs.toolEntitlements.length} tool entitlement(s) and the ` +
        `bundle records no actions - the task was equipped to do something it never did.`,
    });
  }

  return findings;
}

export async function gateB(
  contract: TaskContract,
  bundle: EvidenceBundle,
  judge: CompletionJudge,
  intentJudge: IntentJudge,
  meta: VerdictMeta,
): Promise<Verdict> {
  // ---- redundant depth: verify independently, and REQUIRE agreement ---------
  // `verificationPlan.depth` used to be copied into the verdict and otherwise
  // ignored, so a redundant plan verified exactly once and a lucky pass WAS a
  // pass. Runs are independent calls to the same judge; disagreement between
  // them means the verification is not reproducible, and an unreproducible pass
  // is indistinguishable from a coin landing well.
  const runs = contract.verificationPlan.depth === 'redundant'
    ? Math.max(2, contract.verificationPlan.requiredAgreement ?? 2)
    : 1;

  const assessments: Awaited<ReturnType<CompletionJudge['assess']>>[] = [];
  for (let i = 0; i < runs; i += 1) {
    assessments.push(await judge.assess({ contract, bundle }));
  }

  const { criteria, redFlags } = assessments[0]!;

  const contractCriteria = new Set(contract.acceptanceCriteria.map((c) => c.criterionId));
  const invented = criteria.filter((c) => !contractCriteria.has(c.criterionId)).map((c) => c.criterionId);
  if (invented.length > 0) {
    throw new Error(
      `Gate B on ${contract.taskId}: judge reported criteria not in the contract (${invented.join(', ')}) — it is grading a different task`,
    );
  }

  const assessed = new Map(criteria.map((c) => [c.criterionId, c]));

  const findings = contract.acceptanceCriteria.flatMap<Finding>((criterion) => {
    const judgement = assessed.get(criterion.criterionId);

    // Unassessed is a failure, not a pass. This is the single most dangerous
    // shortcut available to a reviewer, and the only defence is to iterate the
    // contract rather than the judge's answer.
    if (judgement === undefined) {
      return [{
        criterionId: criterion.criterionId,
        errorClass: 'verification_failure' as const,
        failingStep: 'Gate B completion check',
        detail: `Criterion "${criterion.statement}" was never assessed; an unchecked criterion cannot pass.`,
      }];
    }
    if (judgement.met) return [];

    return [{
      criterionId: criterion.criterionId,
      errorClass: 'execution_error' as const,
      failingStep: 'Gate B completion check',
      detail: judgement.detail,
    }];
  });

  // Disagreement across independent runs (R34 AC-1). Compared per criterion on
  // the `met` verdict only: two runs may word their detail differently and still
  // agree on the thing that matters.
  if (runs > 1) {
    const verdictOf = (a: (typeof assessments)[number]) =>
      contract.acceptanceCriteria
        .map((c) => `${c.criterionId}:${a.criteria.find((x) => x.criterionId === c.criterionId)?.met ?? 'absent'}`)
        .join('|');
    const first = verdictOf(assessments[0]!);
    if (assessments.some((a) => verdictOf(a) !== first)) {
      findings.push({
        criterionId: contract.acceptanceCriteria[0]?.criterionId ?? 'plan',
        errorClass: 'verification_failure' as const,
        failingStep: 'Gate B redundant verification',
        detail:
          `${runs} independent verifications did not agree. A lucky pass is not a pass: ` +
          `a result that does not reproduce is indistinguishable from a coin landing well.`,
      });
    }
  }

  findings.push(...mechanicalChecks(contract, bundle));

  // ---- the semantic INTENT tier (R34 AC-0) ---------------------------------
  const intent = await intentJudge.assess({ contract, bundle });
  if (!intent.servesIntent) {
    findings.push({
      criterionId: contract.acceptanceCriteria[0]?.criterionId ?? 'plan',
      errorClass: 'execution_error' as const,
      failingStep: 'Gate B intent tier',
      detail:
        `The output does not serve the parent intent: ${intent.detail}. ` +
        `Meeting the letter of every criterion is not the same as delivering what was wanted.`,
    });
  }

  // ---- red flags DISCARD, they do not merely annotate (R34 AC-2) -----------
  // Previously collected and copied into the verdict while the outcome ignored
  // them, so an output flagged as verification-shaped or suspiciously exact
  // still passed - exactly the case the criterion names.
  const allFlags = [...redFlags, ...intent.redFlags];
  if (allFlags.length > 0) {
    findings.push({
      criterionId: contract.acceptanceCriteria[0]?.criterionId ?? 'plan',
      errorClass: 'verification_failure' as const,
      failingStep: 'Gate B red flag',
      detail:
        `Discarded despite technically passing: ${allFlags.join('; ')}. ` +
        `A structurally suspicious output is refused rather than accepted on its own account of itself.`,
    });
  }

  return {
    verdictId: meta.verdictId,
    taskId: contract.taskId,
    gate: 'B',
    outcome: findings.length === 0 ? 'pass' : 'fail',
    reviewerId: meta.reviewerId,
    // The depth the contract demanded, never one the reviewer picked for itself.
    verificationDepth: contract.verificationPlan.depth,
    findings,
    redFlags: allFlags,
    issuedAt: meta.issuedAt,
  };
}

/** Render a verdict as the ledger event that makes it immutable. */
export function verdictToLedgerEvent(
  verdict: Verdict,
  meta: { readonly eventId: string; readonly missionId: string; readonly occurredAt: string },
): LedgerEventInput {
  return {
    eventId: meta.eventId,
    missionId: meta.missionId,
    taskId: verdict.taskId,
    family: 'verification',
    type: `gate_${verdict.gate.toLowerCase()}.verdict_issued`,
    actor: { kind: 'reviewer', id: verdict.reviewerId, displayName: 'Reviewer' },
    payload: { ...verdict },
    occurredAt: meta.occurredAt,
  };
}
