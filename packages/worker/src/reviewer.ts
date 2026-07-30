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
export async function gateA(
  parent: TaskContract,
  children: readonly TaskContract[],
  judge: CoverageJudge,
  meta: VerdictMeta,
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
export async function gateB(
  contract: TaskContract,
  bundle: EvidenceBundle,
  judge: CompletionJudge,
  meta: VerdictMeta,
): Promise<Verdict> {
  const { criteria, redFlags } = await judge.assess({ contract, bundle });

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

  return {
    verdictId: meta.verdictId,
    taskId: contract.taskId,
    gate: 'B',
    outcome: findings.length === 0 ? 'pass' : 'fail',
    reviewerId: meta.reviewerId,
    // The depth the contract demanded, never one the reviewer picked for itself.
    verificationDepth: contract.verificationPlan.depth,
    findings,
    redFlags: [...redFlags],
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
