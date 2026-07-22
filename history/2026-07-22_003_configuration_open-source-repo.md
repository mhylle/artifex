**What:** Published SWARM as a public open-source GitHub repository.

**Why:** The owner decided SWARM should be open source. Publishing early makes the design (and later the implementation) shareable and gives the project a real home for issues/contributions.

**Details:**
- Created **https://github.com/mhylle/agent-swarm** (public) via `gh repo create`, set `origin`, pushed `main`.
- License: **Apache-2.0** (chosen over MIT/AGPL for its explicit patent grant — the de-facto standard for AI/agent-infra frameworks). `LICENSE` = canonical Apache-2.0 text with copyright © 2026 Martin Hylleberg.
- Added a public-facing `README.md` (what SWARM is, the four meta-agents, status, intended stack per ADR-0001, research foundations).
- Updated the memory bank remote/version-control facts.

**Outcome:** SWARM is live and public under Apache-2.0 with README + LICENSE. Next: `tt-brainstorm` on the ADR-0001 open items (model tier-assignment policy, local model choices, Ollama-vs-vLLM, potential Python science-loop seam).
