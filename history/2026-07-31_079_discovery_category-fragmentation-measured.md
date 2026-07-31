# 2026-07-31 · 079 · discovery · Category fragmentation, measured — and a fix that was necessary but not sufficient

**What:** the long-carried "category fragmentation" item is now measured, its cause traced, one fix shipped, and that fix's live result recorded as a **negative**. Logged as defect `340aa7de` with the next lever named.

**The measurement.** 29 designs across 27 categories — **1.07 designs per category**. Only `mission` holds real evidence (2 designs, 57 observations), and it accumulates only because every atomic mission lands there. Everything else sits at 0–8 observations on a single design.

**The cause, and why clustering was never going to fix it.** R38's `resolveCapability` *is* wired — `staff()` calls it with `knownCapabilities()` — and it works exactly as designed, merging a proposal onto a known capability when they share a token. It cannot merge what it is given, because the planner names **subjects**: `thermodynamics`, `history astronomy`, `mechanical engineering`, `scientific terminology`. Those share no token and correctly should not. But a design that writes one-sentence definitions is the same capability whether the subject is osmosis or entropy — the clustering merges *names*, and the names were answering a different question.

**The fix, and its limit.** `SingleSubtaskSchema.category` was a bare `Type.String({ minLength: 1 })` with **no description at all** — the model was never told what the field meant, so it filled it with the most obvious reading. It now carries an abstract description ("the kind of work… not the subject matter"), deliberately *not* an enum: the dossier makes the taxonomy a learnable asset, and freezing it would end the learning — the same reason this project bans example phrasings in judge prompts.

**Live result: negative.** Two missions on deliberately different subjects but the same capability produced `Biology/Chemistry`, `Science / Biology Content Creation`, `Economic Definition`, `Economic Literacy`. Still subject-named. The description is a genuine improvement to a genuinely unlabelled field, and the tier-1 model does not honour it strongly enough on its own. Reporting that as a failure rather than as progress is the point of running it live.

**The next lever, named but not built.** Show the planner the capabilities the registry already holds, the way `staff()` already does at staffing time. `knownCapabilities()` exists and has never been shown to the planner. That lets the model reuse a name instead of inventing one while staying free to propose a new capability when nothing fits — open taxonomy preserved, which an enum would destroy.

**Why it is worth this much attention.** Fragmentation throttles **six** mechanisms: weak spots stuck at `observations: 1`, the fast loop's category-keyed trigger, decomposition templates keyed to `mission`, the workforce lens rendering "UNCATEGORISED", context entitlement strings, and R29's amendment trigger — which has consequently never fired, and is why `d08191c8` cannot be closed.

**Verification.** 2 new planner tests (one asserting the field is described in terms of work-versus-subject, one distractor asserting the taxonomy is *not* frozen into an enum). 649 worker + 160 + 66 + 50 + 26 green, full workspace build, two live missions.

**Outcome:** a suspicion became a measurement, a plausible fix was tried and honestly reported as insufficient, and the next step is specified rather than guessed at.
