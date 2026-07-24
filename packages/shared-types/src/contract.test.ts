import { describe, expect, it } from 'vitest';

import { validTaskContract } from './__fixtures__/samples.js';
import { TaskContractSchema } from './contract.js';
import { validate } from './validation.js';

/**
 * R1 AC-0 — "Given a task contract missing its acceptance-criteria field, when
 * validated against the contract schema, then validation fails with a
 * path-specific error naming the missing field."
 */
describe('R1 AC-0 — a contract without acceptance criteria is invalid', () => {
  it('fails with a path-specific error naming acceptanceCriteria', () => {
    const { acceptanceCriteria: _dropped, ...withoutCriteria } = validTaskContract();

    const result = validate(TaskContractSchema, withoutCriteria);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const error = result.errors.find((e) => e.path === '/acceptanceCriteria');
    expect(error, `expected an error at /acceptanceCriteria, got ${JSON.stringify(result.errors)}`)
      .toBeDefined();
    expect(error?.message).toContain('acceptanceCriteria');
  });

  // Distractor: kills a validator that just always fails.
  it('accepts a complete contract', () => {
    expect(validate(TaskContractSchema, validTaskContract())).toEqual({
      ok: true,
      value: validTaskContract(),
    });
  });

  // Distractor: present-but-empty must fail too — "no work without a contract"
  // means criteria that exist, not an empty list that trivially passes.
  it('rejects an empty acceptance-criteria list', () => {
    const result = validate(TaskContractSchema, {
      ...validTaskContract(),
      acceptanceCriteria: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path === '/acceptanceCriteria')).toBe(true);
  });

  // Distractor: a criterion missing its statement must be named at its index,
  // proving errors are path-specific rather than whole-object "invalid".
  it('names the exact path of an invalid criterion', () => {
    const result = validate(TaskContractSchema, {
      ...validTaskContract(),
      acceptanceCriteria: [{ criterionId: 'ac-1' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path === '/acceptanceCriteria/0/statement')).toBe(true);
  });
});
