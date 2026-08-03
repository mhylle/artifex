# 120 — The reviewer was never told what a red flag is

**Date:** 2026-08-03
**Category:** bug-fix

**What:** Gate B's completion judge has an outcome-affecting `redFlags` field that the model was never told existed. It is now described, and the prompt asks the second question the reviewer was never asked: *is this deliverable usable at all?* Partial fix for critical defect `0ecbf103` — proven by test, **not live**, and that bound is the honest part of this entry.

**Why:** A mission delivered three sections of 200+ words under the headings `版枕`, `清路`, `虎`, describing wet-lab protocols against a criterion demanding computational algorithms. Gate B returned `outcome: pass, findings: [], redFlags: []`. Twice.

**Details:**

**The diagnosis was structural, not a model-quality complaint.** Two things were checked before changing anything:

The reviewer **does** see the sections — `DELIVERABLE: ${JSON.stringify(bundle.deliverable)}` — so it read `版枕` and passed. It was not blind.

And the flag channel **is** load-bearing. `reviewer.ts` collects `[...redFlags, ...intent.redFlags]` and fails the verdict on any of them: *"a structurally suspicious output is refused rather than accepted on its own account of itself."*

So the gate could close, the reviewer could see, and it still passed. The reason was find-shape (j): `redFlags: Type.Array(Type.String())` — **no description** — and a prompt that asked only whether each criterion was met. The model answered the one question it was given, and by a literal reading the criteria *were* satisfied: three sections, each over the word count.

An outcome-affecting field the model cannot see is a gate that cannot close.

**The fix.** `redFlags` now carries a description naming what belongs in it — garbled or wrong-language text, a heading unrelated to what follows it, placeholder or truncated content, an answer that only appears to address the task — and the prompt asks for it explicitly, after the criteria and separately from them. A distractor asserts the criteria question survives: a prompt that talked only about corruption would trade one blind spot for another.

**What was deliberately not changed.** The intent judge already has good red-flag guidance and requires **unanimity across three samples to condemn**, so two of three objecting still passes. That is a deliberate design with its own rationale, and loosening it risks false rejections on work that is fine. It is a candidate, not a defect, and changing it without measurement would be exactly the reflex this project avoids.

Nor is there a CJK filter. "Reject a heading containing Han characters" is the string-matching this project refuses, and it would wave through any garbage that happened to be Latin.

**Outcome:**

837 worker (+3) + 250 dashboard + 58 api + 71 + 54 + 26 green; all six workspaces build.

**The bound, stated plainly: this is proven by test, not live.** Three attempts to reproduce the original failure all stopped earlier in the pipeline than Gate B:

1. two-clause criterion → **Gate A** rejected the decomposition twice as non-atomic
2. single atomic criterion → the clarity judge **bounced three times** and the task exhausted its escalation ladder
3. neither run reached execution, so the reviewer never issued a verdict

The mechanism is proven — the schema carries the description, the prompt carries the question, and the channel provably fails a verdict when a flag arrives. Whether a real tier-2 reviewer *raises* the flag on corrupt output is unobserved.

**What those failed attempts did establish**, and it is worth more than the failure: **the bounce loop is now the dominant failure mode on this task.** Three consecutive bounces, two re-contractings by the `Clarifier`, and no convergence — the clarity judge keeps rejecting its own rewritten contract. That is a different problem from the one being fixed here, it is reproducible, and it is the next thing to measure.

---

## Addendum — both halves now proven live, and the second fault

The bound above ("proven by test, not live") no longer holds, and the reason it did not is itself the second fault.

**The bounce loop never let the work happen.** Measured before fixing: three bounces raised **disjoint** objections, so the Clarifier was addressing each one and the judge produced a different one — `GEOGRAPHICAL_LOCATION` on a report-writing task, then "on what basis three are chosen", then "the word *unique* is subjective". Gate A already bounds this shape (one re-split, then stop, *"the alternative is an unbounded loop"*); the bounce path had no bound. Find-shape (b) again.

**Rule adopted: an objection that cannot survive one clarification is not evidence about the contract.** The measured false-bounce rate is 17–58% and is *not monotonic in model size* — 9B best, 12B worst — so the ladder's own remedy of escalating a tier makes a false bounce **likelier**. The bypass is explicit, and `task.bounce_overruled` records the objection with the reason it was set aside; a judge overruled without a trace would be the system quietly deciding it knows better.

Live, on the same mission that had exhausted its ladder without executing:

    task.bounced → task.recontracted → agent.staffed → task.executed
    gate_b.verdict_issued → agent.staffed → task.bounce_overruled → task.executed

It worked twice and was judged twice. Two mutants, both killed: a bound that never trips, and a bypass from the first attempt.

**And with the work finally reaching the reviewer, the red-flag fix proved itself:**

    GATE B: fail
      redFlags: ["The deliverable is NOT fully usable. The 'sections' part of
                 the JSON object is truncated/incomplete."]
      finding:  "Discarded despite technically passing … A structurally
                 suspicious output is refused rather than accepted on its own
                 account of itself."

That exact class of output previously returned `pass, findings: [], redFlags: []`.

**What is still not fixed, and was never the target.** The corruption itself — truncated sections, CJK headings — is the known structured-output runaway `8b7e9e95`, and widening the answer schema with `sections` is implicated in its reaching a field the operator reads as a title. The system now *catches* it rather than shipping it, which is the difference between a wrong answer and a wrong answer presented as a delivery. Making the model stop producing it is a separate problem.
