# 2026-07-30 · 053 · code-change · The Knowledge Commons gets a producer — and the consumer turns out to be blocked on something bigger

**What:** Wired the producer half of defect `753bc6dd`. A task that passes Gate B now submits its finding to the Knowledge Commons, which had been a correct store nothing could reach since R24.

**Why it was buildable only now.** A finding "originates inside a verified task", and until R40 a verified task recorded only `{ answer }` — no provenance, no evidence ids, nothing a submission needs. R40's evidence bundle is what made this a wiring job rather than an invention.

**Four judgements, each defensible the other way, each recorded in the test rather than the commit message:**

1. **The claim is the verified deliverable keyed to its objective.** A cleverer producer would ask a model to extract "reusable knowledge" — a new seam, a new failure mode, a new thing to be wrong about. The store was built guilty-until-proven-useful *precisely* so the producer need not be a perfect judge: everything lands in quarantine, and a high-impact claim needs a stranger's re-derivation before it publishes. A parochial finding sits there harmlessly forever.
2. **Gate B's pass is the admission ticket.** Submitting at execution would fill the store with exactly the unreviewed output quarantine exists to keep out.
3. **Impact is derived from the producing task's blast radius**, which already says what being wrong costs — a second scale could only disagree with the first. Anything not `high` maps to `low`, because the database's `impact` is a closed two-value set and a third value would be rejected at insert, losing the finding entirely.
4. **A commons failure is swallowed**, exactly as the registry's track record is: a knowledge store is a side benefit, and losing verified work because a bookkeeping write failed trades the product for the receipt.

**The consumer half was deliberately NOT built, and that is the finding of the iteration.** The obvious next step was teaching `context-broker.ts` to serve `retrieve()`. Searching for `new ContextBroker` outside its own test file returns **nothing** — invariant #6's sole context channel is never instantiated by the running system (defect `488709be`). Wiring a consumer into it would have been building a consumer for a component nobody calls: the same inert shape one level up, looking like progress while adding a second unreachable path. The invariant is not being *violated* — no agent requests context at all today — it is *unexercised*.

**A near-miss worth recording.** Making `record()` return its event id (so a submission can cite what it just wrote) was a mechanical edit that landed the `return` **before** the `onEvent` call, silently disabling live event streaming — a clean regression of defect `b3b4e554`. The existing streaming tests caught it immediately. This is the argument for keeping a test whose only job is "the first event is emitted before the mission resolves".

**Verification.** 8 producer tests + 2 composition tests, **6 mutants killed** (submit-on-execution, placeholder evidence, hardcoded impact, medium-maps-to-high, commons unwired at the root, failure loses the mission). 329 worker + 66 green, full workspace build.

**Proven on the real stack, not a fixture:** `knowledge_entry` went from **0 rows to 1** on a live mission — `quarantined`, `impact=low`, `verified_by=gate_b` — and both evidence ids resolve against `ledger_event` to the actual `task.executed` and `gate_b.verdict_issued` rows. The traceability claim is a property, not a word.

**A test corrected rather than bent.** The impact test first set `blastRadius` on the mission and expected it to propagate; it does not, because the planner assigns each subtask its own. The implementation was right and the test was driving the wrong input — fixed at the input, with the reasoning left in place, and it now exercises the real path.

**R24 has no UI surface**, so this is verified at the database, the same standing exception as R23.

**Outcome:** producer live; `753bc6dd` stays open for its consumer half; new defect `488709be` logged for the uninstantiated broker.
