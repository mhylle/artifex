# packages/model-router — CLAUDE.md

Provider-neutral dispatch (ADR-0001/0002). Given a `{provider, model, params}` it calls **Claude** or an **OpenAI-compatible local endpoint** (Ollama/vLLM). A versioned **Model Catalog** resolves a *logical tier* → concrete model.

## Guardrails (do not break)

- **The router is the spine; the Claude Agent SDK is just one backend behind it.** Never make Claude the hard dependency the runtime binds to.
- **A missing catalog tier entry is a typed error — never a silent default** to some arbitrary model.
- **A model enters the catalog only after passing the structured-output admission gate** on the *real* `shared-types` schemas (not a toy schema). See `artifex-schemas`.
- **Tier is data, not code** — models live in the catalog (swappable), never hardcoded per agent (principle #3).
- **Tier-2 fallback:** the local ~32B candidate is *attempted*; if it fails the admission gate, logical Tier-2 resolves to **Claude** (ADR-0003). This must be explicit and logged, not silent.

## Tests (see R3)

- logicalTier=1 → dispatches to the catalogued Ollama entry with its declared params.
- admission gate refuses a schema-invalid model; accepts a valid one (distractor).
- Tier-2 with no gate-passing local model → falls back to Claude; a missing entry raises a typed error.

## The gate must test meaning, not just shape

Backends serve structured output by **constrained decoding**, so schema-valid output is near-certain *regardless of model capability*. A shape-only gate measures whether the backend can constrain, not whether the model can reason — it admits almost anything. Every probe therefore carries `semanticChecks`: coherence assertions the schema cannot express, especially conditional ones (`minItems` cannot say "findings must be non-empty *only when* outcome is fail").

Measured: with shape-only checks all three local candidates were admitted; with semantic checks the same run refused a 2B and a 9B and admitted a 12B.

Two traps, both of which produce verdicts that look real and mean nothing:
- `createOpenAICompatible` needs **`supportsStructuredOutputs: true`**, or it silently drops the json_schema format (warning only) and every candidate fails for a reason unrelated to the model.
- The compose Ollama needs the GPU block in `docker-compose.yml`; on CPU a 9B candidate does not finish two probes in ten minutes.

Consult the `claude-api` skill before touching the Claude backend.
