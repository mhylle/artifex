# 113 — Full system reset: 170 development missions removed

**Date:** 2026-08-02
**Category:** configuration

**What:** At the owner's explicit request, every mission and everything derived from one was deleted from the local stack. **3,246 ledger events across 170 missions** are gone, along with 49 agent designs, 78 knowledge entries, 25 benchmark cases, 10 hot fixes and 2 decomposition templates. `model_catalog` was kept. The system is empty and verified working.

**Why:** ~170 missions had accumulated as development probes over the preceding iterations, making the fleet unreadable and the attention queue meaningless. The owner asked for a clean system.

**Details:**

**This is not a product operation, and there is deliberately no route, command or UI that performs it.** The ledger is append-only by three database triggers — `ledger_event_append_only`, `ledger_event_no_truncate`, `ledger_event_notify` — which exist precisely so that nothing in the running system can do what was asked. Wiping it meant deliberately standing those guards down. That is a dev-environment reset and nothing else.

**The scope question was asked before anything was deleted, because it was materially ambiguous.** "Remove all missions" could mean the ledger alone, which would have left 49 agent designs earned by missions that no longer exist and 78 knowledge-commons claims whose sources were gone — a system remembering things it could no longer justify. The owner chose the full reset.

**`model_catalog` was kept**, and keeping it turned out to be load-bearing rather than tidy: the worker resolves both model tiers at boot and cannot start without them. The boot log after the reset (`worker tier 1 -> ollama/qwen3.5:2b`, `evaluative tier 2 -> ollama/gemma4:12b`) is what proves the right rows survived.

**The guards were DISABLED, not dropped.** `ALTER TABLE ... DISABLE TRIGGER USER` leaves the definitions untouched, so a mistake could not silently lose invariant #1's enforcement — where a drop-and-recreate could have restored something subtly different, or nothing at all. The whole wipe ran in one transaction that would have rolled back as a unit.

**And the guard was proven working afterwards, behaviourally rather than by name.** Three triggers being listed says only that three triggers exist. The script appended a probe row, attempted an `UPDATE` on it, and required the attempt to be **rejected** before reporting success — then removed the probe row. A name is not a guarantee; a refused write is.

The BullMQ queue was obliterated too (162 completed jobs). Leaving it would have meant contracts on the queue capable of resurrecting missions the ledger no longer knew about.

**Outcome:**

    ledger_event            3246 -> 0        agent_design            49 -> 0
    knowledge_entry           78 -> 0        benchmark_case          18 -> 0
    benchmark_case_open        7 -> 0        hot_fix                 10 -> 0
    decomposition_template     2 -> 0        model_catalog            3 -> 3  (kept)

    append-only guard rejects an UPDATE: YES

Worker and API restarted against the empty database; `GET /missions` and `GET /missions/attention` both return `[]`; Mission Control shows `Needs you 0 · Missions 0` with no error.

**One stale message this surfaced.** The empty rail read *"No missions yet — start one below"*, which had been true until the left pane was tabbed the day before and the intake form moved onto its own tab. Nobody had seen it because the fleet had never been empty since. Now it is a link that opens the New tab — find-shape (h), a message that was true when written.

**The reset scripts were deleted rather than committed.** A wipe-everything script sitting in the repo is a loaded gun that bypasses invariant #1 by design, and this project's discipline is not to leave guards weakened for convenience. What was done is recorded here instead. If a reusable reset is ever wanted, that is a deliberate decision to take on its own terms.
