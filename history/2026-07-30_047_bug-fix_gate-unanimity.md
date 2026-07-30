# 2026-07-30 · 047 · bug-fix · The gate must be repeatedly confident before it collapses a task graph

**What:** Fixed defect `890cdea5`. The decompose-or-delegate gate now requires **unanimity across three samples** to keep work whole; one dissent splits.

**How it was found:** not by looking for it. The iteration set out to measure R38 AC-0's clustering claim on a larger task graph, and chose a five-criterion mission precisely so capabilities could repeat. The mission contracted **zero** tasks — and the reason was a gate decision that contradicted its own reasoning:

> **DECISION: keep_whole** — *"The task consists of five independent descriptions of distinct objects. There is no shared reasoning or tight …"*

The prose argues for splitting. The boolean said the opposite. One agent took all five descriptions, bounced, escalated, and the mission **surrendered**.

**Why no schema catches this.** `keepWhole` is already the right polarity — a malformed answer fails toward splitting, which was a deliberate choice when the gate was built. This answer was well-formed and confident and wrong. Structure cannot rescue a confident wrong judgement; repetition can.

**The fix has precedent in this codebase**, which is why it was chosen over anything cleverer: the admission gate already **samples N times and requires unanimity** (`d678cd8c`) rather than trusting one call. `sampledDecompositionGate` applies the same guard to the decision that shapes the entire tree.

Three properties, each with a test:

- **Unanimity, not majority.** Splitting is the recoverable direction — a plan split too finely costs coordination; a plan wrongly kept whole hands a whole task graph to one agent. The asymmetry belongs in the vote.
- **A throwing sample is a dissent.** A call that failed did not vote to keep whole, and treating an error as assent would let a flaky backend collapse a task graph.
- **The dissenting rationale is the one recorded.** Reporting the majority's reasoning beside a split decision would make the trail explain something that did not happen.

**Verification.** 6 new tests; **270 worker tests green**, all suites green. Four mutants killed: majority vote instead of unanimity (3 tests), a throwing sample counting as assent (1), the majority's rationale reported beside a split (1), sampling disabled to one call (4).

**Live, before and after, on identical mission text:**

| | mission `8dd66596` (before) | mission `77b83c64` (after) |
|---|---|---|
| decision | keep_whole | **split** |
| rationale | "five independent descriptions… no shared reasoning" | "each tool is independent; a description of a hammer does not… constrain… a wrench" |
| tasks contracted | **0** | **5** |
| outcome | surrendered | ran |

The rationale and the decision now agree, which is exactly the property that was broken.

Cost recorded honestly: three evaluator calls per decomposition node instead of one, paid once per node rather than per task. That is the price of not collapsing a task graph on a coin flip.

## What this cost the original experiment, and what it revealed instead

R38 AC-0 is still unsatisfied, and the re-run gave **better** evidence than the first attempt. Five tasks produced five distinct designs, and this time the categories were unmistakably one capability:

```
Hand Tool Overview · Tool Identification & Description · Tool Description
Tool Identification & Instruction · Woodworking Tools
```

Every one is *describe a hand tool*. The earlier evidence (three unrelated subjects) left room to argue three designs was correct; this leaves none. Passive normalisation cannot merge categories the planner never named alike — and it will not name them alike, because it invents a fresh phrase per subtask. Defect `eee34306` updated with this sharper case: the Agent Creator must resolve each proposed category against capabilities the registry **already knows**, minting a new one only when nothing is close.

Two data points now stand for the delegated model-tiering ADR: gemma4:12b judged the gate correctly on the limerick and the whisk/colander pair, and wrongly on five hand tools — a 2-of-3 record on a decision severe enough to lose a whole mission.
