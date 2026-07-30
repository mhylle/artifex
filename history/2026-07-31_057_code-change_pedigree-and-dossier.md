# 2026-07-31 · 057 · code-change · Delivery with pedigree, the surrender dossier — and the mission that finished without saying so

**What:** Built R37, all three criteria. Both terminal events existed and both were nearly empty: `mission.folded` carried `{childCount, conflicts}`, `mission.surrendered` carried `{reason, blockers}`. A requester received an answer with no account of how it was checked, or a refusal with no account of what had been tried.

**Both are derived from the trail at the moment of handover**, never accumulated alongside it. The ledger already holds every verdict, escalation, evidence bundle and effort figure; a second copy assembled as the mission ran is a second truth that drifts from the first. Same rule the dashboard projection follows.

**"What it would take" is derived, not speculated.** Every entry traces to something the trail recorded: unmet criteria from the verdicts, missing capabilities from `staffing.capability_gap`, budget advice *only* when spend reached 90% of the ceiling, and the human-decision line only when the ladder actually reached the human rung. Asking a model to imagine what might help would produce plausible suggestions with nothing behind them — worse than silence, because the requester cannot tell the difference. A distractor pins that a mission which spent 7 of 20 is **not** told to add budget.

**Live driving found the real gap, and no fixture would have.** The pedigree hung off `mission.folded` — and a mission the decompose-or-delegate gate keeps **whole** never folds. Mission `d042175f` logged "delivered" in the worker while its trail simply **stopped** after `gate_b.verdict_issued`: no pedigree, no terminal event at all. That also explains something noted several iterations ago and never chased — a kept-whole mission had nothing to mark it finished with. `mission.delivered` now fires on both paths exactly once, with a distractor asserting a surrendered mission never emits it (two terminal events would show one mission as both finished and failed).

**Verified live, end to end:**

- **Kept-whole delivery** (`1d41a45b`): `mission.delivered` carrying 1 verified task at depth `single`, 5 evidence pointers, 4 genuinely declared assumptions, budget 1 of 20.
- **Surrender** (`02a7d050`): all nine dossier sections — reason, completed, blockers with evidence, escalations, budget, and "what it would take" naming both unmet criteria.
- **Re-entry** (`35d91126` from `02a7d050`): `priorMissionId` and the full prior dossier on the intake event, and the first attempt's findings **pinned into the new contract** — which the orchestrator inherits into every child, so the swarm *sees* them rather than rediscovering them.

The `DossierLookup` is wired at the API composition root against the real ledger reader. Not another correct mechanism nobody calls.

**A limit of our own mitigation, found and written down.** While verifying the dossier, the plan audit flagged a criterion as untestable with a detail reading *"The criterion is TESTABLE. It specifies formal structures…"* — the structured field contradicting its own rationale, the third time this exact shape has appeared. And **all three samples agreed**, so ADR-0010's unanimity sampling passed it straight through. Sampling catches an *unreliable* judge; it does not catch a *consistently self-contradicting* one. Logged as `627cd71c` with the fix sketched (a deterministic self-consistency check, the same reasoning R34's mechanical tier used) rather than patched opportunistically into one clause.

**A footgun that bit again:** the API validated against a stale `shared-types` build and rejected the new `priorMissionId` field as unknown. Green tests, correct source, wrong behaviour — the stale-sibling tell, third occurrence.

**Verification.** 18 worker + 4 API tests, **7 mutants killed on the first pass** (the first clean mutation round in several iterations), 418 worker + 50 API + 66 green, full workspace build, three live missions.

**Outcome:** R37 satisfied; defect `627cd71c` logged.
