**What:** Chose the SWARM implementation stack — the first technical decision after the functional design was frozen. Recorded as ADR-0001.

**Why:** The `solution/` dossier deliberately deferred all technology. With functional scope settled, the owner wanted the implementation architecture decided — Angular frontend fixed; NestJS + PostgreSQL proposed for the backend with an explicit invitation to push back.

**Details:**
- **Decision:** all-TypeScript. Angular dashboard · NestJS control plane · a **separate** TS agent-runtime worker (not in the API request lifecycle) on Redis/BullMQ · PostgreSQL + pgvector serving the entire Memory Fabric (Audit Ledger / Asset Registry / Knowledge Commons) · a provider-neutral **Model Router** dispatching to Claude + local OpenAI-compatible models (Ollama/vLLM).
- **Key owner requirement:** heterogeneous model fleet — small local LLMs for the bulk of agents (cost + speed), frontier only where cost-of-error is high. **Model selection is an output of agent creation** (a field on the capability manifest set by the Agent Creator).
- **Advisor refinements accepted:** (1) hard-separate runtime from API; (2) Postgres is the whole fabric incl. pgvector; (3) key model tier to **blast radius / task class** (default cheap; escalate for decomposition, semantic Gate B review, learning science loop) rather than one named agent; (4) the Model Router — not the Claude Agent SDK — is the spine, with the Agent SDK as one backend.
- **Alternatives rejected:** hybrid NestJS+Python and Python-first — both duplicate the contract/ledger schemas across a language boundary, losing the all-TS shared-types win. Python kept in reserve as one clean seam: an offline science-loop service later, if needed.
- Registered 7 architecture components + 7 relationships in Tasktracker; created genesis phase `84676257-…`; wrote `docs/decisions/ADR-0001-implementation-stack.md`; registered + froze the functional brainstorm (`bd543029-…`).

**Outcome:** Stack locked (ADR-0001, Accepted). Open items deliberately deferred to a technical brainstorm: exact model tier-assignment policy, local model choices, Ollama-vs-vLLM, and the potential Python science-loop seam. Tasktracker now holds the frozen functional brainstorm + the runtime/deployment architecture.
