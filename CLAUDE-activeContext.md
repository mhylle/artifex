# Active Context

> Current state, goals, and next-phase options. Update at the end of any significant session. This file is the authoritative "where we are".

**Last updated:** 2026-07-22

## Where We Are

- **Stage:** Functional design only. SWARM exists as a **functional solution description (v1.1, 22 July 2026)** — no implementation code, no technology/security/performance decisions (all deliberately out of scope).
- **Primary artifact:** a 7-page HTML dossier in `solution/` — Overview (`index.html`), Architecture, Mission Lifecycle, Agents, Memory & Learning, Observability, Risks & Safeguards — all mutually linked.
- **Provenance:** outcome of a structured brainstorm (Socratic clarification → research → Six Hats / SCAMPER / premortem), source in `docs/brainstorms/2026-07-22-agent-swarm.md`, by Martin Hylleberg.
- **Design locked this brainstorm:** domain-neutral missions; maximal atomization (atomicity is itself verified); recursive fold-up integration; contract-first definition of done; escalation-ladder failure handling; earned agent permanence; constitutional self-improvement (immutable metric/review/audit/budget core); per-mission autonomy dial; earned knowledge commons; instance-per-mission + shared brain; mediated context broker; two-speed learning; budgeted swarm; surrender as a first-class outcome; audit-ledger-driven observability cockpit.
- **System of record:** Tasktracker project **"SWARM"** (id `faf7e141-4cad-4e53-ab65-e490cba4e5a5`), created 2026-07-22 during methodology adoption. No requirements/phases entered yet.
- **Version control:** git initialized 2026-07-22 during adoption; no remote configured yet.

## Next-Phase Options (user's call)

1. **Formalize requirements** from the dossier into Tasktracker (`tt-create-plan`) — turn the locked functional decisions into tracked requirements with acceptance criteria.
2. **Open the next brainstorm** (`tt-brainstorm`) on a deferred dimension — e.g. technology stack, security model, or performance/economics — now that functional scope is settled.
3. **Refine the dossier** — tighten or extend the existing `solution/` pages while still functional-scope-only.
4. **Add a git remote** and push, if this design is to be shared/backed up.

## Known Loose Ends

- No git remote configured — first push has nowhere to go until one is added.
- The brainstorm lives as a markdown file (`docs/brainstorms/`), not as a Tasktracker-native brainstorm; project `brainstormPolicy` is set to `optional` to reflect that.
