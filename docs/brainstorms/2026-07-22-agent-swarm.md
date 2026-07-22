# Brainstorm: SWARM — Self-Assembling Agent Swarm

**Date**: 2026-07-22
**Status**: Ready for Planning

## Executive Summary

SWARM is a self-assembling, self-improving agent system: a permanent four-agent meta-layer (Orchestrator, Agent Creator, Reviewer, Learning Agent) that atomizes any mission into thousands of contracted, individually verifiable tasks, conjures the minimal specialist workforce at runtime, verifies every task at both ends (atomicity before execution, contract compliance after), folds results back up the decomposition tree, and mines a universal audit trail to improve itself — with full self-modification bounded only by a small immutable constitution guarding how success is measured.

## Idea Evolution

### Original Concept (Martin's words, condensed)

Orchestrator takes a task, splits it into minimal tasks — hundreds if not thousands. The new element: an agent creator agent designs specialized agents on the fly (writes their system prompts), categorizing tasks so 1000 tasks don't produce 1000 agents. Always an orchestrator, agent creator, and reviewer verifying satisfactory completion. Plus a learning agent inspired by Karpathy's autoresearch — all agents leave an audit trail used to improve the system over time. Functional first; think BIG; no tech/LLM/security/performance thinking yet. Outcome: functional solution description as HTML documents with CSS graphs and diagrams.

### Refined Understanding

The system crystallized as an *institution* rather than a pipeline: a domain-neutral meta-layer whose only built-in competence is organizing work, with all domain expertise manufactured on demand and retained only when it earns its place. Verification became dual-ended (the task graph itself is a reviewable artifact). Learning became two-speed and constitutional. Economics (effort budgets) and honest surrender became first-class functional concepts.

### Key Clarifications Made (4 Socratic rounds, 16 decisions)

1. **Mission scope**: truly domain-neutral — no anchor domain; expertise is conjured.
2. **Why atomize**: quality via focus, verifiability, parallelism, learning granularity — plus Martin's sharpening: atomicity is itself a *verifiable property* (one task, verifiable as atomic before execution and as complete after).
3. **Integration**: recursive fold-up — each parent assembles its children; the tree in reverse.
4. **Done criteria**: born with the task — contracts written at decomposition time; Reviewer checks the contract.
5. **Failure loop**: escalation ladder (feedback-retry → different agent → redesign → re-decompose → human/surrender), every rung logged, entry rung chosen by error class.
6. **Agent permanence**: earned — ephemeral by default, promoted on evidence, down-weighted never deleted.
7. **Learning depth**: full self-modification **within a constitutional core** (amended in round 5 after research evidence).
8. **Human role**: autonomy dial per mission + escalation rules.
9. **Knowledge**: earned knowledge commons — provenance, quarantine, expiry.
10. **Concurrency**: instance per mission, shared brain.
11. **Topology**: contracts + mediated context broker; no peer chatter.
12. **Learning cadence**: two-speed — bounded inline hot-fixes + between-mission science loop.
13. **Intake**: contract-first; the mission is task zero.
14. **Economics**: budgeted swarm — floors and ceilings; value-per-effort as fitness.
15. **Surrender**: first-class outcome with dossier (partial results, blockers, what-it-would-take).
16. **Doc format**: multi-page HTML suite.

## Analysis Results

### Strengths (Yellow Hat)

- **The atomize-and-verify thesis has an existence proof**: MAKER solved 1,048,575 dependent steps with zero errors via maximal decomposition + per-step voting; verification cost grows only ~logarithmically per step (arXiv:2511.09030).
- **Compounding asset**: the library + commons + playbooks grow with use; Voyager's ablation shows capability plateaus *without* a skill library (15.3× faster milestones with one).
- **Contract-first targets the measured top killers**: specification failures (44%) and weak verification (24%) dominate the MAST failure taxonomy; objective-level verification alone measured +15.6%.
- **The audit trail doubles as a regression suite** (replay benchmarks) and enables root-cause-targeted recovery (+26% in AgentDebug).
- **Domain-neutrality is coherent** because the meta-layer's competence (organizing work) genuinely is domain-free; HTN-style decomposition templates become learnable assets.

### Risks & Concerns (Black Hat + Premortem)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Learner games the yardstick | Med | Critical | Constitution; sealed benchmarks; propose-only amendments |
| Verification rubber-stamping | High | High | Two-tier review; calibration probes; red-flagging; depth by blast radius |
| Error cascades through fold-up | Med | High | Per-task gates; redundant runs on high-fan-in tasks; consistency requirement |
| Specification garbage at scale | High | High | Contract-first intake; Gate A; bounce-back; templates |
| Over-decomposition of sequential work | Med | Med | Decompose-vs-delegate gate (splitting entangled work measures −39…−70%) |
| Cost explosion (15× token multiplier) | High | Med | Budget floors/ceilings; reuse-first; value-per-effort fitness |
| Library rot / lucky promotions | Med | Med | Clade scores; probation; Pareto sets; delta edits; down-weighting |
| Commons poisoning / staleness | Med | High | Provenance; quarantine; independent re-derivation; expiry |
| Stall loops & surrender misuse | Med | Med | Stopping conditions as contract fields; stall counters; no-bid early surrender |
| Learning from noise | Med | Med | Pre-registered metrics; replication; transfer tests; auto-revert |

### Gaps Identified

- [ ] **Cold start** — first missions have no library/templates/benchmarks. Suggested: a designed bootstrap era where early missions double as institution-building; possibly seeded templates.
- [ ] **Sealed-bench seeding** — the constitutional benchmark vault needs initial verified missions. Suggested: human-curated at first.
- [ ] **Human ratification bandwidth** — the dial's human becomes bottleneck/rubber-stamp risk. Suggested: design the ratification workload + tooling explicitly.
- [ ] **Taxonomy governance** — category drift vs. clade-history continuity. Suggested: explicit split/merge/retire rules with lineage mapping.

### Enhancement Opportunities (SCAMPER)

- **Substitute**: single Reviewer → a review *institution* (meta-reviewer + conjured specialist verifiers + mechanical certification).
- **Combine**: audit trail + library + commons = one provenance-linked memory fabric with three distinct rulebooks (evidence / earned capability / earned knowledge — Karpathy's ledger/ratchet/telemetry separation).
- **Adapt**: HTN methods → learnable decomposition templates; Contract Net Protocol → bidding + no-bid staffing; Magentic-One ledgers + stall counter → mission ledger + escalation triggers; Relari pre/path/postconditions → contract anatomy.
- **Modify (magnify)**: the ratchet — one atomic delta per adoption, revert-by-default, simplicity tie-breaker.
- **Put to other use**: audit trail as replay benchmark suite; surrender dossiers as a capability-gap roadmap; library as exportable product.
- **Eliminate**: free agent chatter; wholesale rewrites; global broadcasts; unbounded inline learning.
- **Reverse**: review the decomposition *before* execution (Gate A); detect impossibility *pre-execution* via no-bids; workers pull versioned assets at spawn rather than learner pushing mid-flight.

### Premortem Findings (condensed)

- Metrics green / output garbage → sealed bench + calibration probes + constitutional metrics.
- Beautiful org chart, no value → delegate-whole gate + meta-work budget ceilings + value-per-effort vs. baseline.
- One hallucination spread everywhere → quarantine + re-derivation + expiry + traceable provenance.
- Never finished, never admitted it → stopping conditions + stall counters + surrender thresholds.
- Drowned in the audit trail → structure at write time (typed events, error classes, criterion ids).
- Library of lucky auditions → clade scoring + continuous re-earning + Pareto diversity.

## Structured Concept

### Component 1: Mission Intake
Contract-first dialogue producing task zero (success criteria, boundaries, autonomy dial, budget). Ambiguity surfaced, never silently assumed.

### Component 2: Orchestrator
Recursive decomposition via templates; contract authoring with pinned cross-cutting decisions; decompose-vs-delegate gate; mission ledger; escalation governance; fold-up assembly; surrender decisions.

### Component 3: Agent Creator
Task categorization; reuse-first staffing via library search/bidding; design from typed building blocks on no-bid; capability manifests + validation harnesses; effort-scaling; staffs verifiers under independence rules.

### Component 4: Reviewer (institution)
Gate A (atomicity/decomposition audit) and Gate B (mechanical + semantic completion review); verification depth by blast radius; red-flagging; structured immutable verdicts; self-calibration with planted probes.

### Component 5: Worker Swarm + Context Broker
Ephemeral contract-scoped specialists (restate-or-bounce; evidence bundles); broker as sole context channel, entitlement-filtered, fully logged.

### Component 6: Memory Fabric
Audit Ledger (append-only, everything); Asset Registry (ratchet, versioned deltas, clade scores); Knowledge Commons (earned, provenanced, mortal).

### Component 7: Learning Agent
Fast loop (bounded worker-layer hot-fixes, auto-revert) + science loop (mine → hypothesize → experiment on replay benchmarks → replicate/transfer-test → ratchet adoption → monitor); curates registry and commons; petitions for constitutional amendments.

### Component 8: The Constitution
Immutable: metric definitions, review independence, ledger integrity, budget enforcement, the amendment protocol. Amendments: evidence-argued petitions → sealed-bench evaluation → out-of-band ratification per dial.

## Research Findings

### External Best Practices (key sources)

- Karpathy autoresearch (github.com/karpathy/autoresearch): frozen-harness split, ledger vs. ratchet, revert-by-default, fixed experiment budgets, history-conditioned hypotheses, transfer-testing. Non-transfers: single god-metric, NEVER-STOP autonomy, greedy-only search, zero noise statistics.
- MAKER (arXiv:2511.09030): million-step zero-error via micro-decomposition + first-to-ahead-by-k voting + red-flagging.
- MAST (arXiv:2503.13657): failure distribution ≈44/32/24; verification presence ≠ verification.
- Google/MIT scaling study (arXiv:2512.08296): 17.2× error amplification unvalidated fan-out; 4.4× centralized; −39…−70% on sequential work; >45% single-agent baseline → adding agents hurts.
- ADAS (2408.08435), AFlow (2410.10762): meta-agents designing agents; typed operators beat freeform.
- Voyager (2305.16291), AWM (2409.07429): earned skill libraries; mine workflows from successful trajectories only.
- HGM (2510.21614): promote on clade metaproductivity, not auditions. GEPA (2507.19457): Pareto sets; reflective learning 35× more sample-efficient. ACE (2510.04618): delta edits prevent context collapse.
- DGM (sakana.ai/dgm), METR, STOP: self-modifiers sabotage evaluators; visibility drives gaming 43×; sandbox flags get bypassed → constitution + sealed evals.
- AgentPoison/PoisonedRAG/MINJA: knowledge stores poisoned at <0.1% rates via normal interaction → commons admission control.
- Anthropic multi-agent blog; Magentic-One; Cognition "Don't Build Multi-Agents"; Relari agent contracts; τ-bench pass^k.

### Anti-Patterns to Avoid

Judge inside learner's write scope; visible scorers; blind retries; monolithic rewrites; single-champion libraries; free chatter; unbounded spawn; lucky passes gating subtrees; silent capping.

## Architectural Decisions

No ADR directory exists yet; the 16 decisions are recorded in the table above and in the HTML dossier (index page). Suggest converting decisions 1–15 into ADRs when the project repo is initialized.

## Addendum (same day): Observability — decisions 16–18

Martin elevated observability to a key system property: not just fuel for self-learning, but a highly visual dashboard (n8n-inspired) showing running agents and task progress. Clarified and locked:

16. **Control**: mission control is a cockpit, not a window — approve escalations, answer clarifications, pause/resume/cancel subtrees, budget grants, mid-flight dial changes; every human act is written back as a first-class ledger event (symmetry rule).
17. **Replay**: live + time-travel — the append-only ledger makes any past dashboard state reconstructable; supports post-mortems, before/after diffs of learning adoptions, and replayable delivery pedigree.
18. **Audiences**: all three — operator mission control (full canvas/lenses/cockpit), requester progress view (contract-level progress, questions addressed to them, assumptions, budget), learning observatory (experiments, ratchet adoptions/reverts, library/commons health; read-only).

Design principles added: the dashboard is *a view, never a second truth* (renders ledger events only, persists nothing); *every pixel is drillable* (two clicks to raw events); five lenses over one substrate (canvas, workforce, timeline, learning observatory, ledger explorer); attention queue as the single home of everything waiting on a human. New chapter `solution/observability.html` (with a full mission-control dashboard mock); Risks gains a "dashboard drift" register row; dossier bumped to v1.1.

## Recommended Next Steps

1. **Tabletop walkthrough**: trace one concrete mission through the dossier by hand; fix what creaks.
2. **Define the v0 slice**: smallest build that exercises the whole loop (decompose → contract → conjure → verify → fold → learn).
3. **Design the cold-start era** (library/bench seeding).
4. **Then** the technical + non-functional pass (explicitly deferred here).

## Ready for Create-Plan

**Yes.**

### Suggested Plan Scope

Primary deliverables: v0 slice definition; ledger event schema (the foundation everything feeds); contract schema; minimal meta-agent playbooks. Key phases: tabletop validation → v0 → bootstrap era → learning loop activation. Critical success factors: per-clause compliance measurement from day one; constitution enforced from the first mission, not retrofitted.
