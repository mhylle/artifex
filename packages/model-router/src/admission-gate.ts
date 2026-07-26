/**
 * The structured-output admission gate (ADR-0002).
 *
 * A model enters the Model Catalog only after proving it can hold a *real*
 * Artifex schema — not a toy one. The distinction matters: nearly every model
 * can emit `{"answer": "..."}`, and almost none of that predicts whether it can
 * emit a `Verdict` with a closed error-class enum, a nested findings array and
 * no stray properties. The catalog's `admitted` flag is only meaningful because
 * this is what sets it.
 *
 * The probes are constrained by the exact schema objects the ledger validates
 * with — ADR-0004's no-translation rule means there is no seam here to drift.
 */
import {
  CapabilityManifestSchema,
  VerdictSchema,
  validate,
} from '@artifex/shared-types';
import type { ValidationError } from '@artifex/shared-types';
import type { TSchema } from '@sinclair/typebox';

/**
 * A coherence assertion the schema cannot express.
 *
 * These are not optional polish. Modern backends serve structured output by
 * *constrained decoding*: the grammar makes schema-valid output near-certain
 * regardless of how capable the model is. A gate that only validated shape would
 * therefore admit almost anything — measuring whether the backend can constrain,
 * not whether the model can reason. Observed directly: a 2B candidate emitted a
 * perfectly valid Verdict with `outcome: "fail"` and an empty `findings` array —
 * a failing verdict naming nothing that failed.
 */
export interface SemanticCheck {
  readonly name: string;
  /** True when the output is coherent. */
  readonly holds: (value: unknown) => boolean;
}

export interface AdmissionProbe {
  readonly name: string;
  /** A published shared schema — handed to the model verbatim. */
  readonly schema: TSchema;
  readonly prompt: string;
  /** What a passing response looks like; used to exercise the gate itself. */
  readonly sample: () => unknown;
  readonly semanticChecks: readonly SemanticCheck[];
}

export interface StructuredOutputBackend {
  generate(args: {
    readonly provider: string;
    readonly model: string;
    readonly probe: AdmissionProbe;
  }): Promise<unknown>;
}

export interface AdmissionFailure {
  readonly probe: string;
  readonly errors: ValidationError[];
}

export interface AdmissionResult {
  readonly candidate: { readonly provider: string; readonly model: string };
  readonly admitted: boolean;
  readonly failures: AdmissionFailure[];
}

const AT = '2026-07-26T09:00:00.000Z';
const UUID_A = '3f1c2a54-0d6b-4f2e-9a71-8c5d0e2b7a13';
const UUID_B = 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39';
const UUID_C = '7b2d9e10-4c58-4a3f-b6e2-1f8c0d5a9b47';

/**
 * The admission set. Two schemas from different corners of the vocabulary:
 * `Verdict` exercises closed enums plus a nested array of objects, and
 * `CapabilityManifest` exercises a `minItems` constraint and an integer bound.
 * A model that satisfies both can be trusted with the rest.
 */
export const ADMISSION_PROBES: readonly AdmissionProbe[] = [
  {
    name: 'verdict',
    schema: VerdictSchema,
    prompt:
      'A reviewer checked a task and found that one acceptance criterion failed: a factual ' +
      'claim carried no citation. Emit the Gate B verdict as JSON matching the schema exactly.',
    sample: () => ({
      verdictId: UUID_A,
      taskId: UUID_B,
      gate: 'B',
      outcome: 'fail',
      reviewerId: UUID_C,
      verificationDepth: 'single',
      findings: [
        {
          criterionId: 'ac-2',
          errorClass: 'verification_failure',
          failingStep: 'Citation check',
          detail: 'The claim carries no resolvable citation.',
        },
      ],
      redFlags: [],
      issuedAt: AT,
    }),
    semanticChecks: [
      {
        // The one assertion the schema genuinely cannot make: a verdict that
        // fails must say what failed. `findings` is legitimately empty on a
        // pass, so `minItems` would be wrong — the constraint is conditional.
        name: 'a failing verdict names at least one finding',
        holds: (value) => {
          const verdict = value as { outcome?: unknown; findings?: unknown };
          if (verdict.outcome !== 'fail') return true;
          return Array.isArray(verdict.findings) && verdict.findings.length > 0;
        },
      },
      {
        name: 'the verdict answers the prompt — it reports a failure',
        holds: (value) => (value as { outcome?: unknown }).outcome === 'fail',
      },
    ],
  },
  {
    name: 'capability-manifest',
    schema: CapabilityManifestSchema,
    prompt:
      'Design a specialist that answers one research sub-question from entitled sources and ' +
      'cites everything. Emit its capability manifest as JSON matching the schema exactly.',
    sample: () => ({
      manifestId: UUID_A,
      designId: UUID_B,
      version: 1,
      category: 'research.sub-question',
      roleInstructions: 'Answer exactly one sub-question from entitled sources; cite everything.',
      capabilities: ['web.search', 'text.summarize'],
      contextEntitlements: ['mission-brief'],
      logicalTier: 1,
      validationHarness: { checks: ['Every claim has a citation.'] },
      createdAt: AT,
    }),
    semanticChecks: [
      {
        // A specialist that may request nothing cannot do research. The schema
        // permits an empty list because some agents legitimately need no context.
        name: 'a research specialist is granted some context',
        holds: (value) => {
          const manifest = value as { contextEntitlements?: unknown };
          return Array.isArray(manifest.contextEntitlements) && manifest.contextEntitlements.length > 0;
        },
      },
    ],
  },
];

/**
 * Run a candidate model against the admission set.
 *
 * A probe that *throws* counts as a failure, not as an absence of failures — a
 * crashed or unreachable backend must never read as "nothing went wrong", which
 * would admit a model nobody ever successfully tested.
 */
export async function runAdmissionGate(options: {
  readonly candidate: { readonly provider: string; readonly model: string };
  readonly probes: readonly AdmissionProbe[];
  readonly backend: StructuredOutputBackend;
}): Promise<AdmissionResult> {
  const { candidate, probes, backend } = options;
  const failures: AdmissionFailure[] = [];

  for (const probe of probes) {
    let output: unknown;
    try {
      output = await backend.generate({ ...candidate, probe });
    } catch (error) {
      failures.push({
        probe: probe.name,
        errors: [
          {
            path: '/',
            message: `${probe.name}: backend failed — ${
              error instanceof Error ? error.message : String(error)
            }`,
            keyword: 'backend',
          },
        ],
      });
      continue;
    }

    const result = validate(probe.schema, output);
    if (!result.ok) {
      failures.push({ probe: probe.name, errors: result.errors });
      continue;
    }

    // Shape passed. Now ask whether the content means anything — see SemanticCheck.
    const incoherent = probe.semanticChecks
      .filter((check) => !check.holds(output))
      .map((check) => ({
        path: '/',
        message: `${probe.name}: schema-valid but incoherent — ${check.name}`,
        keyword: 'semantic',
      }));

    if (incoherent.length > 0) {
      failures.push({ probe: probe.name, errors: incoherent });
    }
  }

  return { candidate, admitted: failures.length === 0, failures };
}
