/**
 * @artifex/model-router — provider-neutral dispatch (ADR-0001/0002).
 *
 * Resolves a logical tier to a concrete model via the versioned Model Catalog
 * and dispatches to Claude or an OpenAI-compatible local endpoint (Ollama/vLLM).
 * The router — not the Claude Agent SDK — is the spine.
 *
 * Two rules this package exists to enforce:
 *   1. A missing catalog tier is a **typed error**, never a silent substitution.
 *   2. A model reaches the catalog only by passing the **admission gate** on the
 *      real shared schemas — not a toy one.
 */
export * from './errors.js';
export * from './router.js';
export * from './admission-gate.js';
export * from './backends.js';
