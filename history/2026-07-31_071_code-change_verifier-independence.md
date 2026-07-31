# 2026-07-31 · 071 · code-change · The verifier becomes a staffed entity — R35 AC-2, refused live

**What:** Gate B's judge was a bare model call with `reviewerId` set to the mission id, so the constitutional rule "a verifier never shares design lineage with what it verifies" had nothing to rule on. Verifiers are now staffed designs, lineage overlap is refused, and both halves were proven on the live system. R35 AC-2 satisfied; defect `bc191e55` resolved.

**Two things had to become true first**, which is why this waited. The criterion says "*when staffing occurs*", so a verifier has to be staffed rather than conjured. And the lineage half needs designs that actually have ancestors — only true since R28's `agent_redesign` rung began setting `parent_design_id` (0 rows before that).

**A new query, not a duplicate.** `ancestorsOf` walks the same edges as `cladeScoreFor` but returns the member IDs; the clade query returns a weighted mean. Different question, so I checked before adding rather than assuming.

**Verifiers bid in their own market.** `verification.<capability>` is deliberately distinct from the producer's capability: sharing one would have the registry hand the same design to both, making a violation the *normal* case and quietly turning the check into "never reuse".

**The refusal is a rule, not a log line.** A bid sharing lineage is discarded and a fresh design authored; if even that would collide, staffing throws a `ConstitutionViolation`. A mutant that logged the violation and staffed the bid anyway was killed by two tests.

**A mutant caught what review didn't:** registering the fresh verifier with `parentDesignId: producerDesignId` passed all 561 tests. It would record exactly the lineage the function exists to rule out — and the damage is delayed and self-inflicted, because the next staffing reads that ancestry back, refuses the verifier it just created, and authors another. A refusal loop that looks like the rule working.

**And the live system caught what the mutants didn't.** Planting shared lineage to force a refusal produced `verifier.unstaffed` — not the independent replacement that refusing is *for*. `designIdForCapability` is deterministic per capability, so the "fresh" design derived the **same id as the bid just refused**, was therefore the same design, violated too, and staffing failed. The earlier "a refusal still yields a usable verifier" test passed throughout, because its refused bid and its derived id happened to be different strings — the case winning for a different reason than the one asserted. Fixed by deriving from the producer on a refusal, mirroring R28's `#redesign-of-` id: still deterministic, so a replay is faithful, but distinct from what it replaces.

Then a second correction, this one to the test: my `deriveDesignId` stub returned a constant regardless of input, so both branches produced the same id no matter what the implementation did and the test could never go green. Made it a real hash of its argument, and said so in the file.

**Live evidence, both clauses.**

| mission | what it proves |
|---|---|
| `f64308b1` | `verifier.staffed` design `2a3f2861`, distinct from producer `6e25f754`; the verdict's `reviewerId` is the verifier's design, not the mission id |
| `1139beb8` | with shared lineage planted, the refusal fires — and exposed the id collision above |
| `2439fba8` | after the fix: bid `2a3f2861` **refused** with its reason recorded, independent verifier `7a983cfe` staffed as an origin, verdict names it |

The shared lineage was **planted** for the falsification and **reverted afterwards** — a fabricated parent edge would otherwise feed false ancestry into every later clade score. The ledger events remain a truthful record of what was observed while it stood.

**Verification.** 13 new worker tests + 4 new integration tests; 6 mutants run, 5 killed immediately and the sixth after adding the origin distractor. 568 worker + 139 memory-fabric integration + 156 + 66 + 50 + 26 green, full workspace build, real processes restarted, four live missions.

**Outcome:** R35 AC-0 and AC-2 satisfied. **AC-1 remains open** (`2eeef21f`): the probe mechanism `probeMisses` is built and tested, and nothing plants a probe, so rubber-stamping is still unmeasured. P35 stays open until it is.
