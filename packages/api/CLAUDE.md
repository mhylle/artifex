# packages/api — CLAUDE.md

NestJS **control plane**. Mission intake → task zero → enqueue; human gates; live ledger stream to the dashboard.

## Guardrails

- **The API never runs a mission.** It validates intake, creates task zero, and **enqueues** onto the job queue (BullMQ). The Agent Runtime Worker does the work. If you're tempted to decompose/execute here, that's the mistake — enqueue instead.
- **The API only writes gate/intake events to the ledger** (human actions are first-class ledger events, the "symmetry rule"). It otherwise **reads** the ledger.
- **Live stream = Postgres `LISTEN/NOTIFY` → websocket gateway.** The dashboard renders ledger events; the API persists no separate view state.
- **Boolean query params:** NestJS's ValidationPipe implicit-converts `'false'` → `true`. Parse booleans explicitly (dedicated decorator), don't trust the raw coercion.

## Tests (see R10)

- intake → task zero (criteria/boundaries/autonomy dial/budget) + enqueued.
- a ledger event streams to a connected websocket client.

Install deps with `npm install` (never hand-edit package.json).
