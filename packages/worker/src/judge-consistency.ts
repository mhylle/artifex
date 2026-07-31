/**
 * Judges that argue against their own verdict (defect `627cd71c`).
 *
 * A structured field says one thing and the rationale beside it says the
 * opposite. Seen three times in production wording: Gate A's plan audit flagging
 * a criterion untestable with a detail reading "The criterion is TESTABLE"
 * (`627cd71c`); the clarity judge returning "there are none found; this task is
 * clear" AS an ambiguity (`f720938a`); the decompose gate returning `keep_whole`
 * with a rationale arguing for splitting (`890cdea5`).
 *
 * ADR-0010's unanimity sampling cannot catch this. It requires all samples to
 * agree before rejecting, and a model that fills the boolean the same wrong way
 * every time agrees with itself perfectly — sampling catches an UNRELIABLE
 * judge, not a CONSISTENT one. R35's probes measure the reviewer after a
 * mission; this one kills a mission at planning time.
 *
 * So the check is deterministic and model-free, the same "mechanical tier"
 * reasoning R34 used for Gate B turned on the judge itself.
 */

/**
 * Sentence-ending punctuation, or the end of the string.
 *
 * Scoped per SENTENCE rather than per detail on purpose: a judge that writes
 * "The task is not atomic. The criterion is testable." is still contradicting
 * itself, and scanning the whole string for a negation would excuse the real
 * case whenever the model hedged about something else.
 */
const SENTENCES = /[^.!?]+[.!?]*/g;

/**
 * Words that turn a mention of testability into something OTHER than a claim
 * that it is testable.
 *
 * Two families, and both matter:
 *   negation    — "is not testable", "isn't testable"
 *   condition   — "testable ONLY IF the format is defined", "WOULD be testable"
 *
 * The conditional family is the important one. A judge explaining what would
 * make a criterion testable is doing exactly the useful form of this finding,
 * and a check that discarded those would delete the most helpful verdicts the
 * gate produces.
 */
const QUALIFIER = /\b(not|n't|never|unless|only if|if\b|would|could|should|might|once|when|until|assuming|provided)\b/i;

/** An unqualified claim that the thing IS testable. */
const AFFIRMS = /\b(is|are|it's|its)\s+(clearly\s+|plainly\s+|indeed\s+)?testable\b/i;

/**
 * Does this detail assert that the criterion IS testable? (defect `627cd71c`)
 *
 * Deliberately narrow. It answers one question about one word, because the
 * general form — "does this prose support this boolean" — needs a model, and a
 * model is the thing that was wrong in the first place.
 *
 * Restricted to TESTABILITY rather than any positive adjective: a check that
 * fired on "is clear" would misread the clarity judge's own vocabulary and start
 * discarding findings it has no business touching.
 */
export function affirmsTestability(detail: string): boolean {
  const sentences = detail.match(SENTENCES) ?? [];

  return sentences.some((sentence) => {
    if (!AFFIRMS.test(sentence)) return false;
    // A qualifier anywhere in the SAME sentence turns the claim into a
    // condition, and a condition is not an affirmation.
    return !QUALIFIER.test(sentence);
  });
}
