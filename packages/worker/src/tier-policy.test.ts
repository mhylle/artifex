/**
 * P4 — the Tier Policy engine (R4 AC-1, AC-3) and the constitutional floor.
 *
 * Tier is a *computed policy*, never a per-agent constant (ADR-0002). The engine
 * starts at the smallest tier the task's risk permits and only climbs when
 * something justifies it — cheapest-that-works, not safest-imaginable.
 */
import { LedgerEventInputSchema, validate } from '@artifex/shared-types';
import { describe, expect, it } from 'vitest';

import { computeTier, tierDecisionToLedgerEvent } from './tier-policy.js';
import type { TierPolicyInput } from './tier-policy.js';

/** A cheap, low-risk, reversible leaf task — the common case. */
function leafTask(over: Partial<TierPolicyInput> = {}): TierPolicyInput {
  return {
    blastRadius: 'low',
    fanIn: 0,
    reversible: true,
    taskClass: 'generative',
    autonomyDial: 'autonomous',
    budgetHeadroom: 1,
    cladeScore: null,
    ...over,
  };
}

describe('R4 AC-1 — the constitutional floor holds against budget pressure', () => {
  it('a high-blast root task on a supervised mission computes Tier 3', () => {
    const decision = computeTier({
      ...leafTask(),
      blastRadius: 'high',
      fanIn: 12,
      reversible: false,
      autonomyDial: 'supervised',
    });

    expect(decision.tier).toBe(3);
    expect(decision.floor).toBe(3);
  });

  it('budget pressure cannot push it below the floor — it escalates to a human instead', () => {
    const decision = computeTier({
      ...leafTask(),
      blastRadius: 'high',
      fanIn: 12,
      reversible: false,
      autonomyDial: 'supervised',
      budgetHeadroom: 0.01,
    });

    expect(decision.tier).toBe(3);
    expect(decision.escalateToHuman).toBe(true);
  });

  it('DISTRACTOR: with headroom, the same task does NOT escalate', () => {
    // Proves escalation is caused by budget pressure, not hardwired to high blast.
    const decision = computeTier({
      ...leafTask(),
      blastRadius: 'high',
      fanIn: 12,
      reversible: false,
      autonomyDial: 'supervised',
      budgetHeadroom: 1,
    });

    expect(decision.escalateToHuman).toBe(false);
  });

  it('DISTRACTOR: budget pressure DOES lower the tier when it stays at or above the floor', () => {
    // Otherwise "cannot go below the floor" could be implemented as
    // "never respond to budget at all", which would pass the tests above.
    const relaxed = computeTier({ ...leafTask(), taskClass: 'evaluative', budgetHeadroom: 1 });
    const squeezed = computeTier({ ...leafTask(), taskClass: 'evaluative', budgetHeadroom: 0.01 });

    expect(squeezed.tier).toBeLessThan(relaxed.tier);
    expect(squeezed.tier).toBeGreaterThanOrEqual(squeezed.floor);
    expect(squeezed.escalateToHuman).toBe(false);
  });
});

describe('smallest model that works — the engine defaults DOWN, not up', () => {
  it('a mechanical, low-blast, reversible task needs no LLM at all (Tier 0)', () => {
    expect(computeTier(leafTask({ taskClass: 'mechanical' })).tier).toBe(0);
  });

  it('an ordinary low-blast generative leaf runs at Tier 1, not higher', () => {
    expect(computeTier(leafTask()).tier).toBe(1);
  });

  it('DOWNGRADE: a proven clade lowers the tier', () => {
    const unproven = computeTier(leafTask({ taskClass: 'evaluative', cladeScore: null }));
    const proven = computeTier(leafTask({ taskClass: 'evaluative', cladeScore: 0.95 }));

    expect(proven.tier).toBeLessThan(unproven.tier);
    expect(proven.adjustments.join(' ')).toMatch(/clade/i);
  });

  it('DOWNGRADE never breaches the floor — a proven clade cannot cheapen a high-blast task', () => {
    const proven = computeTier({
      ...leafTask(),
      blastRadius: 'high',
      fanIn: 12,
      reversible: false,
      cladeScore: 0.99,
    });

    expect(proven.tier).toBe(proven.floor);
    expect(proven.tier).toBe(3);
  });

  it('UPGRADE: irreversibility and fan-in each raise the floor', () => {
    const base = computeTier(leafTask({ blastRadius: 'medium' }));
    const irreversible = computeTier(leafTask({ blastRadius: 'medium', reversible: false }));
    const fannedIn = computeTier(leafTask({ blastRadius: 'medium', fanIn: 12 }));

    expect(irreversible.floor).toBeGreaterThan(base.floor);
    expect(fannedIn.floor).toBeGreaterThan(base.floor);
  });

  it('DISTRACTOR: tier never exceeds the frontier tier or drops below zero', () => {
    const maxed = computeTier({
      ...leafTask(),
      blastRadius: 'high',
      fanIn: 999,
      reversible: false,
      taskClass: 'evaluative',
      autonomyDial: 'supervised',
    });
    const minimal = computeTier(leafTask({ taskClass: 'mechanical', cladeScore: 0.99 }));

    expect(maxed.tier).toBeLessThanOrEqual(3);
    expect(minimal.tier).toBeGreaterThanOrEqual(0);
  });
});

describe('R4 AC-3 — every tier decision is written to the ledger with its inputs', () => {
  const decision = computeTier(leafTask({ blastRadius: 'medium', fanIn: 3 }));
  const event = tierDecisionToLedgerEvent(decision, {
    eventId: '11111111-2222-4333-8444-555555555555',
    missionId: '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13',
    taskId: 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39',
    occurredAt: '2026-07-30T09:00:00.000Z',
  });

  it('produces a valid ledger event', () => {
    expect(validate(LedgerEventInputSchema, event).ok).toBe(true);
  });

  it('is filed as a decision, so the ladder is queryable rather than archaeological', () => {
    expect(event.family).toBe('decision');
    expect(event.type).toMatch(/tier/i);
  });

  it('carries the chosen tier AND the input scores that produced it', () => {
    // A decision without its inputs cannot be audited or learned from.
    const payload = event.payload as { tier?: unknown; scores?: Record<string, unknown> };

    expect(payload.tier).toBe(decision.tier);
    for (const field of ['blastRadius', 'fanIn', 'reversible', 'taskClass', 'budgetHeadroom']) {
      expect(payload.scores, `scores must record "${field}"`).toHaveProperty(field);
    }
  });

  it('DISTRACTOR: records the floor and the adjustment trail, not just the answer', () => {
    const payload = event.payload as { floor?: unknown; adjustments?: unknown };

    expect(payload.floor).toBe(decision.floor);
    expect(Array.isArray(payload.adjustments)).toBe(true);
  });
});
