/**
 * Rules Engine — in-extension cache of `claude_hook_bindings` + per-signal
 * regex matcher.
 *
 * Replaces the hardcoded VIOLATION_RULES TS array in copilot-watcher.ts
 * (the old "single SoT in extension source" model) with a cached fetch
 * from the live backend. The cache means a single signal evaluation does
 * not hit Postgres; bindings refresh on TTL (default 60s) or explicit
 * reload() call.
 *
 * Same fail-open contract as fetch-bindings.ts: any RPC failure falls back
 * to the bundled `aisha/db/seed/claude_hook_bindings.json` mirror so the
 * extension keeps catching violations even when offline.
 *
 * Future iteration: integrate Error Memory — when an evaluation matches a
 * binding with `repeated-failure` semantic, attach the occurrence count
 * from error-memory.ts so callers can implement "3 strikes" rules.
 *
 * @module
 */

import * as vscode from "vscode";
import { fetchClaudeHookBindings, parseBindings } from "./generators/fetch-bindings";
import type { ClaudeHookBinding } from "./generators/fetch-bindings";

// Offline mirror bundled at build time — same source-of-truth as the
// adapter-claude-overlay generator uses.
import bindingsMirror from "../../../aisha/db/seed/claude_hook_bindings.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignalSource =
  | "terminal"
  | "git"
  | "test"
  | "build"
  | "lint"
  | "editor"
  | "deploy";

export interface LocalSignal {
  source: SignalSource;
  type: string;
  severity?: "low" | "moderate" | "high";
  message: string;
  files?: string[];
  command?: string;
  timestamp: string;
}

export interface EvaluationContext {
  rootUri: vscode.Uri;
  storyId?: string | null;
  sessionId?: string | null;
}

export type RuleDecision = "allow" | "warn" | "suggest" | "block" | "escalate";

export interface RuleMatch {
  rule_id: string;
  severity: "low" | "moderate" | "high";
  decision: RuleDecision;
  message: string;
  hint?: string;
  /** Per-match context: matched pattern fragment, signal source, etc. */
  context: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const DEFAULT_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  bindings: ClaudeHookBinding[];
  fetched_at: number;
  source: "live" | "bundled";
}

let cache: CacheEntry | null = null;

/**
 * Map binding severity to a per-rule decision. The mapping is intentional:
 *   high   → 'warn'      (visible advisory, never blocks per overlay invariant)
 *   moderate → 'suggest' (lighter touch)
 *   low    → 'suggest'   (silent unless surfaced)
 *
 * The advisory-only invariant means NO binding ever maps to 'block' or
 * 'escalate' from regex match alone. Escalation (Fáze 3.escalation) is a
 * separate code path triggered by repeated occurrences + low local-LLM
 * confidence, not a single regex hit.
 */
function severityToDecision(sev: ClaudeHookBinding["severity"]): RuleDecision {
  return sev === "high" ? "warn" : "suggest";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load bindings — live RPC first, bundled JSON mirror on failure. Cached
 * for `ttlMs` milliseconds; pass `force=true` to bypass cache.
 */
export async function loadBindings(opts: {
  storyId?: string | null;
  ttlMs?: number;
  force?: boolean;
} = {}): Promise<{ bindings: ClaudeHookBinding[]; source: "live" | "bundled" }> {
  const ttl = opts.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  if (!opts.force && cache && Date.now() - cache.fetched_at < ttl) {
    return { bindings: cache.bindings, source: cache.source };
  }

  // Try live RPC; null on any failure (no token, RPC error, malformed payload)
  const live = await fetchClaudeHookBindings(opts.storyId ?? null).catch(() => null);
  if (live && live.length > 0) {
    cache = { bindings: live, fetched_at: Date.now(), source: "live" };
    return { bindings: live, source: "live" };
  }

  // Fallback to bundled JSON mirror — same SoT the adapter uses
  const offline = parseBindings(
    (bindingsMirror as { bindings: unknown[] }).bindings,
  );
  const fallback = offline ?? [];
  cache = { bindings: fallback, fetched_at: Date.now(), source: "bundled" };
  return { bindings: fallback, source: "bundled" };
}

/**
 * Evaluate a signal against the cached binding set. Returns ALL matches
 * (a single signal can match multiple rules — caller decides whether to
 * dedup by rule_id, surface only the highest-severity one, etc).
 *
 * MVP: matches regex-kind bindings against `signal.message`. Future:
 *   - heuristic-kind bindings (i18n, bash-risk) — invoke their TS
 *     scanner equivalents (move logic from .sh templates into TS)
 *   - error-memory integration — `same_fingerprint_count >= 3` rule
 *     fires when a signal's fingerprint already has N occurrences
 *   - git-branch / changed-paths rules — read git state via a safe
 *     wrapper (services/.../utils/execFileNoThrow.ts pattern; never
 *     shell-out via the unsafe child_process exec)
 */
export async function evaluate(
  signal: LocalSignal,
  ctx: EvaluationContext,
): Promise<RuleMatch[]> {
  const { bindings, source } = await loadBindings({ storyId: ctx.storyId ?? null });
  const matches: RuleMatch[] = [];

  for (const b of bindings) {
    if (b.scanner_kind !== "regex" || !b.pattern_regex) continue;
    let regex: RegExp;
    try {
      regex = new RegExp(b.pattern_regex);
    } catch {
      // Malformed regex from backend — skip; don't crash evaluation
      continue;
    }
    const hit = regex.exec(signal.message);
    if (!hit) continue;
    matches.push({
      rule_id: b.rule_slug,
      severity: b.severity,
      decision: severityToDecision(b.severity),
      message: b.messages.cs,
      hint: b.hint ?? undefined,
      context: {
        matched_text: hit[0],
        signal_source: signal.source,
        signal_type: signal.type,
        bindings_source: source,
      },
    });
  }
  return matches;
}

/**
 * Force a cache refresh on next call. Called by extension activation after
 * the user explicitly invokes "AISHA: Reload Bindings" or when a push event
 * signals upstream bindings changed.
 */
export function invalidateCache(): void {
  cache = null;
}

/** Test seam. */
export function _resetCacheForTests(): void {
  cache = null;
}
