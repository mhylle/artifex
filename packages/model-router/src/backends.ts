/**
 * The concrete backends behind the router.
 *
 * The guardrail from this package's CLAUDE.md: *the router is the spine, and
 * Claude is one backend behind it* — never the dependency the runtime binds to.
 * That is why both providers arrive through the same `StructuredOutputBackend`
 * seam, and why the local path speaks the OpenAI-compatible dialect that Ollama
 * (dev) and vLLM (prod) both serve.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { toJsonSchema } from '@artifex/shared-types';
import type { JSONSchema7 } from '@ai-sdk/provider';
import { generateObject, jsonSchema } from 'ai';
import type { LanguageModel } from 'ai';

import type { AdmissionProbe, StructuredOutputBackend } from './admission-gate.js';

export interface BackendOptions {
  /** OpenAI-compatible base URL — Ollama in dev, vLLM in prod. */
  readonly localBaseUrl: string;
  readonly anthropicApiKey?: string | undefined;
}

function languageModelFor(
  provider: string,
  model: string,
  options: BackendOptions,
): LanguageModel {
  if (provider === 'anthropic') {
    // Omit the key entirely rather than passing `undefined` — the SDK then falls
    // back to ANTHROPIC_API_KEY, and `exactOptionalPropertyTypes` rejects the
    // explicit-undefined form anyway.
    return createAnthropic(
      options.anthropicApiKey === undefined ? {} : { apiKey: options.anthropicApiKey },
    )(model);
  }
  // `supportsStructuredOutputs` is required, not optional politeness: without it
  // the SDK drops the json_schema response format and the model free-forms its
  // JSON. The gate would then refuse every candidate for a reason that says
  // nothing about the model — a false negative that looks exactly like a real one.
  return createOpenAICompatible({
    name: provider,
    baseURL: options.localBaseUrl,
    supportsStructuredOutputs: true,
  })(model);
}

/**
 * Dispatch a probe to a real model and return its structured output.
 *
 * The schema handed to the model is the *same object* the validator uses —
 * `toJsonSchema` is identity by design (ADR-0004), so there is no conversion
 * step where the constraint and the check could drift apart.
 */
export function createBackend(options: BackendOptions): StructuredOutputBackend {
  return {
    async generate({ provider, model, probe }: {
      provider: string;
      model: string;
      probe: AdmissionProbe;
    }) {
      const { object } = await generateObject({
        model: languageModelFor(provider, model, options),
        schema: jsonSchema(toJsonSchema(probe.schema) as unknown as JSONSchema7),
        prompt: probe.prompt,
      });
      return object;
    },
  };
}
