/**
 * The built-in tool implementations (R13).
 *
 * The catalogue that describes these lives in `@artifex/shared-types` so the
 * control plane can grant them without importing the worker; the behaviour lives
 * here, because running a tool is the runtime's job and the API must never be
 * able to.
 *
 * Every implementation is a pure function of its arguments. That is not a
 * simplification for now — it is what lets this ship while security stays
 * deferred (ADR-0020). The moment a tool reaches the network, a filesystem or a
 * shell, the sandboxing and credential work R13's scope note defers becomes a
 * prerequisite rather than a follow-up.
 */
import { TOOL_CATALOGUE } from '@artifex/shared-types';

import type { ToolDescriptor } from './action-broker.js';

/**
 * Count words, characters and sentences of supplied text.
 *
 * Words split on whitespace; sentences on terminal punctuation. Deliberately the
 * plain reading rather than a linguistic one — the criteria this serves are
 * written by people who mean "words" the way a word processor means it, and a
 * cleverer definition would disagree with the reader the agent is graded by.
 *
 * Throws on a missing or non-string `text`. The broker records a throwing tool
 * as `outcome: 'error'` with the message as its digest, so a malformed
 * invocation becomes evidence rather than a silent zero — which is what a
 * tolerant default would produce, and it would look exactly like an empty input.
 */
export function countText(args: Record<string, unknown>): {
  words: number;
  characters: number;
  sentences: number;
} {
  const text = args['text'];
  if (typeof text !== 'string') {
    throw new Error('text.count requires a string argument "text"');
  }
  const words = text.split(/\s+/u).filter((w) => w.length > 0);
  const sentences = text.split(/[.!?]+/u).filter((s) => s.trim().length > 0);
  return { words: words.length, characters: text.length, sentences: sentences.length };
}

const IMPLEMENTATIONS: Record<string, (args: Record<string, unknown>) => unknown> = {
  'text.count': countText,
};

/**
 * The catalogue, made invocable.
 *
 * Built FROM `TOOL_CATALOGUE` rather than listed again, so a tool the control
 * plane can grant and the runtime cannot run is impossible by construction — the
 * throw below fires at startup, not on the mission that first needs it.
 */
export function builtinTools(): ToolDescriptor[] {
  return TOOL_CATALOGUE.map((spec) => {
    const run = IMPLEMENTATIONS[spec.toolId];
    if (run === undefined) {
      throw new Error(`catalogued tool "${spec.toolId}" has no implementation in this build`);
    }
    return {
      toolId: spec.toolId,
      riskClass: spec.riskClass,
      description: spec.description,
      async invoke(args: Record<string, unknown>) {
        return run(args);
      },
    };
  });
}
