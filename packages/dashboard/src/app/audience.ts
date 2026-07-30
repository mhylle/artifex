/**
 * Audience scoping (R22) — one substrate, three ways of being allowed to look.
 *
 * "Operator — everything. Requester — their mission only, simplified. Learning
 * observer — the Learning Observatory across all missions. Read-only."
 *
 * This is NOT authn/authz: identity stays out of scope until the security
 * boundary is lifted. It is view scoping and available actions.
 *
 * The scope is a pure function so that "what may this audience do" has exactly
 * one answer. The alternative — deciding it in each template — is how a button
 * ends up hidden in one place while the action it sends stays reachable in
 * another, which is the R20 read-only lesson restated: the guard belongs where
 * the action is SENT, and the template merely reflects it.
 */
import type { LensName } from './lens-panels';

export type Audience = 'operator' | 'requester' | 'observer';

export type CockpitAction =
  | 'pause' | 'resume' | 'cancel' | 'grant_budget' | 'turn_dial' | 'annotate' | 'decide';

export interface AudienceScope {
  /** Whether the mission rail spans the fleet or just this audience's own mission. */
  readonly missions: 'all' | 'own';
  readonly lenses: readonly LensName[];
  readonly rawLedger: boolean;
  readonly attentionQueue: boolean;
  readonly actions: readonly CockpitAction[];
}

const ALL_LENSES: readonly LensName[] = ['canvas', 'workforce', 'timeline', 'learning', 'ledger'];

const SCOPES: Readonly<Record<Audience, AudienceScope>> = {
  operator: {
    missions: 'all',
    lenses: ALL_LENSES,
    rawLedger: true,
    attentionQueue: true,
    actions: ['pause', 'resume', 'cancel', 'grant_budget', 'turn_dial', 'annotate', 'decide'],
  },

  /**
   * The requester gets their own mission, and the three powers intake promised
   * them: answer questions, approve budget extensions, adjust their own dial.
   *
   * Not pause/cancel/annotate. Those are controls over *how* the work is done,
   * which is the operator's accountability — a requester who could cancel a
   * task would be reaching past their contract into the execution.
   */
  requester: {
    missions: 'own',
    lenses: [],
    rawLedger: false,
    attentionQueue: false,
    actions: ['decide', 'grant_budget', 'turn_dial'],
  },

  /**
   * Read-only across every mission.
   *
   * Not "everything, greyed out" — the observatory only. An observer who could
   * act could steer the system they are measuring, and the measurement would
   * stop meaning anything.
   */
  observer: {
    missions: 'all',
    lenses: ['learning'],
    rawLedger: false,
    attentionQueue: false,
    actions: [],
  },
};

export function scopeFor(audience: Audience): AudienceScope {
  return SCOPES[audience];
}

/**
 * Whether this audience may issue this action.
 *
 * Fails CLOSED: anything not explicitly granted is refused, including an action
 * name that does not exist. This gates every write the cockpit can make, and a
 * guard that fails open on an unrecognised input is not a guard.
 */
export function mayAct(audience: Audience, action: CockpitAction): boolean {
  return SCOPES[audience].actions.includes(action);
}
