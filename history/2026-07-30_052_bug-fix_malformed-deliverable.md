# 2026-07-30 · 052 · bug-fix · A deliverable that is serialised JSON, not an answer (`08db92fd`)

**What:** Fixed the silent-wrong-answer path found live in iteration 36 — the tier-1 worker returns serialised JSON in a field declared as prose, and nothing anywhere notices.

**Why nothing noticed.** The value genuinely *is* a non-empty string, so the schema is satisfied. Gate B then reads it as prose and may well find the criterion met, recording a pass. The requester view renders it as the answer. Every layer behaves correctly on input that is garbage — which is why this is worse than a crash.

**The rate is measured, not estimated.** Replaying every `task.executed` event in the ledger: **2 of 65 answers corrupted (~3%)**, in two distinct shapes, both taken verbatim into the tests rather than invented:

1. A JSON document where a string was asked for — `{"summary": {"purpose": "Explain the mechanism of graphite…"` (truncated, so it does not even parse)
2. A fragment where the model closed the string and kept authoring keys — `5", "explanation": "A standard hard-boiled egg…"`

**Fixed in the same shape as R40's effort floor,** because it is the same class of failure: the worker returned something the contract cannot accept. `task.malformed_deliverable` is recorded and an escalation rung is climbed, **before Gate B**, so a corrupt deliverable never reaches a reviewer that would read it as prose. A corrupt attempt costs a rung, not the task — at 3%, a retry overwhelmingly returns something good, and failing outright would throw away the other 97%.

Deliberately **not** fixed in the model-router: "a string must not contain JSON" is false in general, and the router has no idea what the field means.

**The falsification that mattered.** Fixtures prove a detector does what you wrote; they cannot prove it leaves good work alone. So the detector was replayed over all 65 real answers the system has ever produced: it flags **exactly the 2 known-bad and none of the 63 good**. Zero false positives on real data — evidence a hand-written fixture set could not have produced.

**A sixth surviving mutant, and a real gap.** Dropping the quoted-key half of the fragment pattern (leaving just `", "`) passed every test. That shorter pattern fires on any prose listing quoted items — `Serve it with "toast", "soldiers", or "jam"` — burning an escalation rung on perfectly good work. The comment claimed the key and colon were required; nothing asserted it. Now covered.

**A limitation stated rather than hidden.** A task whose objective legitimately asks for a JSON document produces an answer the whole-document detector cannot distinguish from corruption. No inspection of the *value* can separate them; only intent does, and intent lives in the objective, which this seam deliberately does not parse. Accepted because the cost is bounded and asymmetric — a wrongly-flagged JSON answer costs one rung and is retried, while a missed corruption reaches the requester as fact. A test asserts the limitation exists so nobody later reads the detector as exhaustive.

**What could not be verified.** At ~3% the corruption could not be forced on demand: 8 of 8 raw model calls with the exact failing prompt came back clean. The detector firing on genuine corruption is proven by historical replay, **not** by a live reproduction. Said here rather than glossed.

**Verification.** 10 tests, 7 mutants killed, 319 worker + 66 + 26 green, full workspace build, services restarted, a live mission delivered clean with no false positive, and Mission Control rendering it in the browser.

**Also closed this iteration:** phase P22 was still pending while R22 had been satisfied — the phases pillar was reporting a blocker that no longer existed.

**Outcome:** defect `08db92fd` resolved; acceptance-criteria pillar is now green; 3 open defects remain (`753bc6dd`, `cb939996`, `68f6c31c`).
