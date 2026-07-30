# 026 — P10: Control Plane API (intake + live ledger stream)

**Date:** 2026-07-30
**Category:** code-change
**Phase:** P10 (Tasktracker `3c09a3d6-…`) · **Requirement:** R10 (AC-1 complete; AC-2's *dashboard* half is P12)

**What:** The NestJS control plane — mission intake producing task zero and enqueuing it, plus the live `LISTEN/NOTIFY` → websocket ledger stream.

**Details:**
- **Intake refuses rather than defaults.** A mission with no success criteria is rejected, because inventing a criterion on the requester's behalf would be the control plane deciding what success means. "No work without a contract" starts at intake, not at the first decomposition.
- **Task zero is validated before anything is recorded or enqueued.** Nothing downstream can repair a malformed contract, and the worker is entitled to assume what it receives is valid.
- **The human intake is a first-class ledger event** — the symmetry rule. An operator starting a mission is exactly as auditable as an agent acting.
- **The stream hydrates by `seq` rather than trusting the notification.** P2 deliberately publishes a *pointer* because Postgres caps NOTIFY at 8000 bytes and an evidence bundle exceeds it. Hydrating is also precisely the path a consumer needs to catch up after a disconnect — one mechanism, two jobs.
- **`replayThenSubscribe`** exists so a cockpit opened mid-mission sees the whole trail. A partial trail is worse than none, because the operator cannot tell which one they are looking at.
- **One failing subscriber does not starve the others** — a browser tab that throws must not take the stream down.
- The most important thing about this package is what is *absent*: there is no "run" endpoint. The API enqueues and stops.

**Tooling decision — `api` moved from jest to vitest.** Jest's CommonJS default cannot parse the ESM-only workspace packages without a pile of `moduleNameMapper` and `transformIgnorePatterns` workarounds, and every other package here already uses vitest. One runner across the monorepo, no interop layer. This also required **`unplugin-swc`**: NestJS dependency injection reads `emitDecoratorMetadata`, and vitest's default esbuild transform does not emit it — without it every DI-constructed provider resolves to `undefined`, and the failure presents as a broken test rather than a missing transform.

**Outcome:** TDD red→green. **17 api tests** (was 1), **224 repo-wide**, 29 integration, build + typecheck clean. Mutation-verified: broadcasting to all missions instead of the subscribed one failed exactly the mission-isolation distractor.

**Dogfooded against the real stack** — Postgres, Redis/BullMQ, real `LISTEN/NOTIFY`:
```
task zero validated · criteria/boundaries/dial/budget carried · depth 0, own mission id
mission on the Redis queue (waiting=1) with its contract attached
a BullMQ Worker picked it up — the API enqueues, the runtime executes
a late subscriber got its missed history, then a LIVE event over real NOTIFY
the event was hydrated BY SEQ (proved by reading a payload field the pointer never carries)
another mission's subscriber received NOTHING
```

**Not claimed:** R10 AC-2's dashboard half — the task tree rendering from these events with no state of its own — is P12.
