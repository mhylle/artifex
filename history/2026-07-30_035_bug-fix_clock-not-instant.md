# 2026-07-30 · 035 · bug-fix · The mission loop took an instant where it needed a clock

**What:** Fixed defect `74950cfc`. `runMission` accepted `now` as a single `string` captured once per run and stamped every event with it, so a 45-second mission produced a trail in which all twenty events claimed to have happened at the same moment. The option is now a clock — `now: () => string` — read inside `record()` per event. The worker binary passes `() => new Date().toISOString()`; the 71 existing test call sites pass `() => AT` and keep exactly the determinism they had.

**Why:** The R19 timeline lens rendered structurally correct swimlanes in which every duration was `0s`. The lens was not broken; it was faithfully reporting a trail that contained no elapsed time. The only non-zero figure anywhere came from `operator.paused`, which the API timestamps itself — which is precisely why the bug survived so long: one honest number in a field of zeros reads as "mostly idle", not as "the clock is frozen". R20 (time-travel replay) is defined over timestamps too, so this blocked more than one requirement.

**Details:**
- `packages/worker/src/mission-loop.ts` — `readonly now: () => string`; `occurredAt: now()` moved to the point of record.
- `packages/worker/src/index.ts` — `now: () => new Date().toISOString()`.
- Three new tests, including a distractor asserting that a *frozen* clock still works, so the fix cannot be read as "timestamps must always differ".
- Mutation-checked. Reintroducing the bug in its exact original shape —
  ```ts
  const frozen = options.now();
  const now = () => frozen;
  ```
  — killed exactly two tests ("stamps successive events with successive times", "a task that waited shows a gap between contracted and staffed") and no others. A third candidate test turned out to pass under the mutant and was rewritten before being kept.
- 435 tests green across six workspaces; build clean.

**Outcome:** R19's timeline acceptance criterion is satisfied on real evidence. Mission `acd482c3` (3 criteria, real Ollama, real Postgres, driven through the browser at :4321) produced 17 distinct `occurredAt` values across 20 events spanning 45 seconds, and the lens showed:

| lane | waited | ran |
|---|---|---|
| light bulbs | 3s | 7s |
| switches | 11s | 8s (bounced → rung climbed → recontracted) |
| lampshades | 19s | 7s |

The first honest reading of the lens immediately surfaced something no one had measured: sibling waits grow linearly with lane index, because `runSubtree` runs siblings in sequence. That is the critical path the criterion asks the lens to make visible, and it is now recorded as measured justification for R32 (dependency graph + parallelism) — when R32 lands, this same lens is its acceptance evidence.

Two related notes carried forward rather than quietly fixed: the DB already assigns `recordedAt`, which no writer can get wrong, and surfacing it through the API's replay projection would make the trail's timing independent of any caller's clock. And R19's learning-observatory criterion stays unsatisfied — the loops it observes (R26, R27) do not exist yet, and the lens says so on screen rather than rendering an empty panel that could be mistaken for "nothing has been learned".
