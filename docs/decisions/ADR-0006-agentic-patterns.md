# ADR-0006 — Adopt the four agentic patterns as named principles

**Status:** Accepted
**Date:** 2026-07-26
**Deciders:** Martin Hylleberg (with Claude as advisor)
**Context:** Owner asked to merge four widely-held agentic-design patterns into Artifex — reflection, tool use, planning, and multi-agent collaboration.

## Context

The four patterns, as stated:

1. **Reflection** — make the agent critique its own output, find problems, rewrite. One loop of self-review beats a smarter model with no review.
2. **Tool use** — don't just think, act. Give the agent search, code execution, APIs. Thinking without tools is guessing.
3. **Planning** — break complex tasks into steps before executing. Agents that plan first solve what agents that rush can't.
4. **Multi-agent collaboration** — don't run one agent, run a team: one writes, another critiques, another tests.

Artifex is a graph of self-improving agents, so the question is not whether these belong — it is **which ones the design already carries, and which are genuinely missing.** Adopting all four as if they were new would misrepresent the design and, worse, invite a "reflection feature" that quietly re-implements the Reviewer.

An audit against the frozen functional design (`solution/`), `ARCHITECTURE.md`, and the shipped P1 schemas found **two already core, one partial, one absent**:

| Pattern | Status | Evidence |
|---|---|---|
| **Planning** | **Already core, and exceeded** | Orchestrator recursive decomposition; invariant #2 "no work without a contract"; the plan is a typed artifact (`TaskContractSchema`); **Gate A verifies the plan itself before any execution** |
| **Multi-agent** | **Already the premise** | Four meta-agents + ephemeral Worker Swarm; Reviewer is a separate agent, not a worker mode; review independence is constitutional (invariant #4) |
| **Reflection** | **Partial — real gap** | External review (Gate A/B) and inter-mission learning exist. **No self-critique before submission**: a worker's `EvidenceBundle` goes straight to the Reviewer, and rung 1 (`retry_same`) only fires *after* a paid-for Gate B rejection |
| **Tool use** | **Absent — real gap** | `inputs.entitlements` and `CapabilityManifest.contextEntitlements` grant **context**; the Context Broker is explicitly "the sole **context** channel". `EvidenceBundle.actions` is `Type.Array(TextSchema)` — prose *about* what was done. Agents can reason and consult; they cannot act |

## Decision

**Adopt all four as named principles** in the Tasktracker principle set and in `ARCHITECTURE.md`, and record the two gaps as requirements rather than leaving them as aspirations.

- Patterns **3 and 4** are recorded as *descriptive* — naming properties the system already has, so they stay non-negotiable rather than incidental, and so future changes can be tested against them.
- Pattern **1** becomes **R12 — Worker self-critique pass**, bounded so that reflection can never become self-verification.
- Pattern **2** becomes **R13 — Action Broker**, structured as a sibling of the Context Broker.

Both requirements are created as **`draft`**. They are recorded in full; whether they enter the v0 slice or the roadmap is a scope decision for the owner (see *Open question*).

### Why reflection is budget-rational, not just good practice

Gate B commonly runs at a **higher tier** than the worker it reviews (Tier-2/3 semantic review over Tier-1 bulk execution). Paying a Tier-2 rejection *plus* an escalation rung to catch a defect that a same-tier self-pass would have caught is a bad trade under **invariant #7, "effort is a currency."** Reflection is justified by Artifex's own fitness function — value-per-effort — not by appeal to outside practice.

### The constraints that keep reflection legal

1. **Self-review is not self-verification.** The pass improves the deliverable; it emits no `Verdict`, and no task skips Gate B. Invariants #3 and #4 are untouched.
2. **Critique against acceptance criteria, never the verification plan.** `VerificationPlanSchema` is deliberately withheld from the executing worker ("never shown … in gameable detail"). Reflecting against it would convert self-review into teaching an agent to game its own grader — the exact failure the withholding exists to prevent.
3. **Budgeted and logged** like any other effort, so the Learning Agent can measure whether reflection actually pays.

### Why tool use must be a broker, not a library

An unmediated tool call is an **unlogged side effect**, which breaks invariant #1 — the ledger is the complete record of what happened, and the dashboard renders from it alone. Therefore agent code never reaches the network, filesystem or shell directly. The Action Broker mirrors the Context Broker: mediated, entitlement-scoped per contract, every invocation and result a first-class ledger event.

This also gives `blastRadius` a **second job**. Today it drives verification depth and model tier. Once agents can write to the world it must additionally bound *which tools are reachable at all*, with the autonomy dial deciding which invocations need human ratification first. A read-only search and an outbound write are not the same risk, and the existing vocabulary already knows how to express that difference.

Finally, `EvidenceBundle.actions` becomes a **structured** record (tool · arguments · result digest · grant id) instead of prose, so the Reviewer can *verify* a claim rather than believe a sentence, and the Learning Agent can mine tool efficacy per clade.

## Alternatives considered

- **Adopt all four as new capabilities.** Rejected: planning and multi-agent are already load-bearing, and re-adopting them invites duplicate machinery — most likely a "self-review" step that drifts into a second, non-independent Reviewer. Naming what exists is the useful act.
- **Treat reflection as just another escalation rung.** Rejected: the ladder is *post-verdict* by construction, and the entry rung is chosen from the Reviewer's error class. Reflection must happen *before* the verdict is paid for, which makes it part of the attempt, not part of the recovery.
- **Let the reflection pass see the verification plan** (it would critique more accurately). Rejected: it directly defeats the constitutional withholding of the verification plan and turns self-review into grader-gaming.
- **Give agents tools directly (an SDK/tool library in worker code).** Rejected: unlogged side effects break the one-substrate invariant, and per-contract entitlement scoping would have no enforcement point.
- **Fold tool grants into the existing Context Broker.** Rejected: reading knowledge and acting on the world have different risk profiles, different governance (blast radius / autonomy dial), and different audit needs. Overloading one channel would blur exactly the distinction that makes the grants meaningful. A sibling broker keeps "no peer chatter" intact without pretending a search API is a context source.
- **Defer both gaps to post-v0.** Rejected for tool use: the v0 dogfood mission is "a structured report from 2–3 sub-questions", and a research report produced with no retrieval is a hallucinated report — the v0 acceptance case cannot honestly pass without it. Recorded as an open scope question rather than decided unilaterally.

## Consequences

- Tasktracker gains four principles that surface on every future `setActiveTask` — so the patterns steer work rather than sitting in a document.
- Two draft requirements (**R12**, **R13**) with acceptance criteria; both carry a distractor-shaped AC in line with the project's test discipline.
- `EvidenceBundle.actions` is now known to be **provisional**. Changing it is a breaking schema change to a P1 artifact; it should land with R13 rather than being patched piecemeal.
- R13 touches sandboxing and credential handling. This ADR **does not lift** the project-wide deferral of security concerns; the obligation is only that the seam is shaped so security can land on it later without redesign.
- No code changes in this ADR. Nothing in P0–P2 is invalidated.

## Open question (owner's call)

**Does R13 (tool use) enter the v0 slice, or the roadmap?** The argument for v0 is that P13's dogfood mission is not honestly verifiable without retrieval. The argument for roadmap is that R13 is a substantial requirement touching P6, P8, P9 and the schemas, and v0's purpose is a thin end-to-end slice. Per the standing preference — *never cut scope, only sequence it* — the requirement is recorded in full either way; only its position moves.

## Related

- Principles: "Agentic pattern 1–4" in the Tasktracker principle set.
- Requirements: R12, R13 (both `draft`). Implicates R8 (Worker Swarm & Context Broker), R9 (mission loop), R6 (Agent Creator).
- [ADR-0002](ADR-0002-model-tiering-and-inference.md) (blast radius → tier; autonomy dial), [ADR-0003](ADR-0003-v0-slice-scope.md) (v0 slice this may extend), [ADR-0004](ADR-0004-schema-encoding.md) (the schemas R13 would change).
- `ARCHITECTURE.md` — invariants #1, #3, #4, #6, #7 are all load-bearing in this decision.
