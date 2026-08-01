/**
 * Triage for the attention queue (R18).
 *
 * Measured on the live stack: **61 items, 49 of them `amendment_ratification`**.
 * Only 9 were missions actually stopped waiting for an answer, and the first
 * blocking item rendered *below* an advisory one. The queue was 80% the system
 * talking to itself, and the operator's own work was buried in it.
 *
 * The split is derived, not preferred. R29 specifies amendment ratification as
 * **out-of-band**: it is not a rung on any mission's escalation ladder, and no
 * mission is stopped waiting for it. Every rung that IS on a ladder has stopped
 * work until a human answers.
 */
import type { AttentionItem } from './fleet';

export type AttentionUrgency = 'blocking' | 'advisory';

/**
 * Rungs that stop nothing.
 *
 * A set rather than a predicate over the item, because nothing on the item
 * itself distinguishes these: an amendment petition carries a `taskId` like any
 * other row (it is the petition's id, not a task in the mission's tree), so
 * there is no structural signal to read. The rung is the vocabulary for "what
 * kind of thing is waiting", and this is the one kind that waits on nobody.
 */
const OUT_OF_BAND_RUNGS: ReadonlySet<string> = new Set(['amendment_ratification']);

/**
 * Does this item have work stopped behind it?
 *
 * **Unknown rungs are blocking.** That is the safe direction: a rung this build
 * has never seen might be the one holding up the operator's mission, and hiding
 * it by default would make the queue lie by omission — the very failure this
 * triage exists to fix, inverted.
 */
export function urgencyOf(rung: string): AttentionUrgency {
  return OUT_OF_BAND_RUNGS.has(rung) ? 'advisory' : 'blocking';
}

/** Split the queue in two. A partition — every item lands in exactly one side. */
export function partitionAttention(items: readonly AttentionItem[]): {
  readonly blocking: readonly AttentionItem[];
  readonly advisory: readonly AttentionItem[];
} {
  const blocking: AttentionItem[] = [];
  const advisory: AttentionItem[] = [];
  for (const item of items) {
    (urgencyOf(item.rung) === 'advisory' ? advisory : blocking).push(item);
  }
  return { blocking, advisory };
}

/**
 * Assemble the operator's answers into the note the runtime records.
 *
 * The note is what `operator.decided` carries, and nothing parses it — ADR-0023
 * is explicit that only the decision VALUE is inspected, never the prose. So
 * this exists to make the trail *readable by a human* who opens it later: an
 * answer that has drifted away from its question is worse than no answer,
 * because it looks like it was addressed.
 *
 * A blank is not an answer. An unanswered question is left out entirely rather
 * than recorded with an empty ruling beside it.
 */
export function answerNote(questions: readonly string[], answers: readonly string[]): string {
  const pairs: string[] = [];
  questions.forEach((question, i) => {
    const answer = (answers[i] ?? '').trim();
    if (answer === '') return;
    pairs.push(`Q: ${question}\nA: ${answer}`);
  });
  return pairs.join('\n\n');
}
