# 017 — P3.5: admission is granted to a tier, not in the abstract

**Date:** 2026-07-27
**Category:** code-change
**Phase:** P3.5 (Tasktracker `f9274b20-…`) · **Requirement:** R3
**ADR:** [ADR-0008](../docs/decisions/ADR-0008-admission-gate-semantic-probes.md) (amended)

**What:** Made the admission gate tier-scoped — probes declare a `logicalTier` and are selected by the tier a candidate applies for — and made a tier with no probes raise rather than admit.

**Why:** The owner wanted to use `qwen3.5:2b`, which P3's gate had refused. The refusal was the gate's fault. P3 probed every candidate with `Verdict` and `CapabilityManifest`, both **meta-agent artifacts** — a Verdict is Reviewer output (Tier 2–3), a manifest is Agent Creator output (Tier 2). ADR-0002 puts a small local model at **Tier 1**, "the bulk of atomic worker tasks", which emits neither. The gate was refusing a Tier-1 candidate for failing a job it would never be given.

**Details:**
- **Tier 1 is now judged on `EvidenceBundle`** — what an atomic worker actually produces — with semantic checks on *instruction-following* (the deliverable carries the non-empty `answer` the prompt demanded; the bundle accounts for the effort it spent) rather than on meta-agent reasoning. The `answer` check is unreachable by schema validation on purpose: `deliverable` is `Type.Unknown()` because its shape is the task's business, not the schema's.
- **A tier with no probes raises `NoProbesForTierError`.** Returning `admitted: true` after running zero probes is the same rubber stamp ADR-0008 was written to prevent, and it is indistinguishable from a real pass. Tier 0 is no-LLM, so it legitimately has none. The distractor test for this caught the old behaviour: "promise resolved instead of rejecting".
- **The live answer: `qwen3.5:2b` passes Tier-1 admission, but only 2 of 3 runs.** `qwen3.5:4b` and `qwen3.5:9b` both passed. Reported as measured rather than rounded up.

**Outcome:** TDD red→green — 8 failures observed first. 21 model-router tests (was 13), **92 repo-wide**, build + typecheck clean.

**Unplanned finding, logged as high defect `d678cd8c`:** `qwen3.5:2b` was **admitted** at Tier 2 here, while the identical P3 probe set **refused** it. Admission takes a single sample of a stochastic process and records it as a permanent catalog fact, so its verdicts do not replicate. Consequences run both ways: tier resolution would depend on which sample ran on admission day, *and* the single P3 refusal that motivated this whole change was itself weak evidence — the tier-scoping argument rests on ADR-0002's tier definitions, not on that run. Deliberately not fixed here: it changes what `admitted` means, and three candidate resolutions are recorded on the defect. Should be settled before P6 staffs agents from the catalog.
