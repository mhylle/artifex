/**
 * The intake dialogue (R30) — interrogate until testable, then flag what remains.
 *
 * The dossier's Stage 1: *"The intake dialogue interrogates the requester until
 * the mission has testable success criteria, explicit scope boundaries, an
 * autonomy-dial setting, and an effort budget. Ambiguities are surfaced as
 * explicit open questions — never silently assumed away; if the dial permits,
 * low-stakes ambiguities may be carried into the run as flagged assumptions,
 * escalated the moment they start to matter."*
 *
 * The rationale is measured rather than aesthetic: bad specification is the
 * largest single failure source in multi-agent systems (44%, MAST), and
 * "failing to ask for clarification" is a top-ten measured failure mode.
 *
 * **The judgement and the policy are separate.** Deciding whether a criterion is
 * testable, or what is ambiguous about a request, is a model call. Deciding what
 * to do about the answer is not, and it must be inspectable without one — so the
 * triage below is a pure function, like every other decision in this package.
 *
 * Where this runs is ADR-0022: the API keeps the deterministic half it already
 * enforces (the fields exist, the body is well-formed), and the judged half runs
 * as the mission's FIRST act in the worker, before anything is decomposed or
 * staffed. Putting a model call in the control plane would turn a degraded model
 * into a total intake outage.
 */
import type { AutonomyDial } from '@artifex/shared-types';

/** One thing the request left open, and how much it costs to guess wrong. */
export interface IntakeQuestion {
  /** Which criterion or field it is about, so the requester can answer it. */
  readonly about: string;
  readonly question: string;
  /**
   * `high` when guessing wrong would change what gets built or delivered;
   * `low` when the work is defensible either way.
   *
   * Judged, not derived — it is a property of the request, not of the schema.
   */
  readonly stakes: 'low' | 'high';
}

export interface InterrogationVerdict {
  /** Must be answered before the mission starts. */
  readonly blocking: IntakeQuestion[];
  /** Carried into the run as a flagged assumption, escalated when it matters. */
  readonly flagged: IntakeQuestion[];
}

/**
 * Which dials permit carrying a low-stakes ambiguity rather than asking.
 *
 * Derived from the dial semantics this codebase already uses rather than
 * invented. `requiresRatification` asks nobody under `autonomous`, asks about
 * consequential acts under `checkpointed`, and asks about everything short of
 * reading under `supervised`; and the mission loop's own comment holds that
 * *"fully autonomous must mean nobody is asked, or the setting is decorative"*.
 *
 * A low-stakes ambiguity is not a consequential act, so `autonomous` and
 * `checkpointed` carry it. `supervised` asks — that dial exists precisely for a
 * requester who wants to be consulted about things that could go either way.
 */
function carriesLowStakes(dial: AutonomyDial): boolean {
  return dial !== 'supervised';
}

/**
 * Split the open questions into what stops the mission and what rides along.
 *
 * **Every question lands in exactly one list.** AC-1's demand is that an
 * ambiguity is "never silently resolved by assumption", and a question that
 * appeared in neither list would be exactly that — resolved by silence. The
 * partition is what makes the guarantee structural rather than a promise.
 *
 * A `high`-stakes question blocks under every dial. The criterion permits
 * carrying only *low-stakes* ambiguities, and no dial setting widens that: an
 * autonomy dial says how much a requester wants to be consulted, not how much
 * the system may guess about things that change the deliverable.
 */
export function triageQuestions(
  questions: readonly IntakeQuestion[],
  dial: AutonomyDial,
): InterrogationVerdict {
  const blocking: IntakeQuestion[] = [];
  const flagged: IntakeQuestion[] = [];

  for (const question of questions) {
    if (question.stakes === 'low' && carriesLowStakes(dial)) flagged.push(question);
    else blocking.push(question);
  }

  return { blocking, flagged };
}
