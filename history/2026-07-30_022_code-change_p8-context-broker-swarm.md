# 022 — P8: Context Broker & Worker Swarm

**Date:** 2026-07-30
**Category:** code-change
**Phase:** P8 (Tasktracker `2c1c8e8e-…`) · **Requirement:** R8

**What:** Built the Context Broker (the sole context channel), the `BrokeredFabric` that makes bypassing it impossible, and the specialist's restate-or-bounce entry path.

**Why:** R8, and invariant #6 — no peer chatter, every exchange logged.

**Details:**
- **The grant is the capability.** `BrokeredFabric.read` requires a grant id the broker issued *for that exact source*. So "don't bypass the broker" stops being a rule someone can forget and becomes a missing argument that fails at the call site. A policy that lives in a comment gets bypassed the first time somebody is in a hurry; a policy that lives in a type signature does not.
- A grant is a capability for **one source**, not a general key — proven by the distractor that a grant for `mission-brief` cannot read `commons:ev-adoption`.
- **Denials are logged, not just grants.** A silent refusal leaves no more of a trail than a silent permission, and the ledger is meant to be the complete record.
- Entitlement is checked against **this contract**, never a global allowlist.
- **The specialist validates that it was handed a `WorkerContractView`**, so P2.5's withholding guarantee is actually honoured rather than assumed — passing a full contract is refused.
- **Bouncing does no work.** "Bounce but try anyway" is guessing with a disclaimer attached, and the disclaimer is not what the parent needs.
- **A design smell in my own API, caught by the first test run:** `ContextBroker` originally took an *optional* fabric, so a broker could be built whose grants no fabric would ever honour — a working broker and a useless one were indistinguishable at the call site. Made it mandatory.

**Outcome:** TDD red→green. 72 worker tests, **162 repo-wide**, 29 integration, build + typecheck clean. Mutation-verified: dropping the grant/source binding failed exactly the right distractor, 71 still passing. Dogfooded with the broker fronting the real ledger (grant *and* denial both recorded) and a real model judging clarity.

**Finding that contradicted my own prediction — logged as a learning.** The clarity judge was run over the same clear/vague contract pair at three tiers:

```
qwen3.5:2b   CLEAR -> DELIVER    VAGUE -> BOUNCE     <- correct discrimination
qwen3.5:9b   CLEAR -> BOUNCE(2)  VAGUE -> BOUNCE(1)
gemma4:12b   CLEAR -> BOUNCE(3)  VAGUE -> BOUNCE(3)
```

I expected the opposite, since P5 showed a 2B reconciler producing incoherent prose. But **larger models are *more* prone to finding ambiguity**, and on a gate whose failure mode is "refuse to start", thoroughness reads as false bounces — a swarm wired at Tier 2 here would stall on perfectly executable work. So "smallest model possible" is not purely a cost argument: for some seams the small model is genuinely better suited, because the task rewards decisiveness over exhaustiveness. It also shows the `taskClass` taxonomy is too coarse — fold-up and the clarity gate are both "evaluative" yet want opposite directions.

The bounce rule is left as the honest reading of AC-3 rather than having a severity threshold invented for it; prompt calibration is the Learning Agent's remit (P11). And again: `qwen3.5:2b` bounced the clear contract in the dogfood and delivered it minutes later — defect `d678cd8c` once more. One sample per cell is not evidence.
