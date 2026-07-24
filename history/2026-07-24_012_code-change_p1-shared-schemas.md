# 012 — P1: shared contract & ledger schemas (TypeBox)

**Date:** 2026-07-24
**Category:** code-change
**Phase:** P1 (Tasktracker `b5a1d118-…`) · **Requirement:** R1 (now `satisfied`)

**What:** Built `@artifex/shared-types` for real — the five TypeBox schemas the whole system depends on, plus the ajv validation core. First *business-meaningful* code in the repo (P0 was scaffolding).

**Why:** R1 / ADR-0004. The schemas are the foundation everything else feeds: P2's ledger writes them, P3's admission gate constrains models with them, P5–P8's meta-agents exchange them. Built first, per the brainstorm mandate.

**Details:**
- **One object, three uses (ADR-0004).** Each schema is simultaneously the TS type (`Static<>` only — zero hand-written parallel interfaces), the ajv runtime validator, and the JSON Schema handed to LLMs. `toJsonSchema()` returns *the schema object itself* — referential identity, asserted in a test, so there is provably no translation seam.
- **The five schemas**, modelled from the dossier rather than invented:
  - `TaskContract` — the full "anatomy of a task contract" (lineage · objective · acceptance criteria · boundaries/anti-scope · inputs + pinned decisions · dependencies · stopping conditions · effort budget · escalation policy · verification plan · blast radius · autonomy dial). The dossier's "nothing here is ceremony" is why the field set is broad.
  - `LedgerEvent` — split into `LedgerEventInput` (what an appender submits) and the recorded event (adds monotonic `seq` + `recordedAt`), sharing one property bag so they cannot drift. The 8 audit families come from the dossier's event taxonomy.
  - `EvidenceBundle` — deliverable + what it did / consulted / assumed; each consulted source names its Context Broker grant (no peer chatter).
  - `Verdict` — Gate A/B, per-finding `criterionId` + `errorClass` + failing step, plus red flags and the depth actually run.
  - `CapabilityManifest` — role instructions, entitlements, `logicalTier` (never a concrete model — the catalog resolves it), and a validation harness whose `checks` may not be empty ("a design without a harness cannot earn permanence, by rule").
- **Model-facing quality:** every object is `additionalProperties: false` (structured-output backends need closed objects), and closed vocabularies render as `{type:'string', enum:[…]}` via a `StringEnum` helper rather than TypeBox's default `anyOf`/`const`, which several backends handle worse.
- **Validation core:** path-specific errors by construction — ajv reports `required`/`additionalProperties` against the *parent*, so the field name from `params` is folded into the JSON Pointer (`/acceptanceCriteria`, `/acceptanceCriteria/0/statement`). Compiled validators cached per schema object.
- **Typecheck gap closed:** the build config excludes tests/fixtures, which left them checked by nothing (vitest transpiles without typechecking). Added `tsconfig.spec.json`; `typecheck` now runs both. Verified it bites by injecting deliberate drift (`blastRadius: 'catastrophic'` → rejected), then reverting.

**Outcome:** TDD honoured — AC tests written and observed RED, then GREEN. 34 shared-types tests (contract AC-0 + 3 distractors; round-trip AC-1 across all six exported schemas × 5 assertions, including a distractor that drops **every** required field in turn and one that rejects unknown fields). Full sweep green: 40 unit tests across 5 workspaces + integration harness 3/3. Dogfooded the built package from `packages/worker` — cross-package import, closed serialized JSON Schema, path-specific rejection, typed throw. Both R1 acceptance criteria accepted; R1 → `satisfied`. Two footguns logged as insights (npm-workspace dedupe pinning ajv 6; ESM→CJS interop for ajv/ajv-formats).
