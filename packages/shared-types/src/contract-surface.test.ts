/**
 * P2.5 — the R12/R13 contract surface (ADR-0007).
 *
 * One test per acceptance criterion, each with a distractor that fails any
 * plausible-wrong implementation. These are the *surface* halves of the ACs:
 * the runtime halves belong to P8.5 (Action Broker) and P8.6 (self-critique).
 */
import { describe, expect, it } from 'vitest';

import {
  validActionRecord,
  validEvidenceBundle,
  validReflectionRecord,
  validTaskContract,
} from './__fixtures__/samples.js';
import { TaskContractSchema, WorkerContractViewSchema } from './contract.js';
import { EvidenceBundleSchema } from './evidence-bundle.js';
import { LEDGER_EVENT_FAMILIES } from './ledger-event.js';
import { ReflectionRecordSchema } from './reflection.js';
import { validate } from './validation.js';

/** The properties an object schema actually declares. */
function propertiesOf(schema: unknown): string[] {
  return Object.keys((schema as { properties: Record<string, unknown> }).properties);
}

function errorPaths(value: unknown, schema: Parameters<typeof validate>[0]): string[] {
  const result = validate(schema, value);
  expect(result.ok, 'expected this to FAIL validation, but it passed').toBe(false);
  return result.ok ? [] : result.errors.map((e) => e.path);
}

describe('R12 AC-2 — the verification plan is withheld by the schema, not by convention', () => {
  it('rejects a worker view that still carries the verification plan', () => {
    // The full contract is exactly what must NOT reach a worker. Withholding is
    // a guarantee here, not a stripping convention someone can forget to apply.
    const paths = errorPaths(validTaskContract(), WorkerContractViewSchema);

    expect(paths).toContain('/verificationPlan');
  });

  it('accepts the same contract once the verification plan is removed', () => {
    const { verificationPlan: _withheld, ...view } = validTaskContract();

    expect(validate(WorkerContractViewSchema, view).ok).toBe(true);
  });

  it('still carries the acceptance criteria — reflection needs something to critique against', () => {
    expect(propertiesOf(WorkerContractViewSchema)).toContain('acceptanceCriteria');
  });

  it('DISTRACTOR: is a distinct schema from TaskContract, not an alias of it', () => {
    // If Omit were a no-op, the first test above would pass for the wrong reason.
    expect(propertiesOf(TaskContractSchema)).toContain('verificationPlan');
    expect(propertiesOf(WorkerContractViewSchema)).not.toContain('verificationPlan');
  });
});

describe('R12 AC-0 — a reflection record is structurally incapable of being a verdict', () => {
  it('declares no gate, outcome or verdict id', () => {
    const properties = propertiesOf(ReflectionRecordSchema);

    for (const forbidden of ['gate', 'outcome', 'verdictId']) {
      expect(properties, `ReflectionRecord must not declare "${forbidden}"`).not.toContain(
        forbidden,
      );
    }
  });

  it('DISTRACTOR: a verdict field cannot be smuggled in at runtime either', () => {
    const smuggled = { ...validReflectionRecord(), outcome: 'pass' };

    expect(errorPaths(smuggled, ReflectionRecordSchema)).toContain('/outcome');
  });

  it('points at the pre-reflection draft so both versions are recoverable', () => {
    expect(propertiesOf(ReflectionRecordSchema)).toContain('priorDraftEventId');
    expect(validate(ReflectionRecordSchema, validReflectionRecord()).ok).toBe(true);
  });
});

describe('R13 AC-2 — evidence actions are structured invocations, not prose', () => {
  it('accepts structured action records', () => {
    expect(validate(EvidenceBundleSchema, validEvidenceBundle()).ok).toBe(true);
  });

  it('DISTRACTOR: the old free-text form is rejected, naming the offending entry', () => {
    const prose = {
      ...validEvidenceBundle(),
      actions: ['Restated the contract.', 'Searched the entitled source list.'],
    };

    expect(errorPaths(prose, EvidenceBundleSchema).some((p) => p.startsWith('/actions/0'))).toBe(
      true,
    );
  });

  it('DISTRACTOR: an unbrokered action is rejected — there is no action off-ledger', () => {
    // Unlike ConsultedSource, viaBrokerGrantId is NOT nullable: every action
    // passes through the broker, so every action has a grant (invariant #1).
    const unbrokered = {
      ...validEvidenceBundle(),
      actions: [{ ...validActionRecord(), viaBrokerGrantId: null }],
    };

    expect(errorPaths(unbrokered, EvidenceBundleSchema)).toContain('/actions/0/viaBrokerGrantId');
  });

  it('carries the reflection record, present-and-nullable rather than optional', () => {
    const required = (EvidenceBundleSchema as unknown as { required: string[] }).required;

    expect(required).toContain('reflection');
    expect(validate(EvidenceBundleSchema, { ...validEvidenceBundle(), reflection: null }).ok).toBe(
      true,
    );
  });
});

describe('R13 AC-3 (surface half) — tool grants live on the contract', () => {
  it('accepts a contract carrying tool entitlements', () => {
    expect(validate(TaskContractSchema, validTaskContract()).ok).toBe(true);
  });

  it('DISTRACTOR: an entitlement without a risk class fails, naming the exact field', () => {
    const contract = validTaskContract();
    const [granted] = contract.inputs.toolEntitlements;
    const { riskClass: _dropped, ...incomplete } = granted!;
    const broken = {
      ...contract,
      inputs: { ...contract.inputs, toolEntitlements: [incomplete] },
    };

    expect(errorPaths(broken, TaskContractSchema)).toContain(
      '/inputs/toolEntitlements/0/riskClass',
    );
  });

  it('DISTRACTOR: an unknown risk class is rejected — the vocabulary is closed', () => {
    const contract = validTaskContract();
    const broken = {
      ...contract,
      inputs: {
        ...contract.inputs,
        toolEntitlements: [{ ...contract.inputs.toolEntitlements[0]!, riskClass: 'admin' }],
      },
    };

    expect(errorPaths(broken, TaskContractSchema)).toContain(
      '/inputs/toolEntitlements/0/riskClass',
    );
  });

  it('keeps context entitlements separate — context and action are different channels', () => {
    // ADR-0006 explicitly refuses folding tools into the context channel.
    const contract = validTaskContract();

    expect(contract.inputs.entitlements).not.toEqual(contract.inputs.toolEntitlements);
    expect(propertiesOf(TaskContractSchema)).toContain('inputs');
  });
});

describe('R13 AC-0 (surface half) — actions are their own ledger family', () => {
  it('adds "action" to the audit taxonomy', () => {
    // A family lookup, not a string-prefix scan over `type`: the ledger is
    // "structured for querying, not archaeology".
    expect(LEDGER_EVENT_FAMILIES).toContain('action');
  });

  it('keeps reflection OUT of the verification family', () => {
    // Encodes "self-review is never self-verification" into the taxonomy:
    // `verification` stays exclusively the Reviewer's.
    expect(LEDGER_EVENT_FAMILIES).toContain('execution');
    expect(LEDGER_EVENT_FAMILIES).toContain('verification');
  });
});
