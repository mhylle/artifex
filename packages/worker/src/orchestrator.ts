/**
 * The Orchestrator — decompose, contract, fold up.
 *
 * Two responsibilities, both governed by invariants rather than taste:
 *
 *  - **Decompose** splits a contract into atomic children, each of which gets a
 *    *full* contract authored by this level (invariant #2: no work without a
 *    contract). The planner proposes; the Orchestrator is what turns a proposal
 *    into something executable, and it refuses proposals that cannot be graded or
 *    cannot be afforded. A planner is an LLM and will happily suggest a task with
 *    no acceptance criteria — that must fail here, loudly, because by execution
 *    time the contract is the only specification that exists.
 *
 *  - **Fold up** reconciles children into ONE result. Not a concatenation: two
 *    children can disagree about the same fact, and joining their outputs ships
 *    both as though both were true. Reconciliation is where that gets caught.
 *
 * The planner and reconciler are seams. Both are model-backed in production (via
 * `@artifex/model-router`, never a provider SDK directly), and both are scripted
 * in tests so the contract-authoring rules can be verified deterministically.
 */
import type { BlastRadius, TaskContract } from '@artifex/shared-types';

export interface ProposedSubtask {
  readonly objective: string;
  readonly category: string;
  readonly acceptanceCriteria: ReadonlyArray<{ readonly criterionId: string; readonly statement: string }>;
  readonly outOfScope: readonly string[];
  readonly blastRadius: BlastRadius;
  /** Fraction of the parent's ceiling this child may spend, 0–1. */
  readonly effortShare: number;
  /**
   * Indexes of the SIBLINGS in this same proposal whose output this subtask
   * consumes (R32). Omitted or empty means independent — free to run in
   * parallel with everything else.
   *
   * Declared as indexes rather than task ids because the ids do not exist until
   * `authorContracts` mints them, and a planner that had to predict them would
   * be guessing at `childTaskId`'s arithmetic.
   *
   * Forward references are allowed: sibling 0 may consume sibling 1. Ordering is
   * the scheduler's job, and a cycle is Gate A's to refuse — restricting
   * declarations to earlier siblings would make cycles impossible to express and
   * therefore impossible to catch where a plan can still be rejected cheaply.
   */
  readonly consumesIndexes?: readonly number[];
}

export interface DecompositionProposal {
  readonly subtasks: readonly ProposedSubtask[];
}

export interface Planner {
  propose(input: {
    readonly contract: TaskContract;
    /**
     * Why the previous plan for this same contract was rejected (R33 AC-1).
     *
     * Absent on the first attempt. Present on a re-split, and it is what makes
     * the retry AIMED rather than blind: re-proposing from the same objective
     * very often produces the same plan, spending a model call to rehearse the
     * rejection.
     */
    readonly rejectedBecause?: readonly string[];
    /**
     * A learned "how to split this kind of work" recipe (R31 AC-2).
     *
     * Absent when the Asset Registry holds no template for this capability,
     * which is every capability the swarm has not yet split successfully.
     *
     * GUIDANCE, not a rule: it goes into the prompt alongside the objective and
     * the planner still decides. A template that bypassed the planner would make
     * a stale recipe binding on work it no longer fits, and templates are meant
     * to accumulate evidence — which requires being able to be wrong.
     */
    readonly templateRecipe?: string;
  }): Promise<DecompositionProposal>;
}

export interface ChildResult {
  readonly objective: string;
  readonly deliverable: unknown;
}

export interface Reconciler {
  reconcile(input: {
    readonly parent: TaskContract;
    readonly children: readonly ChildResult[];
  }): Promise<{ readonly deliverable: unknown; readonly conflicts: readonly string[] }>;
}

export interface FoldResult {
  readonly taskId: string;
  readonly childCount: number;
  readonly deliverable: unknown;
  readonly conflicts: readonly string[];
}

/**
 * Deterministic child ids — a decomposition must be replayable from the ledger,
 * so the same parent and the same proposal must yield the same tree.
 *
 * Derived by incrementing the parent's final group, which keeps the child inside
 * the `8-4-4-4-12` shape the contract schema requires. Splitting the string at an
 * arbitrary offset does not: it lands mid-segment and produces something that
 * looks like a UUID but fails validation.
 */
function childTaskId(parentTaskId: string, index: number): string {
  const head = parentTaskId.slice(0, 24);
  const tail = parentTaskId.slice(24);
  const bumped = (BigInt(`0x${tail}`) + BigInt(index + 1)).toString(16).padStart(12, '0').slice(-12);

  return `${head}${bumped}`;
}

/**
 * Author full contracts for a proposed split.
 *
 * Everything the children inherit is inherited deliberately:
 *   - `autonomyDial` is mission-level, fixed at intake — a child may never widen
 *     its own autonomy.
 *   - `escalationPolicy` and `verificationPlan` come from the parent, because a
 *     task does not get to choose how hard it will be checked.
 *   - the budget is **divided**, never copied. Copying it multiplies spend by the
 *     fan-out, which is the fastest way to bankrupt a mission (invariant #7).
 */
export async function decompose(
  parent: TaskContract,
  planner: Planner,
  options?: {
    /** Findings from a Gate A rejection of the previous plan (R33 AC-1). */
    readonly rejectedBecause?: readonly string[];
    /** A learned recipe for splitting this kind of work (R31 AC-2). */
    readonly templateRecipe?: string;
  },
): Promise<TaskContract[]> {
  const proposal = await planner.propose({
    contract: parent,
    ...(options?.rejectedBecause === undefined ? {} : { rejectedBecause: options.rejectedBecause }),
    ...(options?.templateRecipe === undefined ? {} : { templateRecipe: options.templateRecipe }),
  });

  if (proposal.subtasks.length === 0) {
    throw new Error('decomposition produced no subtasks — nothing to execute');
  }

  for (const [index, subtask] of proposal.subtasks.entries()) {
    if (subtask.acceptanceCriteria.length === 0) {
      throw new Error(
        `subtask ${index} ("${subtask.objective}") has no acceptance criteria — a task nobody can grade is not a task`,
      );
    }
    if (subtask.outOfScope.length === 0) {
      throw new Error(
        `subtask ${index} ("${subtask.objective}") declares no anti-scope — siblings would be free to overlap`,
      );
    }
  }

  const totalShare = proposal.subtasks.reduce((sum, s) => sum + s.effortShare, 0);
  if (totalShare > 1) {
    throw new Error(
      `proposed effort shares total ${totalShare.toFixed(2)} of the parent budget — over-subscribed; effort is a currency`,
    );
  }

  const ids = proposal.subtasks.map((_, index) => childTaskId(parent.taskId, index));

  return proposal.subtasks.map((subtask, index) => {
    const ceiling = parent.budget.ceiling * subtask.effortShare;

    return {
      taskId: ids[index]!,
      missionId: parent.missionId,
      parentTaskId: parent.taskId,
      category: subtask.category,
      depth: parent.depth + 1,
      objective: subtask.objective,
      acceptanceCriteria: subtask.acceptanceCriteria.map((c) => ({ ...c })),
      boundaries: {
        outOfScope: [...subtask.outOfScope],
        // Every child is told who owns the neighbouring concerns, so overlap is
        // a contract violation rather than a discovery made at fold-up.
        siblingOwners: proposal.subtasks
          .map((sibling, siblingIndex) => ({ concern: sibling.objective, taskId: ids[siblingIndex]! }))
          .filter((_, siblingIndex) => siblingIndex !== index),
      },
      inputs: {
        entitlements: [...parent.inputs.entitlements],
        toolEntitlements: parent.inputs.toolEntitlements.map((t) => ({ ...t })),
        // Inherited from the parent, PLUS one pinned per sibling edge (R33).
        //
        // Gate A refuses coupled siblings that share no pinned decision, and it
        // is right to: two tasks told to fit together and told nothing about how
        // will each pick a reasonable convention, and the conventions will
        // differ — discovered at fold-up, after both have been paid for.
        //
        // Until now nothing could satisfy that clause. `pinnedDecisions` is
        // inherited and the planner has no way to propose one, so a mission
        // whose intake pinned nothing produced children that pinned nothing,
        // and every dependent plan would have been rejected forever.
        //
        // The pin is DERIVED from the edge the plan already declares rather than
        // invented: the producer's deliverable, as produced, is the interface.
        // That is the minimum both sides must agree on, and it is a fact the
        // decomposition already knows.
        pinnedDecisions: [
          ...parent.inputs.pinnedDecisions.map((d) => ({ ...d })),
          ...(subtask.consumesIndexes ?? [])
            .map((i) => proposal.subtasks[i])
            .filter((producer): producer is NonNullable<typeof producer> => producer !== undefined)
            .map((producer, n) => ({
              id: `interface-${index}-${n}`,
              decision:
                `Consume "${producer.objective}" exactly as that task delivers it — ` +
                `its output is the interface, and neither side may restate it in another shape.`,
            })),
        ],
      },
      dependencies: {
        // The typed dependency graph (R32). An index that names no sibling, or
        // names the task itself, is dropped rather than carried: a self-edge is
        // a guaranteed deadlock and an out-of-range index refers to nothing, so
        // neither can be honoured. A cycle between DIFFERENT siblings is left
        // intact deliberately — Gate A must see it to refuse the plan.
        consumesTaskIds: (subtask.consumesIndexes ?? [])
          .filter((i) => Number.isInteger(i) && i >= 0 && i < ids.length && i !== index)
          .map((i) => ids[i]!),
        mayRequest: [...parent.dependencies.mayRequest],
      },
      stoppingConditions: {
        doneWhen: subtask.acceptanceCriteria.map((c) => `Criterion ${c.criterionId} is demonstrably met.`),
        stopTryingWhen: [...parent.stoppingConditions.stopTryingWhen],
        maxAttempts: parent.stoppingConditions.maxAttempts,
        stallLimit: parent.stoppingConditions.stallLimit,
      },
      budget: {
        // The floor scales with the share too — a child given 20% of the work
        // should not carry the parent's whole minimum-effort obligation.
        floor: Math.min(parent.budget.floor * subtask.effortShare, ceiling),
        ceiling,
        unit: parent.budget.unit,
      },
      escalationPolicy: {
        ladder: [...parent.escalationPolicy.ladder],
        humanAt: parent.escalationPolicy.humanAt,
      },
      verificationPlan: { ...parent.verificationPlan },
      blastRadius: subtask.blastRadius,
      autonomyDial: parent.autonomyDial,
      createdAt: parent.createdAt,
    };
  });
}

/**
 * Reconcile completed children into one result.
 *
 * The reconciler is required, not optional, and that is the whole point of this
 * function: the decomposition tree run in reverse has to *resolve* what the
 * children said, because they were deliberately kept ignorant of each other (no
 * peer chatter, invariant #6). Nobody else in the system is positioned to notice
 * that two siblings contradict each other.
 */
export async function foldUp(
  parent: TaskContract,
  children: readonly ChildResult[],
  reconciler: Reconciler,
): Promise<FoldResult> {
  if (children.length === 0) {
    throw new Error(`task ${parent.taskId} has no children to fold up — nothing to reconcile`);
  }

  const { deliverable, conflicts } = await reconciler.reconcile({ parent, children });

  return {
    taskId: parent.taskId,
    childCount: children.length,
    deliverable,
    conflicts: [...conflicts],
  };
}
