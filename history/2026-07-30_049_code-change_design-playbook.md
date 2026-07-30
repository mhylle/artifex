# 2026-07-30 · 049 · code-change · The design playbook and effort scaling — R38 complete

**What:** Closed R38 AC-2, the last criterion on the requirement. Specialists are now composed from typed building blocks, and the scheduler sizes each wave to what the budget and the risk can carry.

## Typed building blocks

The author seam was a single hardcoded template string — `You answer exactly this task, and nothing beyond it: ${objective}`. That is neither freehand generation nor a playbook; it is one block pretending to be a design, and it could not vary with the contract, so every specialist in the system said the same thing regardless of what it had been asked to do.

`composeDesign` emits five named blocks — **role, scope, evidence, anti_scope, stopping** — each filled from a contract field. The constraint is structural rather than instructional: a composer that can only emit known kinds, each traceable to a named field, cannot acquire an obligation the contract never stated. No prompt has to ask it not to.

Two details worth keeping: an absent anti-scope prints *"none stated"* rather than an empty block, because a blank reads as "nothing is out of scope" — a claim the contract never made. And capabilities are **derived**: `text` always, `tools` only when the contract actually carries tool entitlements, so a design cannot claim reach it was not granted.

**Live** — the registry now holds this, composed during mission `5e0c9053`:

```
You are a specialist in History & Astronomy. You do this one task and nothing else.

TASK: Trace the historical evolution and astronomical uses of the astrolabe.

DONE WHEN each of these can be shown to be true:
  - [m-1] Explains what an astrolabe was used for historically.

OUT OF SCOPE — do not address these, they belong to others:
  - Do not include any information regarding the game of Shogi…

STOP TRYING IF:
  - The escalation ladder is exhausted without a verified result.
```

## Effort scaling

`concurrencyFor` bounds a ready wave by two things read off the contract, never chosen:

- **Budget** — a worker consumes at least its floor, so the parent's ceiling caps how many can be in flight. This is the *fifty-agents-for-a-triviality* half.
- **Blast radius** — the contract's own class marker, expressed as a fraction of the wave rather than a subtraction from the budget, so the two bounds stay independent. High runs a quarter of the wave at once, medium a half, low all of it.

It never returns 0 for a non-empty wave: a budget too thin for even one floor must still run one, because progress with a visible overrun is recoverable and a silent halt is not.

**Live** — mission `a7e90fa3`, three children all at high blast radius (`riskCap = ceil(3/4) = 1`):

```
19:30:45.697  staffed …5b
19:30:52.625  staffed …5c      ← 7 seconds later
```

One at a time, against the R32 baseline where three low-risk tasks were staffed **within 24 milliseconds** of each other. Same scheduler, different bound.

**A test that could not be written as intended.** The throttle test was first written against the *budget* bound and failed: `authorContracts` caps a child's floor at its own ceiling, which is `effortShare` of the parent's, so with shares summing to 1 the parent can always afford at least two concurrently. The budget bound cannot bite through the loop by construction. It is unit-tested directly; the loop-level test uses the risk bound instead, and says so where a reader will find it.

**Verification.** 13 new tests, **292 worker + 67 integration green**. Six mutants killed, including both composition mutants — the scheduler ignoring the bound, and the author reverting to the template string.

Also closed a gap the prompt had flagged: `staff()` was called without `fanIn` or `budgetHeadroom`, so two `StaffOptions` fields the tier policy has always accepted were supplied by nobody. Both are now derived — fan-in from how many siblings consume the task, headroom from spend against the effective ceiling.

**R38 is complete** — all four criteria satisfied and live-verified. Phases P38, P38b and P38c closed.
