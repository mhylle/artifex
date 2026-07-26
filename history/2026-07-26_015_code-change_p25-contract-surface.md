# 015 — P2.5: the R12/R13 contract surface (reflection + tool use, schemas only)

**Date:** 2026-07-26
**Category:** code-change
**Phase:** P2.5 (Tasktracker `94e553c6-…`) · **Requirements:** R12 + R13 (both `approved`, both `partially_implements` — deliberately NOT satisfied)
**ADR:** [ADR-0007](../docs/decisions/ADR-0007-r12-r13-sequencing-and-contract-surface.md)

**What:** Landed the `shared-types` contract surface for reflection (R12) and tool use (R13) in one breaking-change window, sequenced *before* P3. Schemas only — no Action Broker, no self-critique pass.

**Why:** The owner approved both requirements into v0, answering ADR-0006's open question. The runtime halves live in the Worker Swarm (P8) and the mission loop (P9), neither of which exists — but the schemas are consumed from P3 onward. `EvidenceBundle` had **zero consumers outside `packages/shared-types`** (verified by search: 4 files, all in that package), so restructuring it now was a contained edit; after P5–P8 it would have been a breaking refactor across the meta-agents. P3 also depends on this: `model-router/CLAUDE.md` requires the admission gate run against the *real* schemas, and `index.ts` already declared they serve "structured output / tool-calling".

**Details:**
- **Two guarantees moved out of prose and into the schema.** `WorkerContractView = Type.Omit(TaskContract, ['verificationPlan'])` with `additionalProperties: false` — a view still carrying the verification plan now *fails validation*, where `contract.ts` previously left withholding to whoever served the contract. And `ReflectionRecord` declares no `gate`, `outcome` or `verdictId`; being closed, it cannot acquire them at runtime either. Reflection is structurally incapable of being mistaken for a verdict, which is what lets self-critique coexist with constitutional review independence.
- **`ActionRecord.viaBrokerGrantId` is non-nullable, and that asymmetry with `ConsultedSource` is the point.** Context can be granted inline by the contract; an action cannot. An unmediated tool call would be an unlogged side effect, and the ledger must be the complete record (invariant #1).
- **Tool grants live on the contract and only there** (D1) — not mirrored onto `CapabilityManifest`, which would create a second authority over the same question, and not folded into `inputs.entitlements`, which ADR-0006 refuses because knowing and doing are different channels.
- **`action` became its own ledger family** (D3), not an `action.*` prefix under `execution`, so "reproduce every action this mission took" is a family lookup rather than a string scan. Reflection deliberately stays under `execution` — which keeps `verification` exclusively the Reviewer's and puts "self-review is never self-verification" into the taxonomy itself. Free to add: migration 0001 carries no `CHECK` on `family` by design.
- **`EvidenceBundle.actions` lost its `minItems: 1`** when it went structured — a task that only reasons legitimately takes no actions, and an empty list is an honest record where the old free-text field forced a narrative.
- **Resolved R12's own flagged open question** (D5): no separate reflection budget. It spends the contract's existing budget and its cost is *attributed* via `ReflectionRecord.effortSpent` plus a ledger event. A second ceiling would have been inventing a cap.
- Added actor kind `action_broker` so P8.5's events are attributable without widening the vocabulary later.

**Outcome:** TDD honoured — RED observed (missing `./reflection.js`, 39 pre-existing tests still green), then GREEN. **66 shared-types tests, up from 39**; 72 repo-wide; 20 integration; build + typecheck clean across all six workspaces. Dogfooded against the real compose Postgres through the *built* package: 14/14 checks, including appending and replaying a genuine `family='action'` event. **Mutation-verified** — neutering `Type.Omit` failed exactly the four withholding tests and left 62 passing, including the distractor written specifically to catch "Omit was a no-op". R12/R13 remain `approved`, not `satisfied`: their ACs need P8.5/P8.6.
