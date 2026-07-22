# ADR-0004 — Shared-types schema encoding: TypeBox

**Status:** Accepted
**Date:** 2026-07-22
**Deciders:** Martin Hylleberg (with Claude as advisor)
**Context:** v0 planning. The contract + ledger event schemas are the shared-types foundation of the all-TS stack (ADR-0001) and the stable contract behind the Model Catalog and the Learning seam (ADR-0002).

## Context

The same schemas (task/mission contract, ledger event, evidence bundle, verdict, capability manifest) must serve **three** consumers at once:
1. **TypeScript compile-time types** shared across dashboard / API / worker / model-router;
2. **Runtime validation** — ledger appends, the model admission gate, contract intake;
3. **JSON Schema handed to LLMs** for structured-output / tool-calling, on both Qwen (local) and Claude.

Consumer #3 is the crux: ADR-0002's admission gate says "a model isn't chosen until it produces schema-valid output on the *real* schemas." Any translation step between the validated schema and the LLM-facing schema is a seam in the most-tested part of the system.

## Decision

Use **TypeBox** as the single source of truth for shared schemas: schemas *are* JSON Schema objects, TS types are inferred (`Static<typeof T>`), and validation uses ajv. One object is simultaneously the TS type, the runtime validator, and the JSON Schema constraint passed to the model — **zero translation** between what we validate and what we hand the LLM.

## Alternatives considered

- **Zod + `zod-to-json-schema`** — more ergonomic authoring and excellent runtime error messages, but the LLM-facing JSON Schema is *generated* from Zod, adding a translation step to round-trip-test on the hottest path. Acceptable fallback if authoring ergonomics ever dominate.
- **Hand-written TS interfaces + hand-maintained ajv JSON Schema** — rejected: dual maintenance is drift-prone and violates principle #3 (no arbitrary duplication).

## Consequences

- The `shared-types` package (built first, in phase P1) exports TypeBox schemas + inferred types + a thin ajv validator helper.
- The admission gate and ledger writer validate with the exact schema objects the Model Router hands to models — one schema, three uses.
- Authoring ergonomics are slightly lower than Zod; mitigated with small builder helpers if needed.
