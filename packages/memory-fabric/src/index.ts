/**
 * @artifex/memory-fabric — the Memory Fabric data layer (ADR-0005).
 *
 * Migrations and repositories for the one PostgreSQL database that *is* the
 * system's memory. Shared by the control-plane API (reads, gate-event writes,
 * the live stream) and the agent-runtime worker (appends).
 *
 * The append-only guarantee lives in the database, not in this code: there is
 * no update or delete path here, and a trigger rejects one regardless.
 */
export * from './migrate.js';
export * from './ledger-repository.js';
export * from './ledger-listener.js';
export * from './model-catalog-repository.js';
export * from './asset-registry-repository.js';
export * from './knowledge-commons-repository.js';
export * from './replay-bench-repository.js';
export * from './hot-fix-repository.js';
