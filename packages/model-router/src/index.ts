/**
 * @artifex/model-router — provider-neutral dispatch (ADR-0001/0002).
 *
 * Resolves a logical tier to a concrete model via the versioned Model Catalog
 * and dispatches to Claude or an OpenAI-compatible local endpoint (Ollama/vLLM).
 * The router — not the Claude Agent SDK — is the spine. This is a scaffold
 * placeholder only; the router and catalog are built in phase P3.
 */
export const PACKAGE_NAME = '@artifex/model-router';
