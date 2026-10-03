/**
 * Resource Tracker — Centralized API call & token usage monitoring.
 *
 * Singleton that tracks all outbound HTTP calls, latency, byte counts,
 * token usage, and child process spawns across the extension lifetime.
 *
 * Provides:
 * - Per-category stats (rpc, mcp, n8n, auth, push, llm-discovery, context-sync)
 * - Per-request stats for inline chat footers
 * - Aggregate stats for /stats command and tree view
 * - EventEmitter for live UI updates
 *
 * @module
 */

import * as vscode from "vscode";

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

/** API call category for grouping stats. */
export type ApiCategory =
  | "rpc"
  | "mcp"
  | "n8n"
  | "auth"
  | "push"
  | "llm-discovery"
  | "context-sync";

/** Stats for a single API category. */
export interface CategoryStats {
  calls: number;
  errors: number;
  totalLatencyMs: number;
  totalBytes: number;
}

/** Token usage from a single request. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/** Stats snapshot for a single request (used in inline chat footers). */
export interface RequestStats {
  category: ApiCategory;
  latencyMs: number;
  responseBytes: number;
  tokens: TokenUsage | null;
}

/** Per-model usage record for token tracking. */
export interface ModelUsageRecord {
  provider: string;
  modelId: string;
  tier: "edge" | "self-hosted" | "cloud";
  promptTokens: number;
  completionTokens: number;
  callCount: number;
  totalLatencyMs: number;
}

/** Full resource stats snapshot. */
export interface ResourceSnapshot {
  uptimeMs: number;
  api: Record<ApiCategory, CategoryStats>;
  tokens: {
    prompt: number;
    completion: number;
    estimatedCostUsd: number;
  };
  modelUsage: ModelUsageRecord[];
  childProcesses: number;
  lastReset: string;
}

// ──────────────────────────────────────────
// Cost estimation (rough per-1K-token rates)
// ──────────────────────────────────────────

/** Default cost per 1K tokens (blended estimate for typical SaaS LLM). */
const COST_PER_1K_PROMPT = 0.003;
const COST_PER_1K_COMPLETION = 0.006;

// ──────────────────────────────────────────
// Singleton
// ──────────────────────────────────────────

export const ALL_CATEGORIES: ApiCategory[] = [
  "rpc", "mcp", "n8n", "auth", "push", "llm-discovery", "context-sync",
];

/** EventEmitter fired after each recorded call (debounced in consumers). */
const _onStatsChanged = new vscode.EventEmitter<void>();
export const onStatsChanged: vscode.Event<void> = _onStatsChanged.event;

/** Per-category counters. */
const stats: Record<ApiCategory, CategoryStats> = Object.fromEntries(
  ALL_CATEGORIES.map((c) => [c, { calls: 0, errors: 0, totalLatencyMs: 0, totalBytes: 0 }]),
) as Record<ApiCategory, CategoryStats>;

/** Aggregate token counters. */
let totalPromptTokens = 0;
let totalCompletionTokens = 0;

/** Child process spawn counter (git, etc.). */
let childProcessCount = 0;

/** Per-model usage tracking. Key = `${provider}/${modelId}`. */
const modelUsageMap = new Map<string, ModelUsageRecord>();

/** Activation timestamp. */
const activatedAt = Date.now();
const activatedIso = new Date().toISOString();

// ──────────────────────────────────────────
// Public API
// ──────────────────────────────────────────

/**
 * Record a completed API call.
 */
export function recordApiCall(
  category: ApiCategory,
  latencyMs: number,
  responseBytes: number,
  isError: boolean,
  tokens?: TokenUsage | null,
): RequestStats {
  const cat = stats[category];
  cat.calls++;
  cat.totalLatencyMs += latencyMs;
  cat.totalBytes += responseBytes;
  if (isError) cat.errors++;

  if (tokens) {
    totalPromptTokens += tokens.promptTokens;
    totalCompletionTokens += tokens.completionTokens;
  }

  _onStatsChanged.fire();

  return {
    category,
    latencyMs,
    responseBytes,
    tokens: tokens ?? null,
  };
}

/**
 * Record a child process spawn (e.g. git execSync).
 */
export function recordChildProcess(): void {
  childProcessCount++;
}

/**
 * Record per-model token usage.
 */
export function recordModelUsage(record: Omit<ModelUsageRecord, "callCount">): void {
  const key = `${record.provider}/${record.modelId}`;
  const existing = modelUsageMap.get(key);
  if (existing) {
    existing.promptTokens += record.promptTokens;
    existing.completionTokens += record.completionTokens;
    existing.callCount++;
    existing.totalLatencyMs += record.totalLatencyMs;
  } else {
    modelUsageMap.set(key, {
      ...record,
      callCount: 1,
    });
  }
  _onStatsChanged.fire();
}

/**
 * Get all per-model usage records.
 */
export function getModelUsage(): ModelUsageRecord[] {
  return [...modelUsageMap.values()];
}

/**
 * Get a snapshot of all resource stats.
 */
export function getSnapshot(): ResourceSnapshot {
  const total = totalPromptTokens + totalCompletionTokens;
  const costUsd =
    (totalPromptTokens / 1000) * COST_PER_1K_PROMPT +
    (totalCompletionTokens / 1000) * COST_PER_1K_COMPLETION;

  return {
    uptimeMs: Date.now() - activatedAt,
    api: structuredClone(stats),
    tokens: {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
      estimatedCostUsd: Math.round(costUsd * 100_000) / 100_000,
    },
    modelUsage: getModelUsage(),
    childProcesses: childProcessCount,
    lastReset: activatedIso,
  };
}

/**
 * Get aggregate totals across all categories.
 */
export function getAggregateTotals(): {
  totalCalls: number;
  totalErrors: number;
  avgLatencyMs: number;
  totalBytes: number;
} {
  let totalCalls = 0;
  let totalErrors = 0;
  let totalLatency = 0;
  let totalBytes = 0;

  for (const cat of ALL_CATEGORIES) {
    const s = stats[cat];
    totalCalls += s.calls;
    totalErrors += s.errors;
    totalLatency += s.totalLatencyMs;
    totalBytes += s.totalBytes;
  }

  return {
    totalCalls,
    totalErrors,
    avgLatencyMs: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
    totalBytes,
  };
}

// ──────────────────────────────────────────
// Formatting helpers (for UI display)
// ──────────────────────────────────────────

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Format token count to compact string (e.g. "23.6K").
 */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/**
 * Format duration in ms to human-readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

/**
 * Format cost to USD string.
 */
export function formatCost(usd: number): string {
  if (usd < 0.001) return "<$0.001";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Build inline stats footer for a single request.
 */
export function buildInlineFooter(reqStats: RequestStats): string {
  const parts: string[] = [];

  if (reqStats.tokens) {
    const cost = (reqStats.tokens.promptTokens / 1000) * COST_PER_1K_PROMPT +
      (reqStats.tokens.completionTokens / 1000) * COST_PER_1K_COMPLETION;
    parts.push(`${formatTokens(reqStats.tokens.promptTokens)} + ${formatTokens(reqStats.tokens.completionTokens)} tokens (~${formatCost(cost)})`);
  }

  parts.push(`${Math.round(reqStats.latencyMs)}ms`);

  if (reqStats.responseBytes > 0) {
    parts.push(formatBytes(reqStats.responseBytes));
  }

  return parts.join(" | ");
}

/**
 * Build full /stats markdown table.
 */
export function buildStatsMarkdown(): string {
  const snap = getSnapshot();
  const agg = getAggregateTotals();
  const lines: string[] = [];

  lines.push("## 📊 AISHA Resource Usage (session)\n");
  lines.push("| Category | Calls | Errors | Avg Latency | Data |");
  lines.push("|----------|-------|--------|-------------|------|");

  const CATEGORY_LABELS: Record<ApiCategory, string> = {
    rpc: "Backend RPC",
    mcp: "MCP Tools",
    n8n: "n8n Agents",
    auth: "Auth",
    push: "Push Channel",
    "llm-discovery": "LLM Discovery",
    "context-sync": "Context Sync",
  };

  for (const cat of ALL_CATEGORIES) {
    const s = snap.api[cat];
    if (s.calls === 0) continue;
    const avg = s.calls > 0 ? Math.round(s.totalLatencyMs / s.calls) : 0;
    lines.push(
      `| ${CATEGORY_LABELS[cat]} | ${s.calls} | ${s.errors} | ${avg}ms | ${formatBytes(s.totalBytes)} |`,
    );
  }

  if (agg.totalCalls === 0) {
    lines.push("| _(no API calls yet)_ | — | — | — | — |");
  }

  lines.push("");
  lines.push(
    `**Tokens:** ${formatTokens(snap.tokens.prompt)} prompt + ${formatTokens(snap.tokens.completion)} completion = ${formatTokens(snap.tokens.prompt + snap.tokens.completion)} total (~${formatCost(snap.tokens.estimatedCostUsd)})`,
  );

  // Per-model breakdown
  if (snap.modelUsage.length > 0) {
    lines.push("");
    lines.push("### Per-Model Usage\n");
    lines.push("| Model | Tier | Calls | Prompt | Completion | Avg Latency |");
    lines.push("|-------|------|-------|--------|------------|-------------|");
    for (const m of snap.modelUsage) {
      const avg = m.callCount > 0 ? Math.round(m.totalLatencyMs / m.callCount) : 0;
      lines.push(
        `| ${m.modelId} | ${m.tier} | ${m.callCount} | ${formatTokens(m.promptTokens)} | ${formatTokens(m.completionTokens)} | ${avg}ms |`,
      );
    }
  }

  lines.push(`**Child processes:** ${snap.childProcesses} (git)`);
  lines.push(`**Uptime:** ${formatDuration(snap.uptimeMs)}`);
  lines.push(`**Total API calls:** ${agg.totalCalls} (${agg.totalErrors} errors)`);

  return lines.join("\n");
}

/**
 * Dispose the event emitter (called on extension deactivation).
 */
export function dispose(): void {
  _onStatsChanged.dispose();
}
