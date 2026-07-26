# ADR-0007 — R12/R13 sequencing and the shared contract surface

**Status:** Accepted
**Date:** 2026-07-26
**Deciders:** Martin Hylleberg (with Claude as advisor)
**Context:** [ADR-0006](ADR-0006-agentic-patterns.md) adopted the four agentic patterns and left one question open. The owner has now answered it and approved R12 and R13.

## Context

ADR-0006 ended with: *"Does R13 (tool use) enter the v0 slice, or the roadmap?"* The owner's answer is **v0** — both R12 (reflection) and R13 (Action Broker) are approved.

That creates a sequencing problem. The runtime halves of both requirements live inside the Worker Swarm (P8) and the mission loop (P9), neither of which exists — but their **schemas** live in `shared-types`, which shipped in P1 and which P3 onward will build against.

**The evidence that settles it:** `EvidenceBundle` is referenced in exactly four files, *all inside `packages/shared-types`* (`evidence-bundle.ts`, `index.ts`, `__fixtures__/samples.ts`, `round-trip.test.ts`). There are **zero consumers** in `worker`, `api`, `memory-fabric` or `model-router` today. Turning `actions` from prose into structured records is a contained edit **now**; after P5–P8 it is a breaking refactor across the meta-agents.

Two further facts shaped the decision:
- **No database migration is needed.** `memory-fabric/migrations/0001_memory_fabric.js` deliberately carries no `CHECK` on `family` — the vocabulary lives in the TypeBox schema (ADR-0004/0005). Widening the family list is a pure `shared-types` change.
- **P3 is affected.** `shared-types/src/index.ts` already states its schemas serve "structured output / **tool-calling**", and `model-router/CLAUDE.md` requires the admission gate run against the *real* schemas. Settling the tool contract first is what makes P3's gate test the right surface.

## Decision

**Split each requirement at the contract/runtime seam.** One phase lands the shared-types surface for both, before P3, in a single breaking-change window. Two later phases land the runtime, after P8.

| Phase | Objective | Position | Requirement |
|---|---|---|---|
| **P2.5** | R12/R13 contract surface (`shared-types` only) | before P3 | R12 + R13 |
| **P8.5** | Action Broker (mediated tool use) | after P8 | R13 |
| **P8.6** | Worker self-critique pass | after P8.5 | R12 |

**The Action Broker precedes reflection deliberately.** A reflection pass that finds a missing citation should be able to *re-search* to repair it. Building reflection first produces a pass that cannot act, then reworks it once the broker exists; the reverse order costs nothing.

### Shape decisions

**D1 — The tool grant lives on `TaskContract.inputs.toolEntitlements` only.** R13 makes the contract "the sole authority on what a task may do". *Rejected:* mirroring it onto `CapabilityManifest` as `contextEntitlements` is mirrored — it would create a second authority over the same question; *rejected:* prefix-encoding tools into the existing `inputs.entitlements`, which ADR-0006 explicitly refuses (context and action are different channels).

**D2 — Tool risk vocabulary is `['read', 'compute', 'write']`.** ADR-0006 names exactly three kinds — search, code execution, APIs. *Rejected:* `['read','write']` collapses code execution into whichever neighbour you pick, over-restricting it or misdescribing it; *rejected:* a network/filesystem/shell taxonomy, over-built for v0.

**D3 — Add `'action'` to `LEDGER_EVENT_FAMILIES`; reflection stays in `'execution'`.** The ledger comment demands events be "structured for querying, not archaeology", and R13 AC-0 requires replay to reproduce the full action set — a family lookup, not a string-prefix scan over `type`. Free, since there is no DB `CHECK`. *Rejected:* reusing `execution` with an `action.*` type prefix. Keeping **reflection** in `execution` is equally deliberate: an action is a side effect on the world with its own governance, a reflection is an internal execution step — and it keeps the `verification` family exclusively the Reviewer's, which encodes "self-review is never self-verification" into the taxonomy itself.

**D4 — R12 AC-0 ("both versions recoverable") is satisfied by a hybrid.** The pre-reflection draft is appended to the ledger; `EvidenceBundle.reflection` carries `priorDraftEventId` plus the critique. Same pointer discipline as the P2 NOTIFY payload. *Rejected:* carrying both full deliverables in the bundle (duplication and bloat); *rejected:* ledger-only with no pointer, leaving the Reviewer and Learning Agent unable to correlate.

**D5 — No separate reflection budget.** This resolves the open question R12 itself flagged. Reflection spends the task contract's **existing** `budget`; its cost is *attributed* via `ReflectionRecord.effortSpent` and its own ledger event. AC-3 says "charged against **the contract's** effort budget" — the existing one. A second ceiling would be inventing a cap, which the standing "no arbitrary caps" principle forbids. Measurability comes from attribution, not from a limit. *Rejected:* a `reflectionBudget` contract field; *rejected:* deriving it from `blastRadius`, which would have the worker authoring its own budget against invariant #2.

**D6 — The withheld verification plan becomes a schema guarantee.** Introduce `WorkerContractViewSchema = Type.Omit(TaskContractSchema, ['verificationPlan'])` with `additionalProperties: false`, so a view carrying `verificationPlan` **fails validation**. This strengthens the current stance — `contract.ts:113` says the withholding is "enforced where the Context Broker serves contracts, not by this schema" — and turns R12 AC-2's "assert absence" from a convention into a guarantee. **Implementation gotcha:** the omitted schema needs its own `$id`; `validation.ts` compiles against one module-level ajv instance and a duplicate `$id: 'TaskContract'` throws (the P1 lesson).

**D7 — Decimal phase numbering (P2.5 / P8.5 / P8.6).** ADR-0003 froze "14 phases (P0–P13)" and P-numbers appear across 16 markdown files including six dated `history/` entries. *Rejected:* renumbering P3→P4 onward, which would invalidate ADR-0003 and falsify the history record; *rejected:* appending as P14–P16, since this project uses no task dependencies and ordering is positional — out-of-order titles would mislead.

### Governance tables (implemented in P8.5, recorded here)

**`blastRadius` bounds the admissible risk class.** The rule is that *a declared blast radius must cover the tools used* — a `write` action creates consequence, so performing one under a `low` declaration would make a task's real blast radius exceed its declared one, invalidating the verification depth and model tier already assigned to it.

| `blastRadius` | Admissible risk classes |
|---|---|
| `low` | `read` |
| `medium` | `read`, `compute` |
| `high` | `read`, `compute`, `write` |

**`autonomyDial` decides what needs a human first.**

| `autonomyDial` | Requires ratification |
|---|---|
| `autonomous` | nothing |
| `checkpointed` | `write` |
| `supervised` | `write`, `compute` |

These are stated policy functions defined in one place — policy, not caps.

## Consequences

- One breaking-change window on `EvidenceBundle`, taken while it is free. After P2.5, `actions` is structured and `reflection` is present-and-nullable.
- `WorkerContractView` becomes the type the Context Broker must serve to workers — a P8 obligation created here.
- Widening `LEDGER_EVENT_FAMILIES` is safe for `memory-fabric` (it imports the union; no DDL copy exists to drift).
- **Open defect `8a6ee598`** (ledger `seq` assigned before commit; a concurrent `readSince` consumer can skip a late-committing event) becomes *reachable* at P8.5, when workers first append actions concurrently. It stays tracked as its own defect and must not be papered over inside the broker.
- Security remains deferred (ADR-0006 did not lift it). P8.5's obligation is only that every invocation funnels through one method, so sandboxing and credential handling can land later without redesign.

## Related

- [ADR-0006](ADR-0006-agentic-patterns.md) (adoption; this ADR answers its open question), [ADR-0003](ADR-0003-v0-slice-scope.md) (the frozen phase list this extends by decimal insertion), [ADR-0004](ADR-0004-schema-encoding.md) (one object = type + validator + LLM schema), [ADR-0005](ADR-0005-memory-fabric-package.md) (why no `CHECK` on `family`).
- Requirements R12 (`e5e42370`) and R13 (`1a5de151`), both `approved`.
