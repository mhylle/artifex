# 094 — The read-only boundary moves to the projection that actually runs

**Date:** 2026-07-31
**Category:** decision

**What:** Settled the last entry of defect `635b7a9f`. `LearningProjection` is recorded as **superseded** rather than wired or deleted, and R11 AC-0's read-only property is now proven on `LedgerEvidenceSource` — the projection the running system actually learns from.

**Why:** R11 AC-0 says the learning projection "has no write capability", and that was demonstrated only on a class with no production caller. A boundary proven on the component nobody runs is the shape this project keeps finding, and it is worth less than it looks.

**Details:**

The supersession is grounded in R11's own text: it built the projection as the v0 boundary proof — "proves the boundary that later admits the full science loop… No experiments/ratchet in v0". R27 then brought `LedgerEvidenceSource`, which is wired in `index.ts` and in `buildScienceLoop`. `LearningProjection`'s report is genuinely unread: `tierBumps` and `errorClasses` appear nowhere outside the class itself, checked across every non-test, non-dist source. The `errorClasses` in `escalation.ts` is an unrelated field on attempt signatures.

Wiring it was considered and rejected. The only way to give it a caller would be to append a per-mission report event nobody reads — a producer with no fuel, which is the twin of the shape being fixed. Deleting it was rejected too: it is truthful work implementing a real requirement, and removing it to quiet a finding is the `cd18baa0` failure shape.

So what was missing turned out not to be the wiring but the **proof**. `projection-read-only.test.ts` makes the same behavioural argument on the live path that `LearningProjection`'s own test pioneered — hand the component a store that really can write, and assert it never does, because "a type annotation is a promise; an unused capability is evidence."

Behavioural rather than structural, deliberately. The interfaces already omit `append`, so a type-level test would pass against a source that reached for a wider capability at runtime — precisely what a learner able to manufacture its own evidence would do. Two mutants prove the test bites: an `append` inside the mining loop, and an `upsert` against the asset registry. Both die. The registry matters as much as the ledger here: it is the store whose rows decide reuse, so a learner that could advance a design's version would be grading its own homework in a second place.

The test carries its own control — it asserts the projection produced evidence and read the ledger, since "it never wrote" is vacuously true of a component that never ran. That guard immediately earned itself: a fixture whose `agent.staffed` carried a `capability` short-circuited the ladder's first rung, so the design lookup never ran, and without the control two `not.toContain` assertions would have passed against a store nobody touched. The fixture was fixed and the note left in the test.

`reachability.test.ts` keeps its entry, because the class is still genuinely unreachable and the anti-rot assertion must stay valid; only the reason changed from "gap" to "superseded".

**Outcome:**

736 worker + 175 + 66 + 50 + 26 green; all six workspaces build. Nothing shipped to the running system this iteration — the change is a test and a record — so the worker and API were left alone.

Defect `635b7a9f` is closed with all three of its entries settled on their own evidence: `ActionBroker` as a requirement-state correction (ADR-0015), `evaluateOnSealedBench` wired and verified live in iteration 75, and `LearningProjection` superseded here. None of the three was resolved by deleting code.
