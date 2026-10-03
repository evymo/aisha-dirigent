import { config } from './config.js';
import { rpcService } from './db.js';

/**
 * Dynamic runner caps — runtime-tunable WITHOUT a redeploy.
 *
 * Resolution order per knob: system_config('agent_runner') in the DB (operator /
 * AISHA tunes a row, takes effect within the cache TTL) → the env layer baked in
 * config.ts (deploy-time bootstrap) → a conservative fail-safe floor in config.ts.
 * The DB is the authority; env is only the cold-start default. This mirrors how
 * spend governance reads ai_spend_policies rather than hardcoding thresholds —
 * the safety limits are data, not constants.
 *
 * Cached with a short TTL so the 5s poll loop doesn't hammer PostgREST; a DB edit
 * propagates on the next refresh. On any read error we keep serving the last-known
 * (or the env layer) — the runner never loses its caps because the DB blipped.
 */
export interface RunnerCaps {
  pollEnabled: boolean;
  maxConcurrent: number;
  pollIntervalMs: number;
  pollGraceSeconds: number;
  execMemoryLimit: string;
  cliTimeoutMs: number;
}

const TTL_MS = Math.max(1_000, parseInt(process.env.AGENT_RUNNER_CONFIG_TTL_MS ?? '30000', 10));

let cache: RunnerCaps | undefined;
let fetchedAt = 0;

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

/** Merge a system_config('agent_runner') object over the env/default layer (config.ts). */
function resolve(db: Record<string, unknown>): RunnerCaps {
  return {
    pollEnabled: bool(db.poll_enabled) ?? config.claudePollEnabled,
    maxConcurrent: Math.max(1, num(db.max_concurrent) ?? config.maxConcurrentClaudeRuns),
    pollIntervalMs: Math.max(1_000, num(db.poll_interval_ms) ?? config.claudePollIntervalMs),
    pollGraceSeconds: Math.max(0, num(db.poll_grace_seconds) ?? config.claudePollGraceSeconds),
    execMemoryLimit: str(db.exec_memory_limit) ?? config.execMemoryLimit,
    cliTimeoutMs: Math.max(1_000, num(db.cli_timeout_ms) ?? config.claudeCliTimeoutMs),
  };
}

/** The env-only layer (no DB) — the fail-safe used before the first fetch / on error. */
function envCaps(): RunnerCaps {
  return resolve({});
}

/**
 * Resolve the live runner caps. `nowMs` is injectable for tests; production uses
 * Date.now(). Cached for TTL_MS; a refresh failure serves the last-known caps.
 */
export async function getRunnerCaps(nowMs: number = Date.now()): Promise<RunnerCaps> {
  if (cache && nowMs - fetchedAt < TTL_MS) return cache;
  try {
    const value = await rpcService<Record<string, unknown> | null>('get_system_config', { p_key: 'agent_runner' });
    cache = resolve(value && typeof value === 'object' ? value : {});
  } catch {
    cache = cache ?? envCaps(); // never lose caps on a transient DB error
  }
  fetchedAt = nowMs;
  return cache;
}

/** Test seam: reset the cache between cases. */
export function __resetRunnerCapsCache(): void {
  cache = undefined;
  fetchedAt = 0;
}
