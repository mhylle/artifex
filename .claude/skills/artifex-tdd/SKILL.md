---
name: artifex-tdd
description: Artifex test & phase-implementation discipline. Use when implementing any v0 phase (P0–P13), writing tests, or marking work done. Triggers on "implement phase", "write tests", "TDD", "acceptance criteria", "is this done", "RED/GREEN", "verify".
---

# Artifex TDD & done-discipline

Every phase is TDD-shaped: **RED before GREEN**, driven by the requirement's acceptance criteria.

- **One failing test per acceptance criterion**, written *before* the implementation. Find the ACs on the requirement linked to the phase (tasktracker `setActiveTask` folds them into the digest).
- **Write the distractor:** each test must also fail a plausible-wrong implementation (e.g. a schema that drops a required field, a router that silently defaults). A test that a stub passes is worthless.
- **Green unit tests are necessary, not sufficient** — dogfood the real flow and live-verify before calling anything done (principle #6). For v0/greenfield with no prod yet, "live-verify" = run it against the local docker-compose / testcontainers stack.
- **Install deps via the package manager** (`npm install`, `ng add`), never by hand-editing `package.json`.
- **"Done" is mechanical, not a feeling:** no unsatisfied ACs on the requirement, no open defects, no self-declared descope. Half-done is not done.
- Update the tasktracker sub-task status as you go; log defects/learnings/frictions as tasktracker insights, not chat narrative.
