# 014 — Adopted the four agentic patterns as named principles (ADR-0006)

**Date:** 2026-07-26
**Category:** decision
**ADR:** [ADR-0006](../docs/decisions/ADR-0006-agentic-patterns.md) · **New requirements:** R12, R13 (both `draft`)

**What:** Merged four agentic-design patterns — reflection, tool use, planning, multi-agent collaboration — into Artifex as named principles, after auditing which ones the design already carried.

**Why:** Owner asked for them. The useful work was not adopting all four wholesale but establishing *which are already load-bearing and which are genuinely missing* — adopting a pattern the system already has invites duplicate machinery, and the most likely duplicate here was a "self-review" step that quietly drifts into a second, non-independent Reviewer.

**Details:**
- **Audit result: two already core, one partial, one absent.**
  - **Planning — already core and exceeded.** Orchestrator recursive decomposition, invariant #2 ("no work without a contract"), plan-as-typed-artifact. Artifex goes past "plan first" by *verifying the plan* at Gate A before execution, and routing spec faults straight to re-decomposition instead of retrying.
  - **Multi-agent — already the premise.** Writer (Worker Swarm) / critic (Reviewer, a separate meta-agent) / tester (Tier-0 mechanical pre-checks + non-empty `validationHarness`). Recorded descriptively so the property that makes it work — independence — stays non-negotiable.
  - **Reflection — partial, real gap.** External review and inter-mission learning exist, but there is no self-critique before submission: an `EvidenceBundle` goes straight to the Reviewer, and rung 1 (`retry_same`) only fires *after* a paid-for Gate B rejection. → **R12**.
  - **Tool use — absent, the largest gap.** Verified against the shipped schemas, not just the prose: `inputs.entitlements` and `CapabilityManifest.contextEntitlements` grant **context**; the Context Broker is explicitly "the sole **context** channel"; `EvidenceBundle.actions` is `Type.Array(TextSchema)` — prose *about* what was done. Agents can reason and consult; they cannot act. → **R13**.
- **Reflection is justified on Artifex's own terms, not by outside practice.** Gate B commonly runs a tier *above* the worker it reviews, so paying a Tier-2 rejection plus an escalation rung to catch what a same-tier self-pass would have caught is a bad trade under invariant #7, "effort is a currency."
- **Two constraints recorded as the load-bearing part of the decision.** (1) Self-review is never self-verification — reflection emits no verdict, no task skips Gate B, and it critiques against `acceptanceCriteria` and **never** the `verificationPlan`, which is constitutionally withheld from the worker; reflecting against the grader is how an agent learns to game it. (2) Tool use is brokered, never direct — an unmediated call is an unlogged side effect and breaks invariant #1, so the Action Broker mirrors the Context Broker, and `blastRadius` gains a second job (bounding *which tools are reachable*, with the autonomy dial gating human ratification).
- **Surfaced but not decided: does R13 belong in v0?** The v0 dogfood mission is "a structured report from 2–3 sub-questions", and a research report produced with no retrieval is a hallucinated report — so the v0 acceptance case arguably cannot honestly pass without tool use. Left as an open question in the ADR; both requirements created as `draft` so sequencing stays the owner's call, per "never cut scope, only sequence it".
- **Flagged as a consequence:** `EvidenceBundle.actions` is now known to be provisional. Changing it is a breaking change to a P1 artifact, so it should land with R13 rather than being patched piecemeal.

**Outcome:** Four principles in the Tasktracker principle set (so they surface on every future `setActiveTask` rather than sitting in a document), ADR-0006, a new `ARCHITECTURE.md` section mapping each pattern to where it lives, and R12/R13 with four acceptance criteria each — including a distractor-shaped AC apiece, per the project's test discipline. No code changed; nothing in P0–P2 is invalidated. P3 remains the next build phase.
