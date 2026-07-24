/**
 * The runtime half of ADR-0004: ajv validation over the *same* schema objects
 * that are handed to models for structured output. There is no translation
 * step here, and there must never be one — see {@link toJsonSchema}.
 */
import type { Static, TSchema } from '@sinclair/typebox';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { AnySchemaObject, ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

/** A single validation failure, anchored to the exact offending path. */
export interface ValidationError {
  /** JSON Pointer to the offending value, e.g. `/acceptanceCriteria/0/statement`. */
  path: string;
  /** Human-readable message that always names the offending field. */
  message: string;
  /** The ajv keyword that failed, e.g. `required`, `minItems`. */
  keyword: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] };

/** Raised by {@link assertValid}. Carries the path-specific errors. */
export class SchemaValidationError extends Error {
  readonly errors: ValidationError[];

  constructor(errors: ValidationError[]) {
    super(`schema validation failed: ${errors.map((e) => e.message).join('; ')}`);
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });

// ajv-formats is CJS and sets both `module.exports` and `.default` to the
// plugin; under NodeNext the default import resolves to the module namespace,
// so the callable is reached through `.default`.
addFormatsModule.default(ajv);

// Compiled validators are cached per schema object — compiling is the expensive
// part, and the schema objects are module-level singletons.
const compiled = new WeakMap<TSchema, ValidateFunction>();

function validatorFor(schema: TSchema): ValidateFunction {
  const cached = compiled.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  const validator = ajv.compile(schema as AnySchemaObject);
  compiled.set(schema, validator);
  return validator;
}

function pointerFor(error: ErrorObject): string {
  const params = error.params as { missingProperty?: string; additionalProperty?: string };
  // ajv reports `required` and `additionalProperties` against the *parent*
  // object, so the field name lives in params. Fold it into the path to keep
  // every error addressable.
  const field = params.missingProperty ?? params.additionalProperty;
  const path = field === undefined ? error.instancePath : `${error.instancePath}/${field}`;
  return path === '' ? '/' : path;
}

function toValidationError(error: ErrorObject): ValidationError {
  const params = error.params as { missingProperty?: string; additionalProperty?: string };
  const path = pointerFor(error);

  if (params.missingProperty !== undefined) {
    return {
      path,
      message: `${path}: missing required property '${params.missingProperty}'`,
      keyword: error.keyword,
    };
  }
  if (params.additionalProperty !== undefined) {
    return {
      path,
      message: `${path}: unexpected property '${params.additionalProperty}'`,
      keyword: error.keyword,
    };
  }
  return {
    path,
    message: `${path}: ${error.message ?? 'is invalid'}`,
    keyword: error.keyword,
  };
}

/**
 * Validate `data` against a shared schema.
 *
 * Errors are path-specific by construction: a missing required field is
 * reported at the field's own pointer, not at the enclosing object.
 */
export function validate<S extends TSchema>(schema: S, data: unknown): ValidationResult<Static<S>> {
  const validator = validatorFor(schema);
  if (validator(data)) {
    return { ok: true, value: data as Static<S> };
  }
  return { ok: false, errors: (validator.errors ?? []).map(toValidationError) };
}

/** Validate and return the typed value, throwing {@link SchemaValidationError} on failure. */
export function assertValid<S extends TSchema>(schema: S, data: unknown): Static<S> {
  const result = validate(schema, data);
  if (!result.ok) {
    throw new SchemaValidationError(result.errors);
  }
  return result.value;
}

/**
 * The JSON Schema to hand a model for structured output / tool-calling.
 *
 * This returns the schema object *itself*, not a conversion of it — a TypeBox
 * schema already is JSON Schema. That identity is the whole point of ADR-0004:
 * the model admission gate must be constrained by the exact object the ledger
 * writer validates with, so there is no seam to drift.
 */
export function toJsonSchema<S extends TSchema>(schema: S): S {
  return schema;
}
