/**
 * The four remaining lenses (R19) — workforce, timeline, learning, ledger.
 *
 * "One dashboard, five ways of looking at the same ledger — switchable per
 * mission, shareable as links, **identical truth underneath**."
 *
 * Every lens here is a pure function of the same event list the canvas folds.
 * That is not tidiness: two lenses cannot contradict each other if neither has
 * its own source. A lens that ran its own query could drift, and the operator
 * would have no way to tell which one was lying.
 */
import type { LedgerEventView } from './mission-tree';

/** Events as they arrive, plus the timestamp the lenses need. */
export type TimedEvent = LedgerEventView & { readonly occurredAt?: string };

const at = (event: TimedEvent): number => Date.parse(event.occurredAt ?? '') || 0;

const secondsBetween = (from: number, to: number): number =>
  from === 0 || to === 0 ? 0 : Math.max(0, Math.round((to - from) / 1000));

// ---------------------------------------------------------------- workforce --

export interface WorkforceAgent {
  readonly designId: string;
  readonly version: number | null;
  readonly logicalTier: number | null;
  readonly taskId: string;
  readonly category: string | null;
  readonly objective: string;
  /**
   * Share of this agent's own Gate B verdicts that passed.
   *
   * `null` — not zero — when nothing has judged it yet. Reporting "0% compliant"
   * for an unjudged agent would defame it with a number the ledger never
   * supported, and would poison any later clade score computed from it.
   */
  readonly complianceRate: number | null;
  readonly runtimeSeconds: number;
}

/** Every specialist the trail staffed, with what it holds and how it is doing. */
export function buildWorkforce(events: readonly TimedEvent[]): WorkforceAgent[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const category = new Map<string, string | null>();
  const objective = new Map<string, string>();
  const verdicts = new Map<string, { passed: number; total: number }>();
  const lastSeen = new Map<string, number>();

  for (const event of ordered) {
    const taskId = event.taskId;
    if (taskId === null) continue;
    lastSeen.set(taskId, at(event));

    if (event.type === 'task.contracted') {
      const raw = event.payload['category'];
      category.set(taskId, typeof raw === 'string' ? raw : null);
      const obj = event.payload['objective'];
      objective.set(taskId, typeof obj === 'string' ? obj : '');
    }

    if (event.type === 'gate_b.verdict_issued') {
      const tally = verdicts.get(taskId) ?? { passed: 0, total: 0 };
      tally.total += 1;
      if (event.payload['outcome'] === 'pass') tally.passed += 1;
      verdicts.set(taskId, tally);
    }
  }

  const agents: WorkforceAgent[] = [];
  for (const event of ordered) {
    if (event.type !== 'agent.staffed' || event.taskId === null) continue;
    const taskId = event.taskId;
    const tally = verdicts.get(taskId);
    const version = event.payload['version'];
    const tier = event.payload['logicalTier'];

    agents.push({
      designId: String(event.payload['designId'] ?? 'unknown'),
      version: typeof version === 'number' ? version : null,
      logicalTier: typeof tier === 'number' ? tier : null,
      taskId,
      category: category.get(taskId) ?? null,
      objective: objective.get(taskId) ?? '',
      complianceRate: tally === undefined || tally.total === 0 ? null : tally.passed / tally.total,
      runtimeSeconds: secondsBetween(at(event), lastSeen.get(taskId) ?? 0),
    });
  }
  return agents;
}

// ----------------------------------------------------------------- timeline --

export interface TimelineEntry {
  readonly seq: number;
  readonly taskId: string;
  readonly type: string;
  readonly occurredAt: string;
}

export interface TimelineLane {
  readonly taskId: string;
  readonly objective: string;
  readonly entries: readonly TimelineEntry[];
  /** Contracted → staffed. Where stalls become visible. */
  readonly waitedSeconds: number;
  /** Staffed → last event. Null when it never started. */
  readonly ranSeconds: number | null;
}

/** One swimlane per task: when it waited, ran, was reviewed and escalated. */
export function buildTimeline(events: readonly TimedEvent[]): TimelineLane[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const lanes = new Map<string, TimelineEntry[]>();
  const objective = new Map<string, string>();
  const contractedAt = new Map<string, number>();
  const staffedAt = new Map<string, number>();
  const lastAt = new Map<string, number>();

  for (const event of ordered) {
    const taskId = event.taskId;
    // Mission-level events belong to no lane; a lane is a task's own story.
    if (taskId === null || taskId === ordered[0]?.missionId) continue;

    const entries = lanes.get(taskId) ?? [];
    entries.push({ seq: event.seq, taskId, type: event.type, occurredAt: event.occurredAt ?? '' });
    lanes.set(taskId, entries);
    lastAt.set(taskId, at(event));

    if (event.type === 'task.contracted') {
      contractedAt.set(taskId, at(event));
      const obj = event.payload['objective'];
      objective.set(taskId, typeof obj === 'string' ? obj : '');
    }
    if (event.type === 'agent.staffed' && !staffedAt.has(taskId)) staffedAt.set(taskId, at(event));
  }

  return [...lanes.entries()].map(([taskId, entries]) => {
    const started = staffedAt.get(taskId);
    return {
      taskId,
      objective: objective.get(taskId) ?? '',
      entries,
      waitedSeconds: secondsBetween(contractedAt.get(taskId) ?? 0, started ?? 0),
      // Null rather than 0 for a task that never started: it has not run for no
      // time, it has not run.
      ranSeconds: started === undefined ? null : secondsBetween(started, lastAt.get(taskId) ?? 0),
    };
  });
}

// ---------------------------------------------------------- ledger explorer --

export interface LedgerFilter {
  readonly family?: string;
  readonly errorClass?: string;
  readonly agent?: string;
  readonly criterionId?: string;
  readonly since?: string;
}

/**
 * The raw trail, narrowed.
 *
 * Filters COMBINE — each is an additional constraint, never a replacement.
 * Treating the newest filter as the only one would quietly widen an
 * investigation at exactly the moment the operator was trying to narrow it.
 */
export function buildLedgerView(
  events: readonly TimedEvent[],
  filter: LedgerFilter,
): readonly TimedEvent[] {
  // Which tasks a named agent held — so "what did this specialist do" is one
  // query rather than a cross-reference the operator performs by hand.
  const agentTasks = new Set<string>();
  if (filter.agent !== undefined) {
    for (const event of events) {
      if (event.type === 'agent.staffed' && String(event.payload['designId'] ?? '') === filter.agent) {
        if (event.taskId !== null) agentTasks.add(event.taskId);
      }
    }
  }

  const findings = (event: TimedEvent): Array<{ errorClass?: unknown; criterionId?: unknown }> => {
    const raw = event.payload['findings'];
    return Array.isArray(raw) ? (raw as Array<{ errorClass?: unknown; criterionId?: unknown }>) : [];
  };

  return events.filter((event) => {
    if (filter.family !== undefined && event.family !== filter.family) return false;
    if (filter.agent !== undefined && (event.taskId === null || !agentTasks.has(event.taskId))) return false;
    if (filter.since !== undefined && at(event) < Date.parse(filter.since)) return false;
    if (filter.errorClass !== undefined
      && !findings(event).some((f) => f.errorClass === filter.errorClass)) return false;
    if (filter.criterionId !== undefined
      && !findings(event).some((f) => f.criterionId === filter.criterionId)) return false;
    return true;
  });
}

// ------------------------------------------------------ learning observatory --

/** An experiment the fast loop is running, or has run (R26). */
export interface ExperimentView {
  readonly event: TimedEvent;
  readonly hotFixId: string;
  readonly category: string;
  readonly criterionId: string;
  /**
   * Declared when the experiment was APPLIED, before any result existed.
   *
   * That ordering is the whole of "pre-registered": the same numbers reported
   * after the fact would be a description of what happened, and could not be
   * wrong. `basis` says whether the prediction rests on peer evidence or is the
   * bare direction (ADR-0013), so the lens never presents a degenerate claim as
   * a measured one.
   */
  readonly preRegistered: {
    readonly baselineFailureRate: number;
    readonly predictedFailureRate: number;
    readonly basis: string;
    readonly windowObservations: number;
  };
  /** `null` while still in flight. */
  readonly outcome: 'kept' | 'reverted' | null;
}

/**
 * An amendment petition, beside the sealed-bench verdict that judged it.
 *
 * The two are separate ledger events on purpose: `learning.proposal_emitted` is
 * what the Learning Agent ARGUED, `learning.petition_evaluated` is what the
 * sealed bench ANSWERED. Collapsing them at the source would let a reader
 * mistake the learner's own filing for a judgement made against evidence it
 * never chose — so they are paired here, in the projection, exactly as an
 * experiment is paired with its resolution.
 */
export interface PetitionView {
  readonly event: TimedEvent;
  /** `null` while the petition is filed but not yet judged. */
  readonly verdict: 'supported' | 'unsupported' | 'unevaluated' | null;
  readonly supported: number;
  readonly evaluated: number;
}

/**
 * Has the Learning Agent produced anything for this mission?
 *
 * Lives here rather than in the component because it is a statement about the
 * PROJECTION, and a rule kept in a template cannot be tested or mutated. It was
 * in the component, and the mutant that dropped the slow loop from the count
 * survived — a mission whose only learning output was a bench-tested candidate
 * would have rendered "nothing to show" while holding a decision.
 */
export function hasLearningOutput(view: LearningView): boolean {
  return view.experiments.length + view.adoptions.length + view.reverts.length
    + view.petitions.length + view.libraryGrowth.length
    + view.candidateDecisions.length + view.rankings.length > 0;
}

/**
 * The SLOW loop's half of the ratchet — one science-loop adoption decision.
 *
 * Rejections are carried, not filtered. `AdoptionDecision` makes the argument
 * itself: "a rejected candidate is a MEASUREMENT, and throwing it away means the
 * next hypothesis re-runs the same experiment." A panel showing only adoptions
 * would also render empty today, since every live decision so far is a
 * rejection — and "the science loop has done nothing" is exactly the false
 * impression to avoid.
 */
export interface CandidateDecisionView {
  readonly event: TimedEvent;
  readonly candidateId: string;
  readonly adopt: boolean;
  readonly reason: string;
  readonly wins: number;
  readonly losses: number;
  /** `null` when no sealed case was available to hold the candidate out against. */
  readonly heldOutWon: boolean | null;
}

/** A weak-spot ranking — what every hypothesis downstream is aimed at. */
export interface RankingView {
  readonly event: TimedEvent;
  readonly ranked: number;
  readonly top: readonly {
    readonly category: string;
    readonly severity: number;
    readonly observations: number;
    readonly reasons: readonly string[];
  }[];
}

export interface LearningView {
  readonly experiments: readonly ExperimentView[];
  readonly adoptions: readonly TimedEvent[];
  readonly reverts: readonly TimedEvent[];
  /** Amendment petitions — PROPOSALS. Never rendered as applied changes. */
  readonly petitions: readonly PetitionView[];
  /** Templates the swarm has learned (R31 AC-2) — the library growing. */
  readonly libraryGrowth: readonly TimedEvent[];
  /**
   * The SLOW loop's decisions, kept SEPARATE from `adoptions`/`reverts`.
   *
   * The two loops run at different speeds against different evidence: a
   * fast-loop resolution is an in-mission window of a handful of observations,
   * a science decision is a bench replay under a fixed budget with replication
   * and a held-out slice. Folding them together would let a reader think the two
   * carried the same weight.
   */
  readonly candidateDecisions: readonly CandidateDecisionView[];
  /** Weak-spot rankings — the Learning Agent's primary output. */
  readonly rankings: readonly RankingView[];
}

/**
 * The swarm improving itself (R19 AC-2).
 *
 * REWRITTEN IN PLACE. The buckets were always right; the SOURCES were not. This
 * read `learning.experiment_started`, `learning.adopted`, `learning.reverted`
 * and `learning.amendment_petitioned` — and **nothing in the system emits any of
 * them**. The lens rendered four empty lists and would have forever, which is
 * the same dead-mechanism shape this project has found thirteen times, in a
 * different language.
 *
 * What the ledger actually holds: the fast loop's `fast_loop.hot_fix_applied` /
 * `_resolved` (R26), the propose-only emitter's `learning.proposal_emitted`
 * (R11), and `decomposition.template_learned` (R31).
 *
 * Petitions stay in their own bucket rather than folding in with adoptions,
 * because invariant #4 is that the learner proposes and never ratifies. A lens
 * that showed a petition as a change would misrepresent the constitution — and
 * that separation belongs in the projection, not in a CSS class a redesign could
 * drop.
 */
export function buildLearningView(events: readonly TimedEvent[]): LearningView {
  const of = (type: string) => events.filter((e) => e.type === type);

  const verdictOf = new Map(
    of('learning.petition_evaluated').map(
      (e) => [String((e.payload as { petitionId?: unknown }).petitionId), e] as const,
    ),
  );

  const resolutions = of('fast_loop.hot_fix_resolved');
  const outcomeOf = new Map(
    resolutions.map((e) => [String((e.payload as { hotFixId?: unknown }).hotFixId), e]),
  );

  const experiments = of('fast_loop.hot_fix_applied').map((event): ExperimentView => {
    const p = event.payload as {
      hotFixId?: unknown; category?: unknown; criterionId?: unknown;
      bounds?: { windowObservations?: unknown };
      predictedEffect?: { baselineFailureRate?: unknown; predictedFailureRate?: unknown; basis?: unknown };
    };
    const hotFixId = String(p.hotFixId ?? '');
    const resolution = outcomeOf.get(hotFixId);
    const outcome = resolution === undefined
      ? null
      : String((resolution.payload as { outcome?: unknown }).outcome) === 'kept'
        ? ('kept' as const)
        : ('reverted' as const);

    return {
      event,
      hotFixId,
      category: String(p.category ?? 'unknown'),
      criterionId: String(p.criterionId ?? 'unknown'),
      preRegistered: {
        baselineFailureRate: Number(p.predictedEffect?.baselineFailureRate ?? 0),
        predictedFailureRate: Number(p.predictedEffect?.predictedFailureRate ?? 0),
        basis: String(p.predictedEffect?.basis ?? 'unknown'),
        windowObservations: Number(p.bounds?.windowObservations ?? 0),
      },
      outcome,
    };
  });

  // Split on the RESOLUTION's own outcome, so a lens cannot report a revert as
  // an adoption. A resolution whose experiment was applied in an earlier mission
  // still appears here — it really happened — but no experiment is invented to
  // parent it, which would show pre-registered metrics nobody registered.
  const outcomeIs = (want: string) => (e: TimedEvent) =>
    String((e.payload as { outcome?: unknown }).outcome) === want;

  return {
    experiments,
    adoptions: resolutions.filter(outcomeIs('kept')),
    reverts: resolutions.filter(outcomeIs('reverted')),
    // Paired with the verdict that judged it, keyed on the petition's own event
    // id (defect `78e4e5cf`). An operator ratifies out-of-band, and the point of
    // the sealed slice is that their decision rests on evidence the learner
    // could not choose — so showing the argument without the answer inverts what
    // the slice is for.
    //
    // Matched by id rather than by recency: a mission can raise more than one
    // weak spot over its life, and "the latest verdict" would attach one
    // petition's judgement to another. A verdict with no petition in this trail
    // invents nothing, the same rule resolutions already follow.
    petitions: of('learning.proposal_emitted').map((event): PetitionView => {
      const verdict = verdictOf.get(event.eventId);
      const p = verdict?.payload as { verdict?: unknown; supported?: unknown; evaluated?: unknown } | undefined;
      return {
        event,
        verdict: p === undefined ? null : (String(p.verdict) as PetitionView['verdict']),
        supported: Number(p?.supported ?? 0),
        evaluated: Number(p?.evaluated ?? 0),
      };
    }),
    libraryGrowth: of('decomposition.template_learned'),
    candidateDecisions: of('learning.candidate_evaluated').map((event): CandidateDecisionView => {
      const p = event.payload as {
        adopt?: unknown; reason?: unknown;
        evidence?: { candidateId?: unknown; wins?: unknown; losses?: unknown; heldOutWon?: unknown };
      };
      const heldOut = p.evidence?.heldOutWon;
      return {
        event,
        candidateId: String(p.evidence?.candidateId ?? 'unknown'),
        // Explicitly `=== true`, so a payload that lost the field reads as NOT
        // adopted. Defaulting the other way would show an unrecorded decision as
        // a change the swarm made to itself.
        adopt: p.adopt === true,
        reason: String(p.reason ?? ''),
        wins: Number(p.evidence?.wins ?? 0),
        losses: Number(p.evidence?.losses ?? 0),
        heldOutWon: typeof heldOut === 'boolean' ? heldOut : null,
      };
    }),
    rankings: of('learning.weak_spots_ranked').map((event): RankingView => {
      const p = event.payload as { ranked?: unknown; top?: unknown };
      const top = Array.isArray(p.top) ? p.top : [];
      return {
        event,
        ranked: Number(p.ranked ?? 0),
        top: top.map((s) => {
          const spot = s as { category?: unknown; severity?: unknown; observations?: unknown; reasons?: unknown };
          return {
            category: String(spot.category ?? 'unknown'),
            severity: Number(spot.severity ?? 0),
            observations: Number(spot.observations ?? 0),
            reasons: Array.isArray(spot.reasons) ? spot.reasons.map(String) : [],
          };
        }),
      };
    }),
  };
}
