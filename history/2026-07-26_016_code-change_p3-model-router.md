# 016 — P3: Model Router & the admission gate that actually tests capability

**Date:** 2026-07-26
**Category:** code-change
**Phase:** P3 (Tasktracker `dfce4456-…`) · **Requirement:** R3
**ADRs:** [ADR-0008](../docs/decisions/ADR-0008-admission-gate-semantic-probes.md) (new) · [ADR-0002](../docs/decisions/ADR-0002-model-tiering-and-inference.md) (amended)

**What:** Built the provider-neutral Model Router and the structured-output admission gate, dispatching via the Vercel AI SDK to Claude and OpenAI-compatible local endpoints.

**Why:** R3. The catalog's `admitted` flag is the only thing that makes a logical tier resolvable, so the gate that sets it is what the whole 4-tier ladder rests on.

**Details:**
- **The gate as R3 literally specifies it did not work.** Implemented as "schema-valid passes", it **admitted every model tested, including a 2B one**. The cause is structural: backends serve structured output by *constrained decoding*, so the grammar makes schema-valid output near-certain regardless of capability. A shape-only gate measures whether the backend can constrain, not whether the model can reason. Caught by inspecting real output — `qwen3.5:2b` returned a valid `Verdict` with `outcome: "fail"` and `findings: []`, a failing verdict naming nothing that failed. Fixed with `semanticChecks` on every probe (ADR-0008); the assertions that matter are *conditional*, which is exactly why a schema cannot carry them — `minItems` cannot say "non-empty only when outcome is fail" without invalidating correct passing verdicts.
- **An earlier run had failed in the opposite direction, and looked just as real.** `createOpenAICompatible` silently drops the json_schema response format unless `supportsStructuredOutputs: true` is set — warning only. Every candidate was refused for a reason that had nothing to do with the model: a false negative indistinguishable from a true one. Both traps are logged as insights; the constrained-decoding one is GLOBAL, since it applies to any project validating LLM structured output.
- **Result after both fixes:** `qwen3.5:2b` refused (failing verdict names no finding), `qwen3.5:9b` refused (manifest grants no context), `gemma4:12b` admitted. The gate discriminates.
- **Catalog access is a structural `CatalogResolver` returning `null` for absence**, not an import of `memory-fabric` and not an error-class contract. A rejection means the catalog itself failed — so a database outage cannot masquerade as "no Tier-2 model, fall back to Claude", which would be precisely the silent default ADR-0002 forbids.
- **The Tier-2 fallback reports itself.** `ResolvedModel.fallback` names the tier it came from and why; an unreported substitution is indistinguishable from a silent default, and the cost gap between a local model and a frontier one is exactly what the budget ledger must see.
- **Enabled the docker-compose GPU block.** P0 shipped it commented out ("CPU-only works for scaffold/dev"), which held only while nothing ran a model. On CPU a 9B candidate did not finish two probes in ten minutes; on GPU (RTX 3090, ~188 tok/s) the full three-model run takes ~160s. The NVIDIA Container Toolkit was already installed — the check needs `--entrypoint nvidia-smi`, since the ollama image otherwise reports `unknown command` and looks like a missing toolkit.
- **Models moved a generation.** The owner asked for Qwen 3.5 and Gemma 4; an initial probe of guessed *size* tags wrongly concluded the *families* did not exist. They do — `qwen3.5:{2b,4b,9b}` and `gemma4:{12b,latest}`. ADR-0002 carries an amendment note: no decision changes, since models were always meant to be data.

**Outcome:** TDD red→green. 13 model-router tests, **84 repo-wide**, 20 integration, build + typecheck clean — including a new `packages/model-router/tsconfig.spec.json`, closing a P0 loose end. **Caveat recorded on R3 AC-3:** the Tier-2→Claude fallback is verified at the *resolution* level; a live dispatch to the Claude API was not exercised (no API key in this environment), so end-to-end Claude dispatch remains unproven.
