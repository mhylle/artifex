/**
 * The Tier Policy engine (ADR-0002).
 *
 * Model tier is a **computed policy**, never a per-agent constant. The engine is
 * written floor-first and deliberately biased downward: it establishes the
 * cheapest tier the task's risk permits, then climbs only when something
 * justifies the spend. "Smallest model that works", not "safest imaginable" —
 * effort is a currency (invariant #7), and a swarm that reaches for the frontier
 * model by default cannot afford to fan out at all.
 *
 * Two directions matter and both are load-bearing:
 *   - **up**   — irreversibility, fan-in and blast radius raise the *floor*, and a
 *                tier bump is itself a rung of the escalation ladder.
 *   - **down** — a proven clade earns a cheaper tier, and budget pressure lowers
 *                the tier *as far as the floor and no further*.
 *
 * The floor is constitutional. Nothing — not budget, not a perfect clade score —
 * may breach it; when the budget cannot afford the floor the mission escalates to
 * a human rather than quietly running the task on a model too small to be trusted
 * with it. That silent downgrade is the failure this engine exists to prevent.
 */
import type { AutonomyDial, BlastRadius, LedgerEventInput, LogicalTier } from '@artifex/shared-types';

/**
 * What kind of work this is. Mechanical work needs no model at all, which is the
 * cheapest outcome available and worth reaching for explicitly.
 */
export const TASK_CLASSES = ['mechanical', 'generative', 'evaluative'] as const;
export type TaskClass = (typeof TASK_CLASSES)[number];

export interface TierPolicyInput {
  readonly blastRadius: BlastRadius;
  /** How many downstream tasks consume this one. High fan-in multiplies a mistake. */
  readonly fanIn: number;
  readonly reversible: boolean;
  readonly taskClass: TaskClass;
  readonly autonomyDial: AutonomyDial;
  /** Fraction of the task's budget still available, 0–1. Low means pressure. */
  readonly budgetHeadroom: number;
  /** Historical success of this agent clade, 0–1, or null when unproven. */
  readonly cladeScore: number | null;
}

export interface TierDecision {
  readonly tier: LogicalTier;
  /** The constitutional minimum. Nothing may go below it. */
  readonly floor: LogicalTier;
  readonly scores: TierPolicyInput;
  /** Set when the budget cannot afford the floor — a human decides, not the engine. */
  readonly escalateToHuman: boolean;
  /** The reasoning trail, so a decision can be audited and learned from. */
  readonly adjustments: string[];
}

const FRONTIER_TIER = 3;
const NO_LLM_TIER = 0;

/** Fan-in at which a mistake stops being local. Root tasks sit far above this. */
const FAN_IN_MULTIPLIER_THRESHOLD = 5;
/** Clade evidence strong enough to buy a cheaper tier. */
const PROVEN_CLADE_SCORE = 0.9;
/** Headroom below which the budget is under genuine pressure. */
const BUDGET_PRESSURE_HEADROOM = 0.2;

function clamp(tier: number): LogicalTier {
  return Math.max(NO_LLM_TIER, Math.min(FRONTIER_TIER, Math.round(tier))) as LogicalTier;
}

/**
 * The constitutional minimum tier for this task.
 *
 * Blast radius sets the base; irreversibility and fan-in each raise it, because
 * both remove the cheap remedy — you cannot simply re-run a task whose mistake
 * has already been consumed by twelve siblings or written to the world.
 */
function floorFor(input: TierPolicyInput): LogicalTier {
  // Mechanical work is checkable without a model, so its floor is zero
  // regardless of blast radius — a schema check does not get better on a
  // bigger model, and paying for one would be pure waste.
  if (input.taskClass === 'mechanical') {
    return NO_LLM_TIER;
  }

  const base = { low: 1, medium: 1, high: 2 }[input.blastRadius];
  const irreversible = input.reversible ? 0 : 1;
  const fannedIn = input.fanIn > FAN_IN_MULTIPLIER_THRESHOLD ? 1 : 0;

  return clamp(base + irreversible + fannedIn);
}

/**
 * Compute the tier for one staffing decision.
 *
 * Order matters: establish the floor, propose from it, then apply the downward
 * adjustments. Anything else risks a cheap model being chosen first and the floor
 * being consulted only as an afterthought.
 */
export function computeTier(input: TierPolicyInput): TierDecision {
  const floor = floorFor(input);
  const adjustments: string[] = [`floor ${floor} from blast=${input.blastRadius}, fanIn=${input.fanIn}, reversible=${input.reversible}`];

  // Evaluative work — judging someone else's output — is the one class that
  // genuinely benefits from a stronger model, so it proposes one rung above the
  // floor. Everything else starts *at* the floor.
  let proposed = floor;
  if (input.taskClass === 'evaluative') {
    proposed = clamp(proposed + 1);
    adjustments.push('evaluative work proposes one rung above the floor');
  }

  // DOWNGRADE — a clade with a track record has earned the cheaper model.
  if (input.cladeScore !== null && input.cladeScore >= PROVEN_CLADE_SCORE && proposed > floor) {
    proposed = clamp(proposed - 1);
    adjustments.push(`proven clade (${input.cladeScore}) earns a cheaper tier`);
  }

  // DOWNGRADE — budget pressure trims the tier, but only into the slack above
  // the floor. If there is no slack, the engine does NOT quietly under-provision.
  let escalateToHuman = false;
  if (input.budgetHeadroom < BUDGET_PRESSURE_HEADROOM) {
    if (proposed > floor) {
      proposed = clamp(proposed - 1);
      adjustments.push('budget pressure trimmed the tier into the slack above the floor');
    } else {
      escalateToHuman = true;
      adjustments.push(
        'budget cannot afford the constitutional floor — escalating to a human rather than under-provisioning',
      );
    }
  }

  return { tier: clamp(Math.max(proposed, floor)), floor, scores: input, escalateToHuman, adjustments };
}

/**
 * Render a tier decision as a ledger event (R4 AC-3).
 *
 * The *inputs* travel with the answer. A recorded tier without the scores that
 * produced it cannot be audited, replayed, or mined by the Learning Agent — and
 * the whole point of a computed policy is that its reasoning is inspectable.
 */
export function tierDecisionToLedgerEvent(
  decision: TierDecision,
  meta: {
    readonly eventId: string;
    readonly missionId: string;
    readonly taskId: string;
    readonly occurredAt: string;
  },
): LedgerEventInput {
  return {
    eventId: meta.eventId,
    missionId: meta.missionId,
    taskId: meta.taskId,
    family: 'decision',
    type: 'tier.computed',
    actor: { kind: 'agent_creator', id: 'tier-policy-engine', displayName: 'Tier Policy Engine' },
    payload: {
      tier: decision.tier,
      floor: decision.floor,
      escalateToHuman: decision.escalateToHuman,
      adjustments: decision.adjustments,
      scores: { ...decision.scores },
    },
    occurredAt: meta.occurredAt,
  };
}
