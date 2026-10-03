import { rpc } from './postgrest.js';
import { reflectionConfig as config } from './config.js';

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');
interface ComposedContext {
  profile: string;
  token_budget: number;
  tokens_used: number;
  layers: Record<string, unknown>;
  profile_layers: Record<string, unknown>;
}

/**
 * Wrapper around the existing compose_context RPC.
 * Loads ruleset + KB + memory + Psyché + Hippocampus learnings for the run.
 */
export async function loadContext(opts: {
  storyId: string | null;
  profileSlug?: string;
  runId?: string;
  query?: string;
  agentSlug?: string;
  /**
   * Kdo si kontext žádá (vlastník běhu). compose_context je SECURITY DEFINER a pro
   * story-scoped skládání pod službou žadatele VYŽADUJE (per-story RBAC, jinak 42501).
   * Bez něj každý běh reflexe (ai_runs.story_id je NOT NULL) spadl a jel bez kontextu
   * (SELF_IMPROVEMENT_LOOP.md K-26a). Systémový běh bez aktéra zůstává odmítnutý —
   * to je záměr compose_context, ne díra (K-26e: systémový principál).
   */
  requesterId?: string | null;
}): Promise<ComposedContext> {
  const args = {
    p_story_id: opts.storyId,
    p_context_profile_slug: opts.profileSlug ?? 'learnings_enabled',
    p_run_id: opts.runId ?? null,
    p_query: opts.query ?? null,
    p_agent_slug: opts.agentSlug ?? config.defaultAgentSlug,
    ...(opts.requesterId ? { p_requester_id: opts.requesterId } : {}),
  };
  return rpc<ComposedContext>('compose_context', args);
}

/**
 * Capture a learning into Hippocampus after a successful reflection run.
 */
export async function captureLearning(opts: {
  runId: string;
  pattern: string;
  resolution: string;
  criticScores?: Record<string, number>;
  storyId?: string | null;
  agentSlug?: string;
  importance?: number;
}): Promise<string | null> {
  try {
    const id = await rpc<string>('fn_capture_learning', {
      p_run_id: opts.runId,
      p_pattern: opts.pattern,
      p_resolution: opts.resolution,
      p_critic_scores: opts.criticScores ?? {},
      p_story_id: opts.storyId ?? null,
      p_agent_slug: opts.agentSlug ?? config.defaultAgentSlug,
      p_importance: opts.importance ?? null,
    });
    return id;
  } catch (err) {
    // Degradation-safe: log + continue
    log.safeError('[langgraph-runner] captureLearning failed', err);
    return null;
  }
}

/**
 * Trigger a promotion-eligibility check after capture.
 * No-op if reuse threshold not yet reached.
 */
export async function maybePromoteLearning(memoryId: string): Promise<void> {
  try {
    await rpc('fn_maybe_promote_learning', { p_memory_id: memoryId });
  } catch (err) {
    log.safeError('[langgraph-runner] maybePromoteLearning failed', err);
  }
}
