# 2026-07-31 · 076 · bug-fix · A judge that argues against its own verdict is now discarded

**What:** Gate A discards a testability finding whose own rationale asserts the criterion IS testable. Defect `627cd71c` resolved — with the fix it named itself when it was logged.

**The failure.** On live mission `02a7d050` the plan audit flagged a criterion untestable, and the detail justifying the flag read *"The criterion is TESTABLE. It specifies formal structures…"*. The structured field said one thing; its own rationale said the opposite. Same shape as `f720938a` (the clarity judge returning "there are none found" **as** an ambiguity) and `890cdea5` (the decompose gate returning `keep_whole` with a rationale arguing for splitting).

**Why the existing mitigations are silent here.** ADR-0010's unanimity sampling requires all three samples to flag before rejecting — and all three flagged, because the model fills the boolean the same wrong way every time. **Sampling catches an unreliable judge, not a consistent one.** And R35's probes, which were the obvious candidate, do not cover it either: probes measure the reviewer's calibration *after* a mission, where this kills a mission at *planning* time before any probe is scored. Worth saying plainly, because the two mechanisms look adjacent and are not.

**The check.** `affirmsTestability` answers one narrow question deterministically — does this detail contain an **unqualified** assertion that the criterion is testable? Gate A then discards the finding rather than rejecting the plan on it: the finding's only content is a rationale that refutes it, so there is nothing left to act on, and discarding errs toward preserving the plan, which is the direction ADR-0010 says to take when a judge cannot be trusted.

Two design choices carry the weight:

- **Sentence-scoped, not detail-scoped.** "The task is not atomic. The criterion is testable." is still a contradiction; scanning the whole detail for a negation would excuse the real case whenever the model hedged about something else.
- **A qualifier family that protects the useful form.** "testable *only if* the format is defined", "*would* be testable if…", "*could* be testable once…" are the judge explaining what would fix the criterion — the most helpful verdicts the gate produces. A check that discarded those would delete the clause instead of repairing it. Restricted to *testability* rather than any positive adjective, too: firing on "is clear" would misread the clarity judge's own vocabulary.

**A stale test found on the way.** `mission-control.spec.ts` asserted the observatory's empty state contained the literal words "not built yet" — a message that was true when written and false since R26 and R27 shipped. The property (honest emptiness) is still asserted; the obsolete *reason* is not, and the test now asserts the stale claim is **gone**.

**Verification.** 11 tests — 8 on the predicate, 3 driving the real `gateA`, because a pure predicate's own tests cannot see whether anything calls it. 6 mutants, all killed: conditionals read as affirmations, detail-scoped instead of sentence-scoped, "only if" dropped from the qualifiers, firing on any positive adjective, Gate A no longer discarding, and Gate A discarding *every* testability finding. 618 worker + 160 + 66 + 50 + 26 green, full workspace build.

**Bound, stated rather than glossed.** This fixes the testability clause specifically. The same self-contradiction shape is recorded for the clarity judge and the decompose gate and is **not** fixed here: a general "does this prose support this boolean" check needs a model, and a model is what was wrong in the first place. Each clause needs its own narrow deterministic rule.

**Outcome:** open defects 5 → 4. Three of four doneness pillars remain green.
