/**
 * Verified tasks become replay bench cases (R25 AC-0, defect `c1b3ae71`).
 *
 * R25 says it plainly: "every completed task in the ledger — its contract, its
 * inputs, its verified outcome — is a potential benchmark." Until now nothing
 * built that set. `bench.record` had no production caller at all, so the bench
 * held only what scripts had put there, and everything downstream starved: the
 * Reviewer's calibration probes (R35), the science loop's cases (R27), and the
 * sealed-bench evaluation R29 AC-0 requires.
 *
 * A case is minted only from a task whose Gate B PASSED. A failed deliverable is
 * a wrong answer, and banking it would score every future candidate against a
 * mistake — the same hazard the store already refuses evidence-free cases for.
 */
import { capabilityOf } from './agent-creator.js';

/** What the bench store needs to bank one case. */
export interface BenchCaseInput {
  readonly slice: 'open' | 'sealed';
  readonly sourceTaskId: string;
  readonly sourceMissionId: string;
  readonly capability: string;
  readonly contract: unknown;
  readonly inputs: unknown;
  readonly verifiedOutcome: unknown;
  readonly evidence: readonly string[];
}

/** One event of a mission trail, as the loop records them. */
interface TrailEvent {
  readonly eventId: string;
  readonly missionId: string;
  readonly taskId: string | null;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

interface TaskFacts {
  contract?: unknown;
  capability?: string;
  rawCategory?: string;
  deliverable?: unknown;
  passed?: boolean;
  verdictEventId?: string;
}

/**
 * The cases a finished mission's trail earns.
 *
 * `sealedSoFar` is how many cases the bench already holds per capability, which
 * the caller reads from the store. It is passed in rather than counted here
 * because the slice depends on the bench's whole history, not on one mission.
 */
export function casesFromTrail(
  trail: readonly TrailEvent[],
  options: {
    readonly sealedSoFar: ReadonlyMap<string, number>;
    /**
     * The mission's own contract, for a mission the gate kept WHOLE (R31).
     *
     * Passed in rather than read off the trail because `mission.intake_accepted`
     * is recorded by the CONTROL PLANE — the worker never appends it, so it is
     * on the ledger and absent from the trail this walks. A first fix read it
     * from the events, passed its tests, and banked nothing on a live mission.
     */
    readonly missionContract?: unknown;
  },
): BenchCaseInput[] {
  const facts = new Map<string, TaskFacts>();
  const order: string[] = [];
  const factsFor = (taskId: string): TaskFacts => {
    const existing = facts.get(taskId);
    if (existing !== undefined) return existing;
    const fresh: TaskFacts = {};
    facts.set(taskId, fresh);
    order.push(taskId);
    return fresh;
  };

  for (const event of trail) {
    if (event.taskId === null) continue;

    /**
     * A mission kept WHOLE never contracts a child — it executes at the mission
     * task, whose contract is on the intake event (R31). This producer was
     * written when every mission decomposed, so a kept-whole mission banked
     * nothing and the sealed bench stayed empty: the same shape as defect
     * `dd2e9d18`, where a projection knew only `mission.folded`.
     *
     * It matters more than one missing row. The bench is the ground truth the
     * science loop validates candidates against, petitions are evaluated on,
     * and reviewer calibration draws its probes from — so an empty bench
     * starves the whole learning half of the system.
     *
     * Recorded as a fallback, never an override: a child task that carries its
     * own contract keeps it, or a child deliverable would be banked against the
     * mission's criteria and the pair would grade the wrong thing.
     */
    if (event.type === 'task.contracted') {
      const fact = factsFor(event.taskId);
      fact.contract = event.payload['contract'];
      const category = event.payload['category'];
      if (typeof category === 'string') fact.rawCategory = category;
      continue;
    }

    // The RESOLVED capability, for the same reason the weak-spot ranking uses it
    // (defect `340aa7de`): a bench keyed on the planner's raw phrasing would
    // never match the category a petition argues about.
    if (event.type === 'agent.staffed') {
      const capability = event.payload['capability'];
      if (typeof capability === 'string' && capability.length > 0) {
        factsFor(event.taskId).capability = capability;
      }
      continue;
    }

    if (event.type === 'task.executed') {
      factsFor(event.taskId).deliverable = event.payload['deliverable'];
      continue;
    }

    if (event.type === 'gate_b.verdict_issued') {
      const fact = factsFor(event.taskId);
      fact.passed = event.payload['outcome'] === 'pass';
      // The verdict is what makes the outcome VERIFIED rather than merely
      // produced, so it is the evidence the store demands.
      fact.verdictEventId = event.eventId;
      continue;
    }
  }

  // Counting continues from what the bench already holds, and advances WITHIN
  // this walk — otherwise a mission with ten tasks of one capability would seal
  // all ten.
  const sealed = new Map(options.sealedSoFar);
  const cases: BenchCaseInput[] = [];

  for (const taskId of order) {
    const fact = facts.get(taskId)!;
    if (fact.passed !== true) continue;
    if (fact.deliverable === undefined) continue;
    if (fact.verdictEventId === undefined) continue;

    // A mission kept whole never contracts a child: it executes at the mission
    // task, whose contract came from intake. Without this it banked nothing,
    // and the sealed bench is the ground truth the science loop validates
    // candidates against, petitions are evaluated on, and reviewer calibration
    // draws its probes from — an empty bench starves the whole learning half.
    // A fallback, never an override: a child keeps its own contract, or a child
    // deliverable would be graded against the mission's criteria.
    const contract = fact.contract ?? options.missionContract;
    if (contract === undefined) continue;

    const capability = fact.capability
      ?? (fact.rawCategory === undefined ? undefined : capabilityOf(fact.rawCategory));
    if (capability === undefined) continue;

    // ADR-0016 — alternating, starting sealed. Nothing the system records can
    // determine what fraction to reserve, so this is an explicit choice rather
    // than a derivation: it is deterministic, needs no tuning, and guarantees
    // the sealed slice covers every capability the swarm actually works in,
    // which is what a petition about a capability needs to be evaluated against.
    // Keyed per capability so a busy one cannot decide another's slice.
    const banked = sealed.get(capability) ?? 0;
    const slice = banked % 2 === 0 ? 'sealed' : 'open';
    sealed.set(capability, banked + 1);

    cases.push({
      slice,
      sourceTaskId: taskId,
      sourceMissionId: trail[0]?.missionId ?? '',
      capability,
      contract,
      // The contract's own inputs, so a replay starts from what the task was
      // actually given rather than from whatever the replayer chooses.
      inputs: (fact.contract as { inputs?: unknown } | undefined)?.inputs ?? {},
      verifiedOutcome: fact.deliverable,
      evidence: [fact.verdictEventId],
    });
  }

  return cases;
}
