# Active Context

> Current state, goals, and next-phase options. Update at the end of any significant session. This file is the authoritative "where we are".

**Last updated:** 2026-07-22

## Where We Are

- **Stage:** Functional design complete; **technical pass has begun.** The implementation stack is now decided (ADR-0001) — no implementation code yet. Security/performance still deferred.
- **Stack decided (ADR-0001):** all-TypeScript. Angular dashboard · NestJS control plane · **separate** TS agent-runtime worker (BullMQ) · PostgreSQL + pgvector as the whole Memory Fabric · Redis/BullMQ job queue · a provider-neutral **Model Router** (Vercel AI SDK / thin custom) dispatching to Claude + local OpenAI-compatible models (Ollama/vLLM). **Multi-model is a first-class requirement** — model tier chosen by the Agent Creator per capability manifest, keyed to blast radius (cheap local by default; frontier where wrong is expensive). Architecture components + relationships registered in Tasktracker.
- **Functional design** exists as a **solution dossier (v1.1, 22 July 2026)** in `solution/` (7 HTML pages) — deliberately technology-free.
- **Primary artifact:** a 7-page HTML dossier in `solution/` — Overview (`index.html`), Architecture, Mission Lifecycle, Agents, Memory & Learning, Observability, Risks & Safeguards — all mutually linked.
- **Provenance:** outcome of a structured brainstorm (Socratic clarification → research → Six Hats / SCAMPER / premortem), source in `docs/brainstorms/2026-07-22-agent-swarm.md`, by Martin Hylleberg.
- **Design locked this brainstorm:** domain-neutral missions; maximal atomization (atomicity is itself verified); recursive fold-up integration; contract-first definition of done; escalation-ladder failure handling; earned agent permanence; constitutional self-improvement (immutable metric/review/audit/budget core); per-mission autonomy dial; earned knowledge commons; instance-per-mission + shared brain; mediated context broker; two-speed learning; budgeted swarm; surrender as a first-class outcome; audit-ledger-driven observability cockpit.
- **System of record:** Tasktracker project **"SWARM"** (id `faf7e141-4cad-4e53-ab65-e490cba4e5a5`). Holds: the frozen functional brainstorm, 7 registered architecture components + relationships, and a genesis phase (id `84676257-…`). No requirements or implementation phases entered yet.
- **Version control:** git initialized 2026-07-22 during adoption; no remote configured yet.

## Next-Phase Options (user's call)

1. **Technical brainstorm** (`tt-brainstorm`) on the open design questions ADR-0001 deferred: the concrete **model tier-assignment policy** (widen the owner's "only decomposition is large" to a blast-radius ladder), local model choices, Ollama-vs-vLLM, and whether the Learning science loop later becomes a Python seam.
2. **Define the v0 slice** — the smallest build exercising the whole loop (decompose → contract → conjure → verify → fold → learn); the brainstorm's own #1 next step. Then `tt-create-plan`.
3. **Design the ledger event schema + contract schema first** — the brainstorm calls these the foundation everything feeds; they're the shared-types core of the all-TS stack.
4. **Add a git remote** and push, if this is to be shared/backed up.

## Known Loose Ends

- No git remote configured — first push has nowhere to go until one is added.
- The functional brainstorm is frozen in Tasktracker but also lives as markdown (`docs/brainstorms/`); project `brainstormPolicy` is `optional`.
- Genesis phase `84676257-…` is a container, not yet linked to any requirement (no requirements exist yet).
- ADR-0001 open items (model tier policy, local model choice, Python science-loop seam) are recommendations, not yet locked — the subject of next-step option 1.
