# packages/shared-types — CLAUDE.md

**The foundation everything depends on.** TypeBox schemas for the task/mission **contract**, **ledger event**, **evidence bundle**, **verdict**, and **capability manifest**. This is the leaf of the dependency graph — it imports from no other workspace package.

## The one rule that defines this package (ADR-0004)

Every schema is **one object serving three uses at once**:
1. the **TypeScript type** — derive via `Static<typeof T>`, never hand-write a parallel `interface`;
2. the **runtime validator** — ajv over the same schema;
3. the **JSON Schema handed to LLMs** for structured output / tool-calling.

There is **no translation step** between what we validate and what we hand a model. If you find yourself maintaining a second copy of a shape, stop — that's the drift this package exists to prevent (principle #3).

## Conventions

- Export both the schema (`XSchema`) and its inferred type (`type X = Static<typeof XSchema>`).
- Export a JSON Schema accessor for the admission gate (`toJsonSchema(XSchema)`).
- Runtime deps limited to `@sinclair/typebox` + `ajv` (install via `npm install`, never hand-edit package.json).
- No side effects, no I/O — pure schema + validation helpers.

## Tests (TDD, from the ACs — see R1)

- Validation errors are **path-specific** (name the missing/invalid field).
- JSON-Schema **round-trip**: a schema-valid object passes ajv; a schema that drops a required field **fails** the round-trip (write that distractor).
