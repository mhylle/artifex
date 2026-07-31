# 100 — The agent picks whether, not what — and two requirements were hiding from the gate

**Date:** 2026-07-31
**Category:** bug-fix

**What:** Defect `a08e6fee` resolved by measuring rather than by reasoning, and the measurement corrected the defect's own framing. Then, checking every requirement instead of trusting a green pillar, found **R30 and R39 sitting in `draft`** — invisible to the doneness gate, five unsatisfied ACs between them, while the acceptance-criteria pillar reported green.

**Why:** Iteration 85 shipped the Action Broker's first tool and logged one bad live invocation. One observation is one observation, so this iteration measured before touching it.

**Details:**

**The measurement, and the correction to my own claim.** Five `blastRadius: "medium"` missions with per-criterion length constraints:

    1. 138bf70b  "\"A lever pivots to multiply force\" \"*\" 20 words\n..."   polluted draft
    2. e3b18b27  "Inertia is ... Momentum measures ..."   38 words         whole draft, per-span criteria
    3. c11e8ce4  "Caption and Summary combined."          4 words          a LABEL, not content
    4. d73744da  "Brake Caliper: The main components ..." 170 words        draft-like content
    5. d73744da  "Front Brake System:\n1. Caliper ..."     91 words         draft-like content

The defect said "zero for three" — written from the first three calls. Rows 4 and 5 arrived afterwards and were fine. **The honest rate is two in five, and the smaller number is what went into the code comment, the test and the defect.**

**The fix does not rest on the rate.** The `text` field is gone from the model-facing schema; the seam always measures the draft. The argument is one this codebase already makes elsewhere: the Tier Policy *computes* a model rather than letting the designer choose one, because an agent that picked its own model "could buy itself a bigger one, which is the budget equivalent of grading your own homework." Choosing your own measurement subject is the same move. The agent still decides **whether** to measure; it no longer decides **what is measured**.

After the fix, four live invocations across two missions, all measuring the draft by construction. One exposed a *different* problem — mission `e54e39d8` drafted the literal template `{Label} | {One sentence descriptive note.}`, so the tool faithfully measured a placeholder. Bad draft, not bad measurement.

**Process note, recorded because it inverts the discipline.** The implementation went in before its tests this time, so the tests passed on first run and proved nothing by passing. Mutation closed the gap — both mutants fail — but mutation-after-the-fact is weaker than RED-first, and the order was wrong.

**Find-shape (o) refuted, by checking the generic path.** `action.invoked` / `action.denied` looked like ledger events no lens shows. The ledger explorer's family filter is **computed from the events themselves** (`[...new Set(events.map(e => e.family))]`), so `action` appears automatically. Verified in the real browser: the filter offered `action`, and selecting it rendered event #2509 with its full payload. No code change — a negative result from a working mechanism.

**Then the find that matters most.** With four of five pillars green and only the known drift-tooling limitation left, the loop's stop condition was nearly met. Checking every requirement rather than reading it off the pillar showed **R30 and R39 were `draft`** — and `getProjectDoneness` counts unsatisfied ACs only across *approved* requirements. Five ACs, none satisfied, and the pillar said green.

That is the `cd18baa0` shape occurring inside the gate built to catch it. This project's own preference says *"a deferral is only real once it is an unsatisfied requirement in the system of record"* — and R30/R39 **are** in the system of record, with dossier sources and a cited failure-mode study. `draft` kept them out of the arithmetic just as effectively as prose in a markdown file. Both moved to `approved`, which correctly turns the pillar red. Nothing about the code changed; the gate can now see what was always true.

**Outcome:**

762 worker (+2) + 175 + 71 + 54 + 26 green; all six workspaces build; worker restarted on the rebuilt code, queue drained before measuring.

Architecture drift returned to **stale 0, missing 0** by refreshing the `Mission Intake` component against what the file now contains — and the loop note that predicted the stale entry would be `runtime.ts` was itself wrong; it was `mission-intake.service.ts`, the file iteration 85 actually edited. The 6 orphaned entries remain the walker's blind spot.

R13's carried bound is **closed**: `EvidenceBundle.actions` now carries the structured record live. Mission `c11e8ce4` delivered with a `task.executed` whose `actions` array holds a full `ActionRecord`, its `viaBrokerGrantId` matching the `action.invoked` event's `grantId`.

**Bound carried forward:** a whole-draft count still cannot settle a criterion naming one span of a multi-part answer. Per-span measurement needs a way to identify the span that does not route through the model retyping it. Roadmapped, not smuggled in.
