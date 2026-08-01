/**
 * Triage for the attention queue (R18).
 *
 * Measured on the live stack: **61 items, 49 of them `amendment_ratification`**
 * — the Learning Agent petitioning the constitution. Only 9 were missions
 * actually stopped waiting for an answer, and the first blocking item rendered
 * *below* an advisory one. The queue was 80% the system talking to itself, and
 * the operator's own work was buried in it.
 *
 * The split is derived rather than preferred: R29 specifies amendment
 * ratification as **out-of-band** — it is not a rung on any mission's escalation
 * ladder, and no mission waits on it. Everything that *is* a ladder rung stops
 * work until a human answers.
 */
import { answerNote, partitionAttention, urgencyOf } from './attention-queue';
import type { AttentionItem } from './fleet';

function item(rung: string, taskId = 't-1'): AttentionItem {
  return {
    missionId: 'm-1', taskId, objective: 'o', rung, autonomyDial: 'checkpointed',
    findings: [], acceptanceCriteria: [], waitingSince: '2026-08-01T00:00:00.000Z',
  };
}

describe('urgencyOf', () => {
  it('treats the out-of-band ratification rung as advisory', () => {
    expect(urgencyOf('amendment_ratification')).toBe('advisory');
  });

  it('treats every rung on a mission escalation ladder as blocking', () => {
    // Anti-rot: these are the ladder rungs a contract can actually carry
    // (`escalationPolicy.ladder`) plus intake's own. If a rung is added to the
    // ladder and quietly lands in the advisory bucket, an operator stops being
    // told that work has stopped.
    for (const rung of [
      'intake_clarification',
      'human_review',
      'retry_higher_tier',
      'different_agent',
      'agent_redesign',
      're_decomposition',
      'assumption_became_load_bearing',
    ]) {
      expect(urgencyOf(rung), `${rung} was not treated as blocking`).toBe('blocking');
    }
  });

  it('DISTRACTOR: an UNKNOWN rung is blocking, not advisory', () => {
    // The safe direction. A rung this build has never seen might be the one
    // holding up the operator's mission; hiding it by default would make the
    // queue lie by omission — the failure the triage exists to fix, inverted.
    expect(urgencyOf('some_rung_added_next_year')).toBe('blocking');
  });
});

describe('partitionAttention', () => {
  it('separates the two, preserving order within each', () => {
    const items = [item('amendment_ratification', 'a'), item('intake_clarification', 'b'), item('amendment_ratification', 'c'), item('human_review', 'd')];

    const { blocking, advisory } = partitionAttention(items);

    expect(blocking.map((i) => i.taskId)).toEqual(['b', 'd']);
    expect(advisory.map((i) => i.taskId)).toEqual(['a', 'c']);
  });

  it('DISTRACTOR: every item lands in exactly one bucket', () => {
    // A partition, not two filters: an item dropped by both would vanish from
    // the operator's view entirely, which is worse than showing it in the
    // wrong one.
    const items = [item('amendment_ratification'), item('intake_clarification'), item('mystery_rung')];

    const { blocking, advisory } = partitionAttention(items);

    expect(blocking.length + advisory.length).toBe(items.length);
  });
});

describe('answerNote', () => {
  it('pairs each answer with the question it answers', () => {
    // The runtime records the note verbatim on `operator.decided`; nothing
    // parses it. So it has to read as an answer to a specific question when a
    // human opens the trail later, not as a wall of prose.
    const note = answerNote(
      ['Does "mutate" mean CRISPR or directed evolution?', 'Overview or lab SOP?'],
      ['Directed evolution.', 'Lab SOP.'],
    );

    expect(note).toContain('Does "mutate" mean CRISPR or directed evolution?');
    expect(note).toContain('Directed evolution.');
    expect(note).toContain('Overview or lab SOP?');
    expect(note).toContain('Lab SOP.');
    // The pairing must survive: answer 1 appears after question 1 and before question 2.
    expect(note.indexOf('Directed evolution.')).toBeGreaterThan(note.indexOf('CRISPR'));
    expect(note.indexOf('Directed evolution.')).toBeLessThan(note.indexOf('Overview or lab SOP?'));
  });

  it('omits questions the operator left blank rather than inventing an answer', () => {
    // A blank is not an answer. Recording "Q: ... A: " would put an empty
    // ruling on an append-only trail and read as though it had been addressed.
    const note = answerNote(['Answered?', 'Skipped?'], ['Yes.', '   ']);

    expect(note).toContain('Answered?');
    expect(note).not.toContain('Skipped?');
  });

  it('DISTRACTOR: answering nothing yields an empty note, not a shell of headings', () => {
    expect(answerNote(['A?', 'B?'], ['', ''])).toBe('');
  });

  it('DISTRACTOR: more questions than answers does not throw or mispair', () => {
    // The template renders one box per finding, but a stale array must not
    // shift every answer onto the wrong question.
    const note = answerNote(['First?', 'Second?', 'Third?'], ['one']);

    expect(note).toContain('First?');
    expect(note).toContain('one');
    expect(note).not.toContain('Second?');
  });
});
