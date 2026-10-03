/**
 * Warm `ai_runtime` runtime config — shared thresholds for the odysseus wave
 * (untrusted wrapper 02, context budget/compaction 03, deep research 04).
 *
 * ONE system_config key, ONE loader, ZERO new RPCs (impl/08 §4):
 *   - read: existing get_system_config('ai_runtime') + TTL cache
 *   - write (operator): existing set_system_config_admin(...) — audited,
 *     admin-only, optimistic concurrency (NocoDB/Appsmith over system_config)
 *   - resolution order per knob: DB row → AI_RUNTIME_CONFIG_JSON env bootstrap
 *     → code default; transient DB errors serve the last-known config
 *
 * Pattern copied from svc-agent-runner getRunnerCaps (runtime-config.ts):
 * the DB is the authority, env is only the cold-start default, values take
 * effect within the TTL without a redeploy, and a DB blip never loses config.
 *
 * Feature FLAGS stay in env by repo convention (fail-safe `!== 'false'` /
 * opt-in `=== 'true'`); this row carries TUNABLE THRESHOLDS only.
 */
import type { PostgrestClient } from "./rpcAdapter.js";

export interface AiRuntimeConfig {
  /** 02 — context profiles that trigger a runtime injection re-scan. */
  untrustedRescanProfiles: string[];
  /** 02 — score above which a KB/memory chunk is re-scanned at runtime. */
  injectionRescanThreshold: number;
  /** 03 — fraction of the model context window usable for input (impl/09 §B-3: 0.7, chars/4 underestimates). */
  contextBudgetHeadroom: number;
  /** 03 — absolute input-token ceiling regardless of model window. */
  contextBudgetHardMax: number;
  /** 03 — budget fraction that triggers history compaction. */
  compactThreshold: number;
  /** 03 — most-recent turns always kept verbatim during compaction. */
  compactKeepLastTurns: number;
  /** 03 — token cap for the compaction summary. */
  compactSummaryMaxTokens: number;
  /** 04 — max research loop rounds. */
  researchMaxRounds: number;
  /** 04 — research token budget envelope. */
  researchBudgetTokens: number;
  /** 04 — research wall-clock budget. */
  researchBudgetTimeMs: number;
}

export const AI_RUNTIME_DEFAULTS: AiRuntimeConfig = Object.freeze({
  untrustedRescanProfiles: ["critical_flow", "high_risk"],
  injectionRescanThreshold: 0.7,
  contextBudgetHeadroom: 0.7,
  contextBudgetHardMax: 200_000,
  compactThreshold: 0.85,
  compactKeepLastTurns: 6,
  compactSummaryMaxTokens: 1_024,
  researchMaxRounds: 3,
  researchBudgetTokens: 100_000,
  researchBudgetTimeMs: 300_000,
});

const TTL_MS = Math.max(1_000, parseInt(process.env.AI_RUNTIME_CONFIG_TTL_MS ?? "30000", 10));

let cache: AiRuntimeConfig | undefined;
let fetchedAt = 0;

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function strArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Merge a raw config object (DB row / env JSON) over the defaults, clamped. */
function resolve(raw: Record<string, unknown>): AiRuntimeConfig {
  const d = AI_RUNTIME_DEFAULTS;
  return {
    untrustedRescanProfiles: strArray(raw.untrusted_rescan_profiles) ?? d.untrustedRescanProfiles,
    injectionRescanThreshold: clamp(num(raw.injection_rescan_threshold) ?? d.injectionRescanThreshold, 0, 1),
    contextBudgetHeadroom: clamp(num(raw.context_budget_headroom) ?? d.contextBudgetHeadroom, 0.3, 0.95),
    contextBudgetHardMax: Math.max(1_000, num(raw.context_budget_hard_max) || d.contextBudgetHardMax),
    compactThreshold: clamp(num(raw.compact_threshold) ?? d.compactThreshold, 0.5, 0.99),
    compactKeepLastTurns: Math.max(1, num(raw.compact_keep_last_turns) ?? d.compactKeepLastTurns),
    compactSummaryMaxTokens: Math.max(64, num(raw.compact_summary_max_tokens) ?? d.compactSummaryMaxTokens),
    researchMaxRounds: Math.max(1, num(raw.research_max_rounds) ?? d.researchMaxRounds),
    researchBudgetTokens: Math.max(1_000, num(raw.research_budget_tokens) ?? d.researchBudgetTokens),
    researchBudgetTimeMs: Math.max(10_000, num(raw.research_budget_time_ms) ?? d.researchBudgetTimeMs),
  };
}

/** Env bootstrap layer (developer-local / first boot before seed applies). */
function envLayer(): AiRuntimeConfig {
  const rawJson = process.env.AI_RUNTIME_CONFIG_JSON;
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") return resolve(parsed);
    } catch {
      // malformed env JSON → fall through to code defaults (fail-safe)
    }
  }
  return resolve({});
}

/**
 * Resolve the live ai_runtime config. `nowMs` is injectable for tests;
 * production uses Date.now(). Cached for TTL_MS; a refresh failure serves the
 * last-known config (never throws, never loses config on a DB blip).
 */
export async function getAiRuntimeConfig(
  client: PostgrestClient,
  nowMs: number = Date.now(),
): Promise<AiRuntimeConfig> {
  if (cache && nowMs - fetchedAt < TTL_MS) return cache;
  try {
    const { data, error } = await client.rpc<Record<string, unknown> | null>("get_system_config", {
      p_key: "ai_runtime",
    });
    if (error) throw new Error(error.message);
    cache = data && typeof data === "object" ? resolve(data) : envLayer();
  } catch {
    cache = cache ?? envLayer();
  }
  fetchedAt = nowMs;
  return cache;
}

/** Test seam: reset the cache between cases. */
export function __resetAiRuntimeConfigCache(): void {
  cache = undefined;
  fetchedAt = 0;
}
