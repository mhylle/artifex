# 099 — The agent acts: R13 closes, and an ADR of mine is corrected

**Date:** 2026-07-31
**Category:** code-change

**What:** R13 AC-0 satisfied on live evidence — an API-submitted mission produced `action.invoked` from the deployable worker, carrying the grant id, tool, arguments and result digest. R13 is fully satisfied and the acceptance-criteria pillar is green. ADR-0020 records the decision and corrects one of ADR-0015's four claims.

**Why:** ADR-0015 un-satisfied AC-0 because the `ActionBroker` — complete, tested, mutation-checked — was unreachable from the deployable worker. It named four missing links. This closes them.

**Details:**

**One of the four links was my own over-claim.** ADR-0015 said *"`packages/model-router` has no tool-calling support at all — zero occurrences of `tool` in its production sources"*, which is true, and concluded *"a worker agent has no way to emit an invocation"*, which does not follow. `generate({ probe: { schema, prompt } })` takes an **arbitrary TypeBox schema**, and every other decision this system makes already travels that way — the planner emits structured decompositions, the reviewer structured verdicts, the gate a structured judgement. A tool invocation is one more structured object. Nothing blocked the agent from asking; nothing had been written to ask.

That is not a detail. ADR-0015 rejected its own Option B — wire a credential-free internal tool — *"because link 1 still blocks the agent from asking"*. The rejection rested on the false half. Two of that ADR's arguments have now failed on inspection, and the pattern is worth naming: it was written from a **reachability trace**, and a trace tells you what *is* called, never what *could* be.

The three real links closed as stated. Intake grants tools by blast radius (`toolEntitlements` was a hardcoded `[]`, which is why the live count of contracts carrying a grant was **0**); `worker-seams.ts` constructs the broker; the work seam reaches it through a narrow `ToolInvoker` that carries no sink and no mission id, so the worker cannot append an action event of its own — which is what makes "the sole action channel" structural rather than conventional.

**The catalogue carries one tool, `text.count`, and the choice is the argument.** R13's scope note defers sandboxing and credentials project-wide, and search — the tool R13 actually wants — is outbound network access. A pure function over text supplied in the invocation needs no sandbox, so the mediated path can ship without lifting the deferral. It is `compute` rather than `read` because risk classes grade *consequence*; that puts it above `low` blast radius, so a low-blast-radius mission genuinely gets no tools, which is AC-3 working rather than a gap. And it was chosen to change outcomes rather than to demonstrate a mechanism: models are unreliable at counting words, and this project's own missions ask them to be.

`admissibleRiskClasses` **moved** into `shared-types`. Intake decides what a contract grants and the broker decides what it permits; those must not be able to disagree. Two copies of one rule is the shape found four times here, most recently `6d58e8ef`.

6 mutants killed, each verified to change behaviour first. The most valuable bypasses the broker and runs the tool directly — invariant #1's "no unlogged side effect" proven behaviourally rather than asserted. The others: intake granting nothing again, `grantsFor` ignoring the radius, the seam offering ungranted tools, the tool result never fed back, and the structured actions dropped on the way out.

**A test of mine was wrong and is left on the record.** The composition test expected `"words":9` for *"a lever is a rigid bar resting on a fulcrum"*. It is ten. Miscounting a short sentence by hand is precisely the failure this tool removes, and the author did it while writing the test for it.

**Outcome:**

760 worker (+5) + 175 + 71 (+5) + 50 + 26 green; all six workspaces build; worker **and API** rebuilt and restarted (intake changed), queue drained before measuring.

Live, mission `138bf70b`, submitted through the API to the deployed worker:

    contracts ever carrying a tool grant:  0  ->  1
    grant: text.count / compute / "reaches no network, filesystem or shell"

    seq 2509  action.invoked
      toolId       text.count
      grantId      action-138bf70b-1
      riskClass    compute
      outcome      ok
      resultDigest {"words":15,"characters":96,"sentences":2}

`ActionBroker` leaves `KNOWN_UNREACHABLE`, and the **anti-rot assertion is what forced it out** — the allowlist test failed the moment the broker gained a production caller. That is the check working rather than breaking.

**Two bounds, and a defect.** `EvidenceBundle.actions` carrying the structured record is proven by composition test, not live: on the live mission the one execution that completed took no action, and the attempt that acted produced a malformed deliverable. And the live run showed the agent using the tool **badly** — it passed its own draft *including the counts it had hallucinated* (`"20 words"`, `"*51 characters"`) as the text to measure, so `text.count` correctly counted 15 words over a string that was partly commentary about word counts. The mechanism is proven; the prompting is not. Logged as `a08e6fee` rather than smoothed over, with the note that it must not be fixed by putting examples in the prompt.
