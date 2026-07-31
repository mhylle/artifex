# 085 — R13 recorded as unsatisfied, and the reachability habit became a test

**Date:** 2026-07-31
**Category:** decision

**What:** Traced `ActionBroker` (R13, marked satisfied) to four independent missing links, returned R13 to `approved` with AC-0 un-satisfied (ADR-0015), and turned the caller-reachability habit into a test that fails on any exported class no other production file constructs.

**Why:** R13 was satisfied and its mechanism is correct — implemented, tested, and with six `action.*` events in the live ledger. It is also unreachable, and the ledger events are not evidence of the running system: they date from 2026-07-26 and 2026-07-30 and belong to missions with no `requestedBy`, produced by scripts that constructed the broker themselves. That is the P13 shape, where the dogfood passed 20/20 while `main()` was still a placeholder.

**Details:**

Four links, any one sufficient to make tool use impossible:

1. `packages/model-router` has no tool-calling support at all — zero occurrences of `tool` in its production sources, so an agent cannot emit an invocation.
2. `mission-intake.service.ts:146` hardcodes `inputs.toolEntitlements: []`; the orchestrator only copies the parent's entitlements down. Live contracts carrying a tool entitlement: 0.
3. `new ActionBroker` appears only in `action-broker.test.ts`; `runtime.ts` wires no tool seam.
4. `work.execute` has no path to a broker.

Meanwhile six production sites read `contract.inputs.toolEntitlements` and `reviewer.ts:450` fails a task that carried entitlements but produced no actions — the running system can penalise work for not using a broker it never provides.

Wiring was considered and rejected. Link 1 is a genuine feature, and R13's own scope note says it "touches sandboxing and credential handling — security is a deferred concern project-wide and this requirement does NOT lift that deferral." A real search tool is outbound network access from an agent, exactly what the deferred security work governs. Wiring a credential-free internal tool instead was rejected as a half-measure: it would make the reachability check green while link 1 still blocks the agent from asking, converting a visible gap into an invisible one.

AC-0 was un-satisfied because it is vacuously true — "every tool invocation by a swarm agent appends a ledger event … replaying the ledger reproduces the full set of actions taken" says nothing when no swarm agent can invoke. AC-1, AC-2 and AC-3 stay satisfied with their bounds stated in the ADR rather than implied.

**Outcome:**

`packages/worker/src/reachability.test.ts` now fails when an exported class has no reference from any other production file. The rule is deliberately narrow — classes only, `*Error` excluded — because a class exists to be instantiated, whereas a helper called only inside its own module is ordinary and flagging those would produce a list nobody reads. `ActionBroker` and `LearningProjection` are listed against defect `635b7a9f`, and a second assertion fails if a listed class ever becomes wired, so the allowlist cannot rot into a suppression list.

Six mutants, all killed: a brand-new unreachable class added to production (the case the test exists for); the allowlist entry removed; the scan widened to count test files, which is precisely how three requirements came to be marked satisfied; the `*Error` exclusion removed; a wired class left in the allowlist; and the scanner pointed at a nonexistent root, which every other assertion would have passed — the same silent-empty failure that made iteration 70's sweep report `staff` as uncalled.

695 worker + 160 + 66 + 50 + 26 green; all six workspaces build.

Recorded as friction rather than fixed: the doneness gate itself has no reachability pillar. Its four pillars cannot see whether the deployable process calls the code, which is how five unreachable mechanisms — three behind requirements marked satisfied — sat behind green pillars. The test is a local backstop; the gate needs the pillar.

Still open in `635b7a9f`: `LearningProjection` (R11, listed in the test) and `evaluateOnSealedBench` (R29, a function, deliberately outside the test's rule).
