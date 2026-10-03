import type { NodeHandler } from '../types.js';
import { rpc } from '../postgrest.js';
import { captureLearning, maybePromoteLearning } from '../contextLoader.js';
import { reflectionConfig as config } from '../config.js';

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');
/**
 * hippocampus_read — fetch prior learnings relevant to this task.
 *
 * Config:
 *   - limit: number (default 5)
 *   - min_importance: number (default 3)
 *
 * Pre-requisite: state.query_text or task.description used as query.
 * NOTE: requires embedding pipeline; when no embedding can be derived,
 * the node returns empty learnings (degradation-safe).
 */
export const hippocampusRead: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const limit = (cfg.limit as number) ?? 5;
  const minImportance = (cfg.min_importance as number) ?? 3;

  const task = ctx.run.metadata.input as Record<string, unknown> | undefined;
  const queryText =
    (ctx.state.query_text as string | undefined) ?? (task?.description as string | undefined);

  if (!queryText) {
    return {
      output_data: { learnings: [], skipped: 'no_query_text' },
      state_patch: { learnings: [] },
      transition_key: 'no_learnings',
    };
  }

  // Best-effort: use the compose_context path (already does the embedding lookup
  // and degrades gracefully). The 'learnings_enabled' profile has the layer.
  let learnings: Array<Record<string, unknown>> = [];
  try {
    const composed = await rpc<{ layers: Record<string, unknown> }>('compose_context', {
      p_story_id: ctx.run.story_id,
      p_context_profile_slug: 'learnings_enabled',
      p_run_id: ctx.run.id,
      p_query: queryText,
      p_agent_slug: ctx.run.metadata.input?.agent_slug ?? config.defaultAgentSlug,
      // Story-scoped skládání pod službou vyžaduje žadatele (per-story RBAC) — K-26a.
      ...(ctx.run.actor_user_id ? { p_requester_id: ctx.run.actor_user_id } : {}),
    });
    const layerData = composed.layers?.learnings;
    if (Array.isArray(layerData)) {
      learnings = layerData.slice(0, limit) as Array<Record<string, unknown>>;
    }
  } catch (err) {
    log.safeError('[hippocampus_read] compose_context failed:', err);
  }

  return {
    output_data: { learnings_count: learnings.length, min_importance: minImportance },
    state_patch: { learnings },
    transition_key: learnings.length > 0 ? 'has_learnings' : 'no_learnings',
  };
};

/**
 * hippocampus_write — capture a pattern→resolution learning at the end of a
 * successful reflection run. Importance derived from critic_scores.
 *
 * Config:
 *   - importance: 'critic_score' | number | 'auto'
 *   - pattern_template, resolution_template (optional)
 */
export const hippocampusWrite: NodeHandler = async (ctx) => {
  const cfg = ctx.node.config;
  const task = (ctx.run.metadata.input ?? {}) as Record<string, unknown>;

  const pattern =
    (ctx.state.pattern as string | undefined) ??
    (task.description as string | undefined) ??
    'unspecified_task';

  const resolution =
    (ctx.state.last_generation as string | undefined) ??
    'completed without explicit resolution';

  const criticScores = (ctx.state.last_critic_scores as Record<string, number>) ?? {};

  let importance: number | undefined;
  const cfgImportance = cfg.importance;
  if (cfgImportance === 'critic_score') {
    const overall = (ctx.state.last_critic_overall as number) ?? 0.5;
    importance = Math.max(1, Math.min(10, Math.round(overall * 10)));
  } else if (typeof cfgImportance === 'number') {
    importance = cfgImportance;
  }

  const memoryId = await captureLearning({
    runId: ctx.run.id,
    pattern: pattern.slice(0, 500),
    resolution: resolution.slice(0, 2000),
    criticScores,
    storyId: ctx.run.story_id,
    agentSlug: (task.agent_slug as string) ?? config.defaultAgentSlug,
    importance,
  });

  // Trigger promotion check (no-op if reuse_count below threshold)
  if (memoryId) {
    await maybePromoteLearning(memoryId);
  }

  return {
    output_data: {
      memory_id: memoryId,
      importance,
      pattern_preview: pattern.slice(0, 100),
    },
    state_patch: { last_learning_id: memoryId },
    transition_key: memoryId ? 'captured' : 'skipped',
  };
};
