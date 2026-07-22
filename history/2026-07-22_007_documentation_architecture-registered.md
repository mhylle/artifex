**What:** Registered the full architecture in Tasktracker and published a contributor-facing `ARCHITECTURE.md`.

**Why:** Tasktracker previously held only the 7 deployment/plumbing components — not the actual agent architecture (the meta-layer, the memory-fabric stores, the model tier/catalog pieces). And the intended architecture wasn't documented anywhere a contributor would look. Both gaps closed.

**Details:**
- **Tasktracker:** added 12 components — the four meta-agents (Orchestrator, Agent Creator, Reviewer, Learning Agent), Constitution, Context Broker, Worker Swarm, Tier Policy Engine, and the four Memory-Fabric stores (Audit Ledger, Asset Registry, Knowledge Commons, Model Catalog) — and 24 relationships (`contains` hierarchy: meta-layer inside the Agent Runtime Worker, stores inside the Memory Fabric; plus key interactions and the `depends_on` constitutional constraints). Total is now **19 components + 31 relationships**.
- **Repo:** wrote `ARCHITECTURE.md` at the root — two GitHub-rendered Mermaid diagrams (system/deployment view; meta-layer + fabric view), a component reference table, the 4-tier model ladder, the 7 design invariants a change must not break, and a full mission-flow walkthrough. It mirrors the Tasktracker model and defers to the ADRs on conflict.
- Linked `ARCHITECTURE.md` from `README.md` and the `CLAUDE.md` repo map + memory table.

**Outcome:** The intended architecture is now captured in both the system of record (Tasktracker) and a discoverable repo doc. Contributors have a single at-a-glance reference; the tt drift-scan has a real model to check code against once implementation starts.
