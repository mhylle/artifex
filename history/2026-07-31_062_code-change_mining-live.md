# 2026-07-31 · 062 · code-change · The Learning Agent finally reads the ledger — and finds 52 weak spots

**What:** Gave R27's mining half its missing upstream and wired it into the running worker. **R27 AC-0 satisfied**, on real data.

**No new query was needed.** `listMissions()` already enumerates every mission with its status and escalation count — it is what backs the fleet rail — and `replay` supplies per-task detail. `LedgerEvidenceSource` is the fold between them, emitting one row per (mission, **category**) rather than per mission, because that is what `rankWeakSpots` aggregates on: a mission usually spans several categories, and collapsing them would attribute one category's failures to every other category the mission touched.

**No window was invented.** The history is every mission that has **finished**. A running mission has no outcome, so it carries no evidence, and counting its partial verdicts would make a category look weak merely because its work is still in progress. "The last N missions" would have been a constant nobody measured — the ledger already knows which missions are over. A distractor asserts a running mission is skipped *without being read at all*.

**An architectural near-miss, caught before shipping.** The first wiring attempt added a `GET /missions/weak-spots` endpoint importing `LedgerEvidenceSource` into the API. That would have made the control plane depend on the worker — and the Learning Agent is one of the four meta-agents, which live in the worker by design. Scrapped and rebuilt worker-side, where mining runs after each mission's events are durable, so the mission counts toward the history it mines.

It only ever **appends** a ranking. Invariant #4: the Learning Agent proposes, never enacts.

**Proven live, not in a fixture:** `learning.weak_spots_ranked` went **0 → 1** on a real mission, ranking **52** weak spots from **84** evidence rows drawn from the real ledger, with genuine reasons — *"1 mission(s) surrendered in this category"*, *"6 escalations across 1 verdicts — an escalation hot spot"*.

**An observation the real data volunteered.** 52 weak spots from 84 rows, and most carry `observations: 1` — categories like "Hand Tool Education" and "Writing Implements: The Marker" are one-offs. The planner still invents a fresh category per task despite R38's clustering, so the ranking is dominated by singletons rather than trends. Mining is correct on the data it has; **the data is more fragmented than the ranking assumes.** Recorded in `66356a6e` with the next step named: measure against `agent_design` row counts before deciding whether R38's clustering needs strengthening or the ranker should require a minimum observation count. Not guessed at here.

**Still open:** `CandidateRunner` (AC-1/2/3). Nothing replays a bench case under a candidate change, so no experiment has ever run. That runner is still the missing consumer for R25's sealed slice, the supply for R35's probes, and where `parent_design_id` would be set.

**Verification.** 8 tests, 6 mutants killed, 475 worker + 66 green, full workspace build, live before/after row count on the real database.

**Outcome:** R27 AC-0 satisfied; AC-1/2/3 carried with the runner named as the single remaining piece.
