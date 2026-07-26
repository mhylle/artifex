# ADR-0008 — The admission gate tests meaning, not just shape

**Status:** Accepted
**Date:** 2026-07-26
**Deciders:** Martin Hylleberg (with Claude as advisor)
**Context:** P3 (Model Router & structured-output admission gate, R3), building the gate ADR-0002 requires.

## Context

[ADR-0002](ADR-0002-model-tiering-and-inference.md) makes the **admission gate** the only way a model enters the Model Catalog, and the catalog's `admitted` flag the only thing that makes a logical tier resolvable. The whole 4-tier ladder rests on that flag meaning something.

R3 states the gate as: *a candidate returning schema-invalid output on the admission set is refused; one returning schema-valid output passes.* Implemented literally, that gate **admitted every model tested** — including a 2B one.

The reason is structural, not a bug. Backends serve structured output by **constrained decoding**: the JSON-schema grammar is applied during token selection, so schema-valid output is near-certain *regardless of how capable the model is*. A shape-only gate therefore measures **whether the backend can constrain**, not whether the model can reason.

Measured directly. Asked for a Gate B verdict about one specific failed criterion, `qwen3.5:2b` returned:

```json
{ "outcome": "fail", "findings": [], "verificationDepth": "consistency", ... }
```

Schema-valid, and meaningless — a *failing* verdict that names nothing that failed. Under the literal reading of R3 it passes.

## Decision

**Every admission probe carries `semanticChecks`** — coherence assertions the schema cannot express — and a candidate is admitted only if it satisfies both the schema *and* those assertions.

The assertions that matter most are **conditional**, which is precisely why the schema cannot carry them: `minItems` cannot say "`findings` must be non-empty *only when* `outcome` is `fail`", because a passing verdict legitimately has none. Encoding it in the schema would make correct passing verdicts invalid.

Shipped probes:
- **verdict** — a failing verdict names at least one finding; the verdict answers the prompt (reports a failure).
- **capability-manifest** — a research specialist is granted some context (the schema permits an empty list, because some agents legitimately need none).

Effect on the same three candidates, same hardware, same run:

| Candidate | Shape-only | With semantic checks |
|---|---|---|
| `qwen3.5:2b` | admitted | **refused** — failing verdict with no findings |
| `qwen3.5:9b` | admitted | **refused** — manifest granted no context |
| `gemma4:12b` | admitted | admitted |

The gate only began discriminating once it tested meaning.

## Alternatives considered

- **Leave the gate shape-only, as R3 literally reads.** Rejected: it satisfies the acceptance criterion while making `admitted` carry no information, which silently undermines ADR-0002's tier ladder. Green tests measuring the wrong thing are worse than red ones.
- **Tighten the schemas instead** (e.g. `minItems: 1` on `findings`). Rejected: it would make legitimately passing verdicts invalid. The constraint is conditional; schemas of this kind express cardinality, not implication. It would also corrupt a shared contract to serve one consumer's test.
- **Score models by output quality (LLM-as-judge).** Rejected for v0: it makes admission non-deterministic and introduces a second model whose own admission is unestablished — turtles all the way down. Deterministic assertions first; a judged tier-up can come later if the ladder needs finer resolution.
- **Drop constrained decoding so the model must produce valid JSON unaided.** Rejected: constrained decoding is how the system will actually run in production, so testing without it would measure a configuration nobody uses.

## Consequences

- `AdmissionProbe` gains a required `semanticChecks` array. Adding a probe now means stating what a *coherent* answer looks like, not just a well-shaped one.
- Semantic checks must stay unambiguous — assertions about meaning, never style. A vague check makes admission arbitrary, which is the failure this ADR is correcting in the other direction.
- The gate is now sensitive to prompt wording, since a check like "the verdict answers the prompt" ties to what the probe asked. Probe prompts are part of the contract and should change deliberately.
- ADR-0002's named workhorse moves off Qwen2.5 to the Qwen3.5 / Gemma 4 generation (amendment noted there). No decision in ADR-0002 changes: models remain data.
- Two verification traps found alongside, both producing verdicts that look real and mean nothing — recorded as insights: `createOpenAICompatible` needs `supportsStructuredOutputs: true` or it silently drops the schema (every candidate then fails for a reason unrelated to the model), and the compose Ollama needs its GPU block enabled or a 9B candidate cannot finish two probes in ten minutes.

## Related

- R3 in Tasktracker; [ADR-0002](ADR-0002-model-tiering-and-inference.md) (the gate's authority), [ADR-0004](ADR-0004-schema-encoding.md) (the schemas probed are the ones the ledger validates with — no translation step).
- `packages/model-router/CLAUDE.md` carries the working guardrails.
