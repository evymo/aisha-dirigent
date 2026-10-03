import type { NodeHandler } from '../types.js';
import { rpc } from '../postgrest.js';
import { reflectionConfig as config } from '../config.js';

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');
/**
 * cosmos_anchor — record an immutable hash of a reflection-run decision into
 * the existing blockchain_audit_records outbox via the fn_anchor_decision RPC.
 * Cross-chain Cosmos dispatch is handled downstream by svc-blockchain's
 * existing pipeline (retry_pending_blockchain_syncs).
 *
 * Soft-fails when the RPC is unavailable (degradation-safe).
 *
 * Config:
 *   - decision_context: optional jsonb to attach (e.g. final_output_excerpt)
 */
export const cosmosAnchor: NodeHandler = async (ctx) => {
  if (!config.enableCosmosAnchor) {
    return {
      output_data: { skipped: 'cosmos_anchor_disabled' },
      transition_key: 'skipped',
    };
  }

  const cfg = ctx.node.config;

  const decisionContext: Record<string, unknown> = {
    iteration: ctx.iteration,
    last_critic_overall: ctx.state.last_critic_overall ?? null,
    last_learning_id: ctx.state.last_learning_id ?? null,
    final_output_excerpt:
      typeof ctx.state.last_generation === 'string'
        ? (ctx.state.last_generation as string).slice(0, 300)
        : null,
    ...(typeof cfg.decision_context === 'object' && cfg.decision_context !== null
      ? (cfg.decision_context as Record<string, unknown>)
      : {}),
  };

  try {
    const result = await rpc<{
      audit_record_id: string;
      payload_hash: string;
      status: string;
      workflow_name: string;
      workflow_version: number;
      memory_ids_count: number;
    }>('fn_anchor_decision', {
      p_run_id: ctx.run.id,
      p_decision_context: decisionContext,
    });

    return {
      output_data: {
        audit_record_id: result.audit_record_id,
        payload_hash: result.payload_hash,
        status: result.status,
        workflow_name: result.workflow_name,
        workflow_version: result.workflow_version,
        memory_ids_count: result.memory_ids_count,
      },
      state_patch: { cosmos_anchor: result },
      transition_key: 'anchored',
    };
  } catch (err) {
    log.safeWarn('[cosmos_anchor] fn_anchor_decision failed', { error: err instanceof Error ? err.message : String(err) });
    return {
      output_data: { error: 'anchor_failed', detail: String(err).slice(0, 200) },
      transition_key: 'failed',
    };
  }
};
