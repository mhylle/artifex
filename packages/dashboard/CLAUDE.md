# packages/dashboard — CLAUDE.md

Angular **mission-control cockpit**.

## The defining rule

**A view, never a second truth.** The dashboard renders **purely from the ledger event stream** and **persists no state of its own**. If a piece of UI state can't be reconstructed from ledger events, it doesn't belong here — put the fact in the ledger and render it.

## v0 scope (R10 / P12)

- Live ledger feed + a mission **task tree** for one mission, built from streamed events over the websocket.
- **One lens** only. The five lenses, time-travel replay, and the attention queue are roadmap, not v0.

## Conventions

- Consume the API websocket; no direct DB access.
- Types come from `packages/shared-types`.
- Scaffold + add libraries with the Angular CLI / `npm install` (`ng add`, `ng generate`) — never hand-edit `package.json`/`angular.json` dependency entries.
