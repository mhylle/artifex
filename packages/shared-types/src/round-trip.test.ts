import type { TSchema } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';

import {
  validCapabilityManifest,
  validEvidenceBundle,
  validLedgerEvent,
  validLedgerEventInput,
  validTaskContract,
  validVerdict,
} from './__fixtures__/samples.js';
import { CapabilityManifestSchema } from './capability-manifest.js';
import { TaskContractSchema } from './contract.js';
import { EvidenceBundleSchema } from './evidence-bundle.js';
import { LedgerEventInputSchema, LedgerEventSchema } from './ledger-event.js';
import { toJsonSchema, validate } from './validation.js';
import { VerdictSchema } from './verdict.js';

/**
 * R1 AC-1 — "Given any shared schema exported to JSON Schema and used to
 * constrain an LLM structured-output call, when a schema-valid response is
 * returned, then it round-trips back through the ajv validator with no error —
 * and a schema that drops a required field fails the round-trip (distractor)."
 *
 * "Any shared schema" is taken literally: every exported schema is exercised.
 */
const SHARED_SCHEMAS: ReadonlyArray<readonly [string, TSchema, () => unknown]> = [
  ['TaskContract', TaskContractSchema, validTaskContract],
  ['LedgerEventInput', LedgerEventInputSchema, validLedgerEventInput],
  ['LedgerEvent', LedgerEventSchema, validLedgerEvent],
  ['EvidenceBundle', EvidenceBundleSchema, validEvidenceBundle],
  ['Verdict', VerdictSchema, validVerdict],
  ['CapabilityManifest', CapabilityManifestSchema, validCapabilityManifest],
];

/** Simulates the wire trip: what we hand the model, and what it hands back. */
function overTheWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe.each(SHARED_SCHEMAS)('R1 AC-1 — %s round-trips', (_name, schema, sample) => {
  it('exports the exact object it validates with (zero translation, ADR-0004)', () => {
    // Referential identity is the strongest form of "no translation step":
    // the schema we validate against IS the schema handed to the model.
    expect(toJsonSchema(schema)).toBe(schema);
  });

  it('serializes to a model-constrainable JSON Schema', () => {
    const wire = overTheWire(toJsonSchema(schema)) as Record<string, unknown>;

    expect(wire['type']).toBe('object');
    // Structured-output backends need closed objects, and it keeps unknown
    // fields from silently passing validation.
    expect(wire['additionalProperties']).toBe(false);
    expect(Array.isArray(wire['required'])).toBe(true);
    expect((wire['required'] as string[]).length).toBeGreaterThan(0);
  });

  it('accepts a schema-valid response with no error', () => {
    const response = overTheWire(sample());

    expect(validate(schema, response)).toEqual({ ok: true, value: response });
  });

  it('DISTRACTOR: dropping any required field fails, naming that field', () => {
    const response = overTheWire(sample()) as Record<string, unknown>;
    const required = (toJsonSchema(schema) as { required?: string[] }).required ?? [];

    expect(required.length).toBeGreaterThan(0);

    for (const field of required) {
      const { [field]: _dropped, ...broken } = response;

      const result = validate(schema, broken);

      expect(result.ok, `dropping "${field}" should have failed validation`).toBe(false);
      if (result.ok) continue;
      expect(
        result.errors.some((e) => e.path === `/${field}`),
        `expected an error at /${field}, got ${JSON.stringify(result.errors)}`,
      ).toBe(true);
    }
  });

  it('DISTRACTOR: an unknown extra field is rejected', () => {
    const result = validate(schema, { ...(overTheWire(sample()) as object), smuggled: true });

    expect(result.ok).toBe(false);
  });
});
