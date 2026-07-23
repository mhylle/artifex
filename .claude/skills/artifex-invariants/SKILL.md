---
name: artifex-invariants
description: The 7 non-negotiable Artifex design invariants. Use BEFORE writing or reviewing any code in packages/worker/** or anything touching the meta-agents (Orchestrator, Agent Creator, Reviewer, Learning Agent), Constitution, Context Broker, Worker Swarm, the mission loop, verification gates, or the audit ledger. Triggers on "invariant", "constitution", "gate A/B", "fold-up", "context broker", "learning agent", "ledger", or editing worker/meta-agent code.
---

# Artifex invariants

A change that breaks one of these is wrong regardless of how clean it looks. Canonical source: `ARCHITECTURE.md`.

1. **One substrate.** Every action, verdict, and decision is appended to the audit ledger. The dashboard renders ledger events and persists nothing; human actions are first-class ledger events.
2. **No work without a contract.** Nothing executes without acceptance criteria, boundaries, stopping conditions, and a budget — authored by the level above. The mission is task zero.
3. **Verify both ends.** Gate A audits atomicity/coverage *before* execution; Gate B checks completion against the contract *after*.
4. **The learner does not own the yardstick.** The Learning Agent may rewrite prompts/playbooks/taxonomies — never the constitutional core (metrics, review independence, ledger integrity, budget). Amendments are propose-only.
5. **Permanence is earned.** Designs/knowledge are ephemeral by default; promote on measured, replicated evidence (by clade), down-weight losers, never hard-delete.
6. **No peer chatter.** Agents exchange context *only* through the Context Broker; every exchange is logged. No direct memory-fabric reads from a specialist, no agent-to-agent side channels.
7. **Effort is a currency.** Tasks carry budget floors and ceilings; optimize value-per-effort.

If a task seems to require breaking one of these, stop and surface it — don't quietly route around the invariant.
