# packages/dashboard — CLAUDE.md

Angular **mission-control cockpit**.

## The defining rule

**A view, never a second truth.** The dashboard renders **purely from the ledger event stream** and **persists no state of its own**. If a piece of UI state can't be reconstructed from ledger events, it doesn't belong here — put the fact in the ledger and render it.

## v0 scope (R10 / P12)

- Live ledger feed + a mission **task tree** for one mission, built from streamed events over the websocket.
- **One lens** only. The five lenses, time-travel replay, and the attention queue are roadmap, not v0.

## A budget raised, and what it is telling us

`anyComponentStyle` was raised from **8kB error / 4kB warning** to **12kB / 8kB** on 2026-08-01, when the two-pane restructure pushed `mission-control.css` to 8.5kB. The overrun is real, not padding — duplicate card chrome was factored out first and it saved only 550 bytes.

**The budget is telling the truth: `MissionControl` owns too much.** One component holds the header, the intake form, the fleet rail, the attention queue with its answer forms, the canvas, the inspector, the cockpit, the time-travel scrubber and the requester view. That is also why the UI was hard to read in the first place.

The raise is a **deliberate deferral of that split**, not a fix. It still warns at 8kB, so the next person to add styling is told. Splitting the queue and the rail into their own components is the work this is deferring.

## Conventions

- **No inline templates or styles.** Every component uses `templateUrl` + `styleUrl` pointing at sibling `.html` / `.css` files. `template:` and `styles:` in the decorator are not used here, no matter how small the markup.
- Consume the API websocket; no direct DB access.
- Types come from `packages/shared-types`.
- Scaffold + add libraries with the Angular CLI / `npm install` (`ng add`, `ng generate`) — never hand-edit `package.json`/`angular.json` dependency entries.
