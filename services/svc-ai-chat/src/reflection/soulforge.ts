/**
 * Soulforge — capability used by reflection nodes and by the main chat path.
 *
 * Two responsibilities:
 *   1. Slot classification (spark/ember/verify/...) — heuristic; falls back to
 *      DB RPC `recommend_slot_for_task` if confidence < 0.6.
 *   2. Payload optimization (token elimination, context shaping per slot) before
 *      LLM call — the "úsporná komunikace" with LLM Gateway.
 *
 * Designed to plug into unifiedChat call sites: classify → optimize → call.
 * Lives inside svc-ai-chat (no separate service). Same process as llmRouter.
 */
import { resolveDefaultModel } from '../lib/defaultModel.js';

export type TaskSlot =
  | 'spark'        // read/explore — cheap
  | 'ember'        // write/edit — mid
  | 'webSearch'
  | 'desloppify'
  | 'verify'       // review — premium
  | 'compact'      // summarize
  | 'semantic'
  | 'default';

export type SlotProfile = 'budget' | 'balanced' | 'maxQuality';

export interface SlotClassification {
  slot: TaskSlot;
  confidence: number;
  reason: string;
}

// NOTE: stems like 'summariz', 'analyz', 'evaluat', 'diagnos' are deliberately
// prefix-matched (no trailing \b). Adding \b would refuse 'summarize' /
// 'analyzing' because 'e' / 'i' are word characters → no word boundary after
// the stem. Whole-word verbs keep \b on both sides.
const PATTERNS: Array<{ slot: TaskSlot; re: RegExp; maxLen?: number; confidence: number }> = [
  { slot: 'spark',      re: /\b(read|explore|fetch|open|show|browse|load)\b/i, maxLen: 400, confidence: 0.75 },
  { slot: 'ember',      re: /\b(write|edit|create|implement|fix|refactor|build|add)\b/i, confidence: 0.75 },
  { slot: 'verify',     re: /\b(review|test|check|verify|audit|validate)\b/i, confidence: 0.75 },
  { slot: 'compact',    re: /\b(summariz|condens|shorten|tldr)/i, confidence: 0.80 },
  { slot: 'semantic',   re: /\b(analyz|explain|compar|evaluat|diagnos)/i, confidence: 0.65 },
  { slot: 'webSearch',  re: /\b(search|google|lookup|web|find)\b/i, confidence: 0.60 },
  { slot: 'desloppify', re: /\b(clean|format|lint|tidy)\b/i, confidence: 0.70 },
];

/**
 * Synchronous heuristic classifier. ~1ms. Use for hot path.
 * For ambiguous cases (no pattern), caller may fall back to DB RPC.
 */
export function classifyTaskSlot(message: string): SlotClassification {
  for (const pat of PATTERNS) {
    if (pat.re.test(message)) {
      if (pat.maxLen && message.length > pat.maxLen) continue;
      return {
        slot: pat.slot,
        confidence: pat.confidence,
        reason: `regex_match:${pat.slot}`,
      };
    }
  }
  return { slot: 'default', confidence: 0.4, reason: 'no_pattern_matched' };
}

/**
 * Slot × profile → model id, resolved LIVE over the serviceable pool. No literal matrix.
 *
 * Each slot maps to capability hints (ember→tools, webSearch→internet) and each profile
 * to a cost ceiling (budget→cheap 'budget' cost-class, maxQuality→'premium'), which the
 * ONE resolver (aisha_resolve_clow_backend) ranks against the live serviceable pool —
 * preserving the old matrix's cheap-slot/strong-slot intent without baking model ids, and
 * failing loud when nothing is serviceable. AISHA_SLOT_MODELS (JSON map) stays the explicit
 * operator override. Used as the slot fallback in decision.ts (after clow_backend + override),
 * so the live resolve runs only on that rare path.
 */
const SLOT_NEEDS: Record<string, { needsTools?: boolean; needsInternet?: boolean }> = {
  ember: { needsTools: true },        // write/edit/implement/refactor
  webSearch: { needsInternet: true }, // search/lookup
};
const PROFILE_MAX_COST: Record<string, number> = {
  budget: 0.3,      // < $0.50 → resolver cost_class 'budget' (cheapest serviceable)
  balanced: 1.0,
  maxQuality: 5.0,  // → 'premium' (strongest serviceable)
};

export async function resolveSlotModel(slot: string, profile: string = 'balanced'): Promise<string> {
  // Env override (the one source of explicit operator/tenant tuning) — unchanged.
  const envOverrideRaw = process.env.AISHA_SLOT_MODELS;
  if (envOverrideRaw) {
    try {
      const env = JSON.parse(envOverrideRaw) as Record<string, string>;
      const key = `${slot}:${profile}`;
      if (env[key]) return env[key];
      if (env[slot]) return env[slot];
    } catch {
      // fall through to the live resolve
    }
  }

  // Dynamic: slot → capability needs, profile → cost ceiling → resolve over the live pool.
  const needs = SLOT_NEEDS[slot] ?? {};
  const maxCostUsd = PROFILE_MAX_COST[profile] ?? PROFILE_MAX_COST.balanced;
  return resolveDefaultModel(`soulforge:${slot}`, { ...needs, maxCostUsd, skipDeriveNeeds: true });
}

export interface OptimizedPayload {
  system: string;
  user: string;
  reduction_pct: number;
  dropped_segments: string[];
}

/**
 * Slot-aware payload shaping. Goal: úsporná komunikace s LLM Gateway —
 * eliminate tokens that don't change the model's answer.
 *
 * - spark (read/explore): drop verbose tool outputs, truncate KB chunks
 * - ember (code edit): keep diffs, drop unrelated history
 * - verify: keep full output to review + test context, drop tangential KB
 * - compact: very small system prompt (target is summarization)
 * - semantic: keep retrieved facts, drop persona
 * - default: pass through
 */
export function optimizePayload(
  raw: { system: string; user: string },
  slot: string,
  profile: string,
): OptimizedPayload {
  const sizeBefore = raw.system.length + raw.user.length;
  let system = raw.system;
  let user = raw.user;
  const dropped: string[] = [];

  switch (slot) {
    case 'spark': {
      // Cheap exploration: trim system, keep user intent
      if (system.length > 1500) {
        dropped.push(`system_trimmed_from_${system.length}_to_1500`);
        system = system.slice(0, 1500);
      }
      // Drop "Recent learnings" block beyond first item — exploration doesn't need many priors
      const learningsIdx = user.indexOf('Recent learnings');
      if (learningsIdx > 0) {
        const before = user.slice(0, learningsIdx);
        const after = user.slice(learningsIdx).split('\n').slice(0, 3).join('\n');
        dropped.push('learnings_truncated');
        user = `${before}${after}`;
      }
      break;
    }
    case 'compact': {
      // Aggressive: tiny system prompt; user input dominates
      if (system.length > 500) {
        dropped.push(`system_trimmed_to_500_compact`);
        system = system.slice(0, 500);
      }
      break;
    }
    case 'verify': {
      // Keep system rules; trim large historical context
      if (user.length > 8000) {
        dropped.push(`user_trimmed_from_${user.length}_to_8000`);
        user = `${user.slice(0, 6000)}\n\n[…truncated…]\n\n${user.slice(-2000)}`;
      }
      break;
    }
    case 'ember':
    case 'semantic':
    case 'webSearch':
    case 'desloppify':
    case 'default':
    default: {
      // Mild dedup of repeated whitespace runs
      const before = (system + user).length;
      system = system.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
      user = user.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
      const after = (system + user).length;
      if (after < before - 50) dropped.push(`whitespace_collapsed_-${before - after}`);
      break;
    }
  }

  const sizeAfter = system.length + user.length;
  const reduction_pct = sizeBefore > 0 ? Math.round(((sizeBefore - sizeAfter) / sizeBefore) * 100) : 0;
  return { system, user, reduction_pct, dropped_segments: dropped };
}

/**
 * Convenience adapter for unifiedChat callers that want Soulforge optimization
 * applied transparently. Mutates a copy of the options; original is unchanged.
 *
 * Usage:
 *   const opts = applySoulforge({ provider, model, systemPrompt, messages }, slotHint, profile);
 *   const result = await unifiedChat(opts);
 *
 * Slot is auto-classified from the last user message when not provided.
 */
export function applySoulforge<T extends {
  systemPrompt?: string;
  messages: Array<{ role: string; content: string }>;
}>(
  opts: T,
  slotHint?: TaskSlot,
  profile: SlotProfile = 'balanced',
): T & { _soulforge_reduction_pct: number; _soulforge_slot: TaskSlot } {
  const last = [...opts.messages].reverse().find((m) => m.role === 'user');
  const userText = last?.content ?? '';
  const slot = slotHint ?? classifyTaskSlot(userText).slot;

  const optimized = optimizePayload(
    { system: opts.systemPrompt ?? '', user: userText },
    slot,
    profile,
  );

  const newMessages = opts.messages.map((m) =>
    m === last ? { ...m, content: optimized.user } : m,
  );

  return {
    ...opts,
    systemPrompt: optimized.system || undefined,
    messages: newMessages,
    _soulforge_reduction_pct: optimized.reduction_pct,
    _soulforge_slot: slot,
  };
}
