# packages/worker — CLAUDE.md

The **agent runtime** — the heart of Artifex. Hosts the four meta-agents (**Orchestrator, Agent Creator, Reviewer, Learning Agent**) + **Constitution**, **Context Broker**, and the ephemeral **Worker Swarm**. A BullMQ consumer runs the whole mission loop. **Not** in the API request path.

## The 7 invariants — a change that breaks one is wrong regardless of how clean it looks

1. **One substrate** — every action/verdict/decision is appended to the audit ledger; nothing that matters happens off-ledger.
2. **No work without a contract** — nothing executes without acceptance criteria, boundaries, stopping conditions, and a budget, authored by the level above. The mission is task zero.
3. **Verify both ends** — Gate A (atomicity/coverage) *before* execution; Gate B (completion vs contract) *after*.
4. **The learner does not own the yardstick** — the Learning Agent may rewrite prompts/playbooks/taxonomies, never the constitutional core (metrics, review independence, ledger integrity, budget). Amendments are propose-only.
5. **Permanence is earned** — designs/knowledge are ephemeral by default; promote on evidence (by clade), down-weight losers, never hard-delete.
6. **No peer chatter** — agents exchange context **only** through the Context Broker, and every exchange is logged. No direct fabric reads, no agent-to-agent side channels.
7. **Effort is a currency** — tasks carry budget floors/ceilings; optimize value-per-effort.

## Conventions

- Model access is **only** via `packages/model-router` (never call a provider SDK directly here).
- Schemas/types come **only** from `packages/shared-types`.
- Tier is computed by the Tier Policy engine per staffing decision; a tier-bump is an escalation-ladder rung.

Canonical detail: `../../ARCHITECTURE.md` + `../../docs/decisions/`. See the `artifex-invariants` skill.
