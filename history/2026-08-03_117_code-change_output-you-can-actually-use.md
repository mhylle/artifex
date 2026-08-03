# 117 — Output you can actually use

**Date:** 2026-08-03
**Category:** code-change

**What:** The owner asked the right question — *"would anyone be able to do anything real with the output of the system?"* — about a mission that answered "3 algorithms and a report describing them" with a single paragraph. The answer was **no**, and it was not primarily a UI problem. The deliverable schema could not hold a report, and the facts that would have revealed why were on the trail and rendered nowhere. Both are fixed and proven live.

**Details:**

**Measured before building anything.** The ledger held nothing the screen was hiding. The whole deliverable was `{ answer: "…" }`, one paragraph, and the trail said why:

    effortSpent: 2   ceiling: 20      (10% of the commissioned budget)
    actions: []                       (no tools run)
    consulted: []                     (no sources)
    gate_b: pass, findings: [], redFlags: []
    assumptions: ["This task requires the creation of algorithms rather than
                  factual descriptions.", …]

That last line is the worker saying it had read the task as something other than what was asked — recorded, and visible in no lens.

**Fault 1 — the seam could not express the work.** `AnswerSchema` was `{ answer: string }`. A single string field cannot hold a report, so **no prompt could have produced one**. Find-shape (f): a seam whose shape cannot work. It now carries optional `sections` (heading + body), and the prompt tells the worker to match depth to what the criteria ask for — a judgement, not a keyword match.

`sections` is optional deliberately. The codebase already documents JSON leakage on wider schemas for tier-1 models, so this must degrade to today's behaviour rather than fail; and most tasks are a sentence, where forcing headings onto "why does ice float" would be worse than the gap being fixed.

**Fault 2 — no lens showed how the work was produced.** A deliverable on its own is a claim. `buildMissionEvidence` now projects effort against the commissioned budget, tools run, sources consulted, the reviewer's verdict and findings, and what the worker declared it assumed. A zero is styled as a finding rather than as missing data, because "used no tools and consulted nothing" is exactly what separates a researched answer from a recalled one.

**Fault 3 — two more projections drew a superseded plan.** Entry 116 fixed `buildMissionTree`; the workforce and timeline lenses each fold `task.contracted` for themselves and still drew the rejected tree. Rather than a third inline copy, `sinceLastRestatement` is now one rule in one place — find-shape (b), a rule implemented at one site while its siblings ignore it.

**Fault 4 — rejected work was labelled "Delivered".** Showing what a surrendered mission produced is right, since an operator cannot judge what they cannot see. Calling it delivered is not: Gate B refused that output. The heading now reads *"Produced, but not accepted"*.

**Outcome:**

825 worker + **250** dashboard (+16) + 58 api + 71 + 54 + 26 green; all six workspaces build.

**Proven live, end to end, on a fresh mission** — *"Produce a short report on three algorithms used in stem cell research"*, criteria requiring three named algorithms each with its own section:

- intake raised two genuine questions (computational vs wet-lab; scope), answered through the cockpit
- the worker produced **3 sections of 500+ characters each** — the schema fix working
- **Gate B failed it twice**, correctly: *"confuses 'technologies' or 'methodologies' with 'algorithms'"*
- the ladder climbed **tier 1 → tier 2 → re-decomposition → human_review**
- the mission surrendered rather than deliver work that did not meet the criteria

**That last point matters more than it looks.** The system refused to ship weak work and said exactly why. What the owner saw before — a paragraph passing review — was not the normal case; it was a vaguer criterion getting a lenient verdict. With a criterion that says what it wants, Gate B holds the line.

**What is still not good enough, stated plainly.** The tier-1 model produces markdown artefacts in headings (`**1.** Single Cell Analysis**`) and confuses methodology with algorithm. That is a model-quality problem, not a design one, and no amount of UI work fixes it. The system's own response — escalate, then stop and ask a human — is the correct behaviour, and the operator can now see all of it: the work, the verdict, the reasoning, and the budget that went unspent.
