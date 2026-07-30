# 2026-07-30 · 036 · code-change · Time travel — the past is a truncated event list, not a snapshot

**What:** Built R20 in full. A scrubber over the mission trail lets an operator park on any recorded moment; the canvas, inspector, budgets, workforce and all four lenses re-render as they stood then. Two moments can be compared, and the past is read-only.

**Why:** The dossier promises three things that all reduce to replay — post-mortems of a failure from before it was visible, before/after diffing (how the Learning Observatory will *show* an improvement rather than assert it), and honest demos of a delivered mission. R20 was blocked until the previous entry fixed defect `74950cfc`: replay over a trail whose events all claim the same instant is not replay.

**Details:**

The implementation is small because the architecture had already paid for it. `LedgerFeed` stores the raw event list and *nothing else*; `tree` is a pure `computed`. So a past moment needed no snapshot store — it is the same list truncated at a `seq` and pushed through the same projections:

- `packages/dashboard/src/app/time-travel.ts` — `eventsAsOf`, `momentsOf`, `diffMoments`. Pure functions, no state.
- `mission-control.ts` — a `cursor` signal (`null` = live), `visibleEvents` / `visibleTree` derived from it. Every view was re-pointed from `feed.events()` / `feed.tree()` at these.
- `mission-control.html` / `.css` — scrubber and compare panel, separate files per the standing convention.

Three decisions worth recording:

1. **No snapshot store, ever.** Writing a snapshot per moment would give the dashboard a second source of truth — the exact thing invariant #1 forbids — and a snapshot can disagree with the ledger with no way for the operator to tell which is lying. Re-folding cannot disagree, because it *is* the ledger.
2. **The comparison always reads forward.** `diffMoments` normalises its two arguments with min/max. Otherwise dragging the handles right-to-left would report negative effort and a lost criterion — a regression manufactured purely by the order of two mouse gestures.
3. **`criteriaMet` is a signed delta, not the later total.** A total would be indistinguishable from progress on a mission that had regressed, and this number exists specifically to support a claim of improvement.

The read-only guard lives in `#actOnTask` and `turnDial`, not only in the template. A hidden button is not an absent capability — there is still a keyboard path and a stale click on a view that just changed. Deciding an attention-queue item deliberately does *not* pass through that guard: it addresses a different mission, so a parked cursor says nothing about it, and blocking it would strand an operator who parked the view precisely in order to investigate before answering.

**Verification.** 29 new tests (17 projection, 12 component); 462 green across the workspaces. Eight mutants, all killed by the intended tests:

| mutant | killed |
|---|---|
| truncate by array position instead of by `seq` | 2 tests |
| `criteriaMet` reports the later total, not the delta | 1 |
| no forward normalisation of the two handles | 1 |
| null cursor collapses to 0 (blank cockpit) | 3 |
| read-only guard removed from the method | 1 |
| lenses read the raw feed, not the cursor | 1 |
| canvas/inspector read the live tree | 2 |
| a parked cursor follows the live tail | 4 |

Then driven in a real browser against mission `acd482c3`, by keyboard on the range input:

- At **#662** (`mission.intake_accepted`) — no objective yet, "No tasks contracted yet", cockpit replaced by "The past is read-only."
- At **#663** (`mission.started`) — the objective appears; still no tasks.
- At **#672** (`task.bounced`) — the switches task reads **bounced**, effort **not reported**, **0 / 1 met**, 3 ledger events. Live, the same task reads **verified**, **1 / 13.33**, **1 / 1 met**, 8 events.
- Workforce lens: **0 staffed** at the first moment, **4 staffed** live.
- Compare **#663 → #681**: 18 events between, 3 criteria met, 3 effort spent, 1 escalation, all three tasks listed as appeared/verified. Comparing a moment with itself reads "Nothing changed between these two moments."
- Clicking **Live** restored the cockpit controls.

**Outcome:** R20 satisfied — all three criteria, browser-verified. While closing it, five requirements finished in earlier iterations (R14, R16, R18, R21, R41) were found still marked `draft` despite every criterion being satisfied; their statuses were corrected. That bookkeeping gap is the same failure mode as defect `cd18baa0` in miniature — the system of record disagreeing with reality — and it would have under-reported project doneness.
