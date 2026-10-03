/**
 * @aisha/aitg — OWASP AI Testing Guide (AITG) v1 primitives shared across
 * orchestrator services. Single source of truth for catalog metadata,
 * Zod schemas, heuristic classifiers, the audit emitter, and the
 * `withAitgGuard()` middleware that wraps every LLM call site.
 *
 * Module → AITG layer focus:
 *   schemas.ts      → cross-boundary types (DB ↔ service ↔ MCP)
 *   catalog.ts      → 44 tests (parity-checked with SQL seed)
 *   classifiers.ts  → AITG-APP-01, APP-03, APP-12, APP-11, DAT-02 detectors
 *   runner.ts       → aitg_runs writer via aitg_record_run_audited RPC
 *   guard.ts        → withAitgGuard() call-site middleware
 *
 * Discovery gate enforces that every service file containing an LLM
 * provider import (openai, anthropic, gemini, etc.) also imports either
 * `withAitgGuard` or one of the classifiers — or appears on the baselined
 * exception list with a tracking ticket.
 */

export * from './schemas.js';
export * from './catalog.js';
export * from './classifiers.js';
export * from './runner.js';
export * from './guard.js';
export * from './continuous.js';
export * from './automation.js';
