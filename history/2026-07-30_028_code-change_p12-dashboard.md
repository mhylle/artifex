# 028 — P12: Mission Control — the cockpit, and the frontend gap closed

**Date:** 2026-07-30
**Category:** code-change
**Phase:** P12 (Tasktracker `04557902-…`) · **Requirement:** R10 AC-2 (dashboard half; the API half shipped in P10)

**What:** The Angular Mission Control cockpit — a live ledger feed and a mission task tree rendered entirely from streamed events.

**Details:**
- **The tree is a pure function of the event list.** `buildMissionTree(events)` — no store, no mutation, no accumulated view state. This is the strongest available way to hold the package's defining rule ("a view, never a second truth"): if the only way to obtain a tree is to fold the events, a second source of truth has nowhere to hide, and invariant #1 stops being a convention someone has to remember to respect.
- **Status is derived, never stored.** A task reads "verified" because its last Gate B verdict passed, not because anything set a flag — so the cockpit cannot disagree with the ledger, even transiently.
- **Events are sorted by `seq`.** A websocket delivers promptly but not necessarily in order; the ledger's ordering is the only one that counts. A distractor asserts a reversed trail folds to an identical tree.
- **A partial trail renders a partial tree, not a wrong one** — a cockpit opened mid-mission must not invent state it has not seen.
- `LedgerFeed` holds the raw trail and nothing else; everything on screen is a `computed` over it, de-duplicated by `seq` because a reconnect replays history the client may already hold.
- Replaced the Angular welcome-page scaffold: `app.html` is now just `<router-outlet />`, and its spec asserts the shell renders no content of its own.

**Outcome:** TDD red→green. **16 dashboard tests** (was 2), **246 repo-wide**, build + typecheck clean. Live-verified: `ng serve` returned HTTP 200 serving the app shell, and the production build compiles clean.

**A self-correction worth recording.** The first mutation attempt — caching the whole tree — **changed nothing**, so the "removing events removes them from screen" distractor was not yet biting. That is the same vacuous-distractor trap logged globally during P6. Re-running with a mutation that models the *actual* failure mode — a cockpit **accumulating its own task list** across folds — failed exactly that distractor. The lesson generalises: a mutation has to model the real failure, not merely be *a* change.

**Milestone:** with P12, **the frontend gap is closed**. Angular dashboard + NestJS control plane + agent-runtime worker all exist, are tested, and are wired to the same ledger. R10 AC-2 is complete across P10 (live NOTIFY → websocket, hydrate-by-seq) and P12 (the tree rendered from those events).
