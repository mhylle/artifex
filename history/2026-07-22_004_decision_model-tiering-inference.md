**What:** Completed the technical/model pass — resolved the four items ADR-0001 deferred. Recorded as ADR-0002 and a frozen Tasktracker brainstorm.

**Why:** ADR-0001 locked the stack but left open how models are chosen, which local models to run, how to serve them, and whether the Learning science loop is later Python. These block v0 planning.

**Details (all locked):**
- **Tier policy:** model tier is *computed per staffing decision* from blast radius + fan-in + reversibility + task class + budget + clade score — not a per-agent constant. **4-tier ladder** (Tier-0 no-LLM → Tier-1 local small → Tier-2 ~32B quantized → Tier-3 frontier/Claude). Tier-bump = a rung in the existing escalation ladder; tier choice logged as a ledger event. Owner's "only decomposition is large" is the Tier-3 root special case.
- **Budget vs blast radius:** governed by the per-mission **autonomy dial** (high-autonomy may downgrade with a loud log; supervised = hard floor + human escalation).
- **Local model declaration:** manifest → logical tier → versioned **Model Catalog** (Postgres). v0 workhorse **Qwen2.5-family** (replaceable, admission-gated on real contract/evidence schemas).
- **Serving:** Ollama (dev) → vLLM (staging/prod) behind the OpenAI-compatible router; migrate via config + load/contract-test gate. Engine choice deferred to the staging rung (default vLLM).
- **Learning seam:** science loop in **TS now** behind a ledger-projection + proposal-emitter; Python extraction only "when it hurts". Physical boundary enforces "no judge inside the learner's write scope".
- **Owner hardware:** single **24 GB GPU** → prod fan-out will need cloud/multi-GPU vLLM (parking-lot constraint).
- Artifacts: `docs/decisions/ADR-0002-model-tiering-and-inference.md`; patched ADR-0001's open list to point at it; Tasktracker brainstorm `9885e5b0` (5 docs, 6 decision records) frozen.

**Outcome:** Technical pass complete; project is ready for v0 planning. Remaining pre-code TODOs: name the project; then `tt-create-plan` for the v0 slice (recommended to start from the ledger + contract schemas, the shared-types foundation).
