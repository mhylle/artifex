/**
 * R13 AC-3 — blast radius bounds the reachable tool set, at the point of GRANT.
 *
 * AC-3 was already satisfied by the broker's rejection test: a tool the contract
 * does not carry is refused. This is the other end of the same rule — what a
 * contract carries in the first place — and it has to agree with the broker's
 * version exactly, because a grant the broker would refuse is a contract that
 * promises something the system will deny.
 */
import { describe, expect, it } from 'vitest';

import { TOOL_CATALOGUE, admissibleRiskClasses, grantsFor } from './tool-catalogue.js';
import { ToolEntitlementSchema } from './contract.js';
import { validate } from './validation.js';

describe('R13 AC-3 — the blast radius decides which tools a contract may carry', () => {
  it('grants nothing at LOW, because no catalogued tool is read-class', () => {
    // Deliberately not a special case in the code: `low` admits `read`, and this
    // build catalogues no read-class tool, so the set is empty by the rule
    // rather than by an exception. The control below keeps that honest.
    expect(grantsFor('low')).toEqual([]);
    expect(admissibleRiskClasses('low')).toEqual(['read']);
  });

  it('grants the compute tool at MEDIUM and HIGH', () => {
    // CONTROL: if this returned nothing at every radius, the assertion above
    // would pass while the rule did nothing at all.
    const medium = grantsFor('medium');
    expect(medium.map((g) => g.toolId), 'nothing is grantable at any radius').toContain('text.count');
    expect(grantsFor('high').map((g) => g.toolId)).toContain('text.count');
  });

  it('produces entitlements that validate against the contract schema', () => {
    // A grant that cannot be written into a contract is not a grant. This is the
    // seam where a hand-built object silently diverges from the schema — the
    // fixture-versus-schema mismatch this project has hit before.
    for (const grant of grantsFor('high')) {
      expect(validate(ToolEntitlementSchema, grant).ok, JSON.stringify(grant)).toBe(true);
    }
  });

  it('DISTRACTOR: every granted tool is one the broker would admit at that radius', () => {
    // The two ends of the rule agreeing is the whole point of it living in one
    // place. Asserted as a property over the catalogue rather than for one tool,
    // so adding a `write` tool later cannot quietly break it.
    for (const radius of ['low', 'medium', 'high'] as const) {
      const admitted = admissibleRiskClasses(radius);
      for (const grant of grantsFor(radius)) {
        expect(admitted, `${grant.toolId} granted at ${radius} but not admissible`).toContain(grant.riskClass);
      }
    }
  });

  it('DISTRACTOR: a tool NOT admitted at a radius is absent, not merely unmentioned', () => {
    // Both sides: the catalogue has to contain something the low radius excludes,
    // or "excluded" is vacuous.
    const excluded = TOOL_CATALOGUE.filter((t) => !admissibleRiskClasses('low').includes(t.riskClass));
    expect(excluded.length, 'the catalogue excludes nothing at low, so the bound is untested').toBeGreaterThan(0);
    for (const tool of excluded) {
      expect(grantsFor('low').map((g) => g.toolId)).not.toContain(tool.toolId);
    }
  });
});
