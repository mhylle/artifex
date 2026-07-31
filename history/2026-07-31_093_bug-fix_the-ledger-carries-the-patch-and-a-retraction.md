# 093 — The ledger carries the patch, and a defect of mine is retracted

**Date:** 2026-07-31
**Category:** bug-fix

**What:** `fast_loop.hot_fix_applied` now records the change itself, not just which asset changed (defect `aa6948ee`), verified live with a genuine before/after in the same ledger. Separately, defect `526baf8f` was retracted: the trail *does* name the requester, and the defect rested on a query that asked about only part of an event.

**Why:** Invariant #1 says the ledger is the complete record of what happened and nothing that matters happens off-ledger. The event named the asset, the criterion, the bounds and the prediction — everything except what the instructions were patched to, which is the one fact a reader most needs about a fast-loop experiment.

**Details:**

The event carries `patch: { previousValue, patchedValue }`. Both sides, because a patch is a diff: `patchedValue` alone would say where the swarm ended up and not what it moved away from, and the whole judgement of a hot-fix is whether the move helped. Verbatim rather than a digest — these are role-instruction blocks of a few hundred characters, and a hash would make the trail auditable only by someone who still had the original to compare against, which is precisely what a replay does not have.

7 tests in the fast-loop composition file; 5 mutants killed — the patch dropped again, only the new value, only the old value, a placeholder substituted for the real values, and the two values swapped.

**The retraction is the more useful half.** Defect `526baf8f` claimed `requestedBy` is accepted at intake and never recorded, so "no event says who asked for a mission" and R22's audience scoping has nothing to key on. It rested on `select distinct type from ledger_event where payload ? 'requestedBy'`, which asks only about the payload. A ledger event has a dedicated, structured `actor` field, and intake writes the requester there:

    actor: { kind: 'human', id: request.requestedBy, displayName: request.requestedBy }

Live, over `mission.intake_accepted`: `human|operator` 44, `human|mnh@systematic.com` 5, `human|loop-r40-producer` 4, and this loop's own submissions. Every mission names its requester. Adding `requestedBy` to the payload as well would have been a mistake rather than a fix — two sites carrying the same fact is the shape this project keeps paying for.

This is the second error involving that exact field, both with the same root: a payload-only query treated as a question about the whole event. Iteration 71 argued that events lacking `requestedBy` were script-produced; iteration 72 caught that and retracted it — then logged this defect off the same measurement without asking where the ledger's schema actually puts an actor. The known-positive was one query away: a mission I submitted myself, with a `requestedBy` I chose.

**Outcome:**

733 worker + 175 + 66 + 50 + 26 green; all six workspaces build; rebuilt, restarted, queue drained before measuring.

The fast loop fires rarely, so a mission was submitted with a criterion models reliably miss — "define a lever in exactly seven words" — which is a demanding input, not planted state. It triggered, and the result is a before/after within one ledger rather than an assertion about a single row:

    at        has_previous  has_patched
    08:48:25       t             t        <- this iteration
    04:34:20       f             f        <- before the fix
    03:38:19       f             f        <- before the fix

    mission_id    9a424244-ec97-40bf-a168-6e2ab2c2f8d3
    requested_by  loop-79-fastloop
    prev_len      88      patched_len  260

The older rows carrying neither field is what makes this a measurement. And the `requested_by` in that check was read from `actor.id` — the same field whose existence the retraction above turns on.

The science loop's candidate source still reads `hot_fix` rather than the ledger, deliberately: the four historical candidates predate this change and would be unusable from the trail alone. This fix is about the ledger being complete, not about that path.
