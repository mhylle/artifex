/**
 * @artifex/shared-types — the foundation everything depends on.
 *
 * Every schema here is ONE object serving three uses at once (ADR-0004):
 *   1. the TypeScript type — always via `Static<typeof X>`, never a hand-written
 *      parallel interface;
 *   2. the runtime validator — ajv, over this same object;
 *   3. the JSON Schema handed to LLMs for structured output / tool-calling.
 *
 * There is no translation step between what we validate and what we hand a
 * model. If you find yourself maintaining a second copy of a shape, stop.
 *
 * This package is the dependency-graph leaf: it imports from no other workspace
 * package, and it performs no I/O.
 */
export * from './common.js';
export * from './contract.js';
export * from './ledger-event.js';
export * from './reflection.js';
export * from './evidence-bundle.js';
export * from './verdict.js';
export * from './capability-manifest.js';
export * from './model-catalog.js';
export * from './mission-intake.js';
export * from './tool-catalogue.js';
export * from './validation.js';
