---
name: artifex-schemas
description: TypeBox schema conventions for Artifex's shared-types. Use when creating or editing schemas/types in packages/shared-types/** — the contract, ledger event, evidence bundle, verdict, or capability-manifest schemas — or anywhere a schema is handed to an LLM for structured output. Triggers on "schema", "TypeBox", "contract type", "ledger event type", "JSON schema", "structured output", "validate contract".
---

# Artifex schema conventions (ADR-0004)

The shared schemas are **one object serving three uses**: the TypeScript type, the runtime ajv validator, and the JSON Schema handed to LLMs. Keep them that way.

- **Source of truth is the TypeBox schema.** Derive the type with `Static<typeof T>`. Never hand-write a parallel `interface` — that's the drift this design forbids (principle #3).
- **Export a JSON-Schema accessor** for the model admission gate; the schema you validate with is the exact schema you hand the model.
- Validation errors must be **path-specific** (name the offending field).
- Runtime deps: `@sinclair/typebox` + `ajv` only, installed via `npm install`.
- Tests: a schema-valid object round-trips; a schema missing a required field **fails** the round-trip (always write that distractor).

`shared-types` is the dependency-graph leaf — it imports from no other workspace package.
