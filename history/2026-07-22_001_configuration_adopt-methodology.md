**What:** Adopted the claude-project-setup methodology into the SWARM project.

**Why:** SWARM existed only as a functional solution dossier (`solution/`) plus its source brainstorm, with no memory bank, no development-history system, no version control, and no system-of-record for requirements/planning. Adopting the methodology gives future cold-start sessions a reliable way to orient and keeps state honest.

**Details:**
- Installed the memory bank at the project root: `CLAUDE.md` (router + behavioral rules + repo map + preferences), `CLAUDE-activeContext.md` (current state / next options), `CLAUDE-history.md` (this index).
- Installed `.claude/rules/core-rules.md`, `.claude/commands/update-memory-bank.md`, and `.claude/agents/memory-bank-synchronizer.md`.
- Created the `history/` system with `.counter` and this first entry.
- Created Tasktracker MCP project **"SWARM"** (id `faf7e141-4cad-4e53-ab65-e490cba4e5a5`) as the system of record; `brainstormPolicy` set to `optional` because the brainstorm exists as a markdown file rather than a Tasktracker-native brainstorm. Retained the Tasktracker (Mandatory) section in `CLAUDE.md`.
- Initialized git (`main`) and made the first commit. No remote configured yet.
- Templates fetched from `https://raw.githubusercontent.com/mhylle/claude-project-setup/main/` (domain verified singular `githubusercontent`).

**Outcome:** SWARM is now under the methodology — memory bank present, history system live, core rules installed, Tasktracker project of record established, repo under version control. Design content (the `solution/` dossier and the brainstorm) was preserved untouched.
