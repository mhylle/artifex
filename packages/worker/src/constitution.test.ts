/**
 * P4 — Constitution guards (R4 AC-2).
 *
 * The constitutional core is the part the Learning Agent may never rewrite
 * (invariant #4). Review independence is one of its clauses: a reviewer that is
 * the author is not a reviewer, and "one writes, another critiques" degenerates
 * the moment the critic is the same agent wearing a different prompt.
 */
import { describe, expect, it } from 'vitest';

import {
  ConstitutionViolation,
  assertReviewIndependence,
  checkReviewIndependence,
} from './constitution.js';
import type { ReviewAssignment } from './constitution.js';

function assignment(over: Partial<ReviewAssignment> = {}): ReviewAssignment {
  return {
    taskId: 'c0a8012e-9f43-4b6d-8e1a-2d7f6b5c4e39',
    blastRadius: 'high',
    worker: { agentId: 'agent-worker-1', provider: 'ollama', model: 'qwen3.5:2b' },
    reviewer: { agentId: 'agent-reviewer-1', provider: 'anthropic', model: 'claude-opus-5' },
    ...over,
  };
}

describe('R4 AC-2 — review independence', () => {
  it('rejects an assignment whose reviewer model equals its worker model', () => {
    const ruling = checkReviewIndependence(
      assignment({ reviewer: { agentId: 'agent-reviewer-1', provider: 'ollama', model: 'qwen3.5:2b' } }),
    );

    expect(ruling.permitted).toBe(false);
    expect(ruling.clause).toMatch(/independence/i);
  });

  it('throws a typed ConstitutionViolation when asserted', () => {
    expect(() =>
      assertReviewIndependence(
        assignment({ reviewer: { agentId: 'agent-reviewer-1', provider: 'ollama', model: 'qwen3.5:2b' } }),
      ),
    ).toThrow(ConstitutionViolation);
  });

  it('rejects self-review outright — the same agent cannot be both author and critic', () => {
    const ruling = checkReviewIndependence(
      assignment({
        blastRadius: 'low',
        reviewer: { agentId: 'agent-worker-1', provider: 'anthropic', model: 'claude-opus-5' },
      }),
    );

    expect(ruling.permitted).toBe(false);
  });

  it('DISTRACTOR: permits a genuinely independent assignment', () => {
    // Without this, "reject everything" would pass every test above.
    expect(checkReviewIndependence(assignment()).permitted).toBe(true);
  });

  it('permits model reuse at LOW blast radius — independence of AGENT still holds', () => {
    // Serves "smallest models possible": burning a frontier model to review a
    // trivial reversible task is waste, and invariant #7 makes effort a currency.
    // The agent is still a different agent; only the model is shared.
    const ruling = checkReviewIndependence(
      assignment({
        blastRadius: 'low',
        worker: { agentId: 'agent-worker-1', provider: 'ollama', model: 'qwen3.5:2b' },
        reviewer: { agentId: 'agent-reviewer-1', provider: 'ollama', model: 'qwen3.5:2b' },
      }),
    );

    expect(ruling.permitted).toBe(true);
  });

  it('DISTRACTOR: the low-blast allowance does NOT extend to medium or high', () => {
    for (const blastRadius of ['medium', 'high'] as const) {
      const ruling = checkReviewIndependence(
        assignment({
          blastRadius,
          worker: { agentId: 'agent-worker-1', provider: 'ollama', model: 'qwen3.5:2b' },
          reviewer: { agentId: 'agent-reviewer-1', provider: 'ollama', model: 'qwen3.5:2b' },
        }),
      );

      expect(ruling.permitted, `model reuse must be refused at ${blastRadius} blast radius`).toBe(
        false,
      );
    }
  });

  it('DISTRACTOR: self-review is refused even at low blast radius', () => {
    // The low-blast allowance is about the MODEL, never about the agent.
    const ruling = checkReviewIndependence(
      assignment({
        blastRadius: 'low',
        worker: { agentId: 'same-agent', provider: 'ollama', model: 'qwen3.5:2b' },
        reviewer: { agentId: 'same-agent', provider: 'ollama', model: 'qwen3.5:2b' },
      }),
    );

    expect(ruling.permitted).toBe(false);
  });
});
