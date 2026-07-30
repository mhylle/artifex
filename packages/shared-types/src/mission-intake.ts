/**
 * The mission intake request — the one shape a human hands the system.
 *
 * It lives here rather than in `packages/api` because it genuinely crosses a
 * boundary: the dashboard authors it and the control plane consumes it. That is
 * the test this package applies — shapes that cross a package boundary belong
 * here, internal shapes do not.
 *
 * Why a schema at all, when `MissionIntakeService` already refuses an empty
 * objective and an empty criteria list: those guards assume a *shape*, and
 * nothing enforced it. `@Body() body: IntakeRequest` types against a TypeScript
 * interface, which is erased at runtime — so a malformed body reached the
 * service and died as `Cannot read properties of undefined (reading 'length')`,
 * surfacing to the operator as an unexplained 500 (defect `fd345eae`).
 *
 * Validating with the same TypeBox object the rest of the system uses keeps
 * ADR-0004 intact: one object, one validator, no second validation dialect
 * imported just for the HTTP edge.
 */
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

import { AutonomyDialSchema, BlastRadiusSchema } from './common.js';

export const MissionIntakeRequestSchema = Type.Object(
  {
    objective: Type.String({ minLength: 1 }),
    /**
     * `minItems: 1` is the schema saying what intake says in prose: a mission
     * nobody can grade is not a mission. Blank-but-present strings are caught by
     * `minLength`, so "  " cannot masquerade as a criterion either.
     */
    successCriteria: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    outOfScope: Type.Array(Type.String({ minLength: 1 })),
    autonomyDial: AutonomyDialSchema,
    budget: Type.Object(
      {
        floor: Type.Number({ minimum: 0 }),
        ceiling: Type.Number({ minimum: 0 }),
        unit: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
    blastRadius: BlastRadiusSchema,
    requestedBy: Type.String({ minLength: 1 }),
  },
  {
    $id: 'MissionIntakeRequest',
    additionalProperties: false,
    description: 'A request to start a mission. Becomes task zero if accepted.',
  },
);

export type MissionIntakeRequest = Static<typeof MissionIntakeRequestSchema>;
