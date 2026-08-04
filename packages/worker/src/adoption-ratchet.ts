/**
 * The join between the science loop's verdict and R28's ratchet.
 *
 * `AssetRegistryRepository.proposeDelta` implements earned permanence — score
 * and simplicity against the incumbent, one delta at a time under a row lock,
 * every outcome written to `agent_design_delta` whether it adopts or reverts.
 * It was complete, correct, and **called by nothing outside its own tests**.
 *
 * So the worker mined weak spots, generated hot-fix candidates, ran them
 * against the bench, judged them on a held-out slice, appended
 * `learning.candidate_evaluated` — and then dropped the result. A measured win
 * never reached the registry, `agent_design_delta` was empty after every
 * mission, and no design had ever been improved by evidence. Find-shape (l).
 *
 * This module is the missing map: a hot-fix already names the asset it patches
 * and the value it patches it to, and the bench already produced the score, so
 * nothing needs to be invented — only carried across.
 *
 * **Two gates, deliberately.** The science loop asks "did this candidate beat
 * its bench?"; the ratchet asks "does it beat the INCUMBENT, and is it not more
 * complicated?" — different questions against different baselines. Only adopted
 * candidates are proposed, and the ratchet may still refuse one, which is why
 * the delta table records reverted rows too.
 */

/** What the science loop concluded — `AdoptionDecision`, structurally. */
export interface CandidateVerdict {
  readonly adopt: boolean;
  readonly evidence: {
    readonly wins: number;
    readonly losses: number;
  };
}

/** The candidate itself — `HotFixRecord`, narrowed to what a delta needs. */
export interface PatchedAsset {
  readonly targetAssetId: string;
  readonly targetKind: string;
  readonly patchedValue: string;
}

/** A `DeltaProposal`, declared locally so the worker does not re-export the fabric's shape. */
export interface RatchetProposal {
  readonly designId: string;
  readonly changes: readonly { readonly field: 'roleInstructions' | 'capabilities'; readonly to: string }[];
  readonly justifiedBy: readonly string[];
  readonly candidateScore: number;
}

/**
 * Which registry field a hot-fix target moves, or `undefined` if none does.
 *
 * The fast loop patches `role_instructions` today. A kind with no field here is
 * refused rather than mapped onto the nearest one: the ratchet writes whatever
 * it is handed straight into the design, so a wrong mapping would silently
 * overwrite a design's instructions with a playbook step.
 */
const FIELD_OF_KIND: Readonly<Record<string, 'roleInstructions' | 'capabilities'>> = {
  role_instructions: 'roleInstructions',
};

export function deltaProposalFor(
  verdict: CandidateVerdict,
  patch: PatchedAsset,
  justifiedBy: readonly string[],
): RatchetProposal | null {
  // The science loop's own gate. A candidate it rejected is a measurement, not
  // a proposal, and re-judging it here would give a losing candidate a second
  // chance against a different baseline.
  if (!verdict.adopt) return null;

  const field = FIELD_OF_KIND[patch.targetKind];
  if (field === undefined) return null;

  // "Only measured wins enter" is the registry's rule and it throws to enforce
  // it. Checked here too so the caller gets a skip rather than an exception
  // inside a mission's completion path.
  if (justifiedBy.length === 0) return null;

  const runs = verdict.evidence.wins + verdict.evidence.losses;
  // A candidate adopted having run nothing would divide by zero and propose
  // `NaN`, which passes the registry's `< 0 || > 1` range check — NaN compares
  // false to both — and lands in the table as a null score.
  if (runs === 0) return null;

  return {
    designId: patch.targetAssetId,
    changes: [{ field, to: patch.patchedValue }],
    justifiedBy: [...justifiedBy],
    // A RATE, not a tally: the registry requires 0..1 and compares it against
    // the incumbent's clade score, which is also a rate.
    candidateScore: verdict.evidence.wins / runs,
  };
}
