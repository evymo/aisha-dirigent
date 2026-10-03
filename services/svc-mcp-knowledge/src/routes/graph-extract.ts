/**
 * Hippocampus graph extraction worker (Step 7.2 of retrieval optimization plan 2026).
 *
 * Endpoint:
 *   POST /graph/extract/run  — pick up to batch_size succeeded ai_runs that
 *                              don't yet have a 'graph.extraction_completed'
 *                              audit row, run the rag.graph_extract LLM over
 *                              each, and upsert Concept nodes + edges via
 *                              fn_apply_graph_extraction_audited.
 *
 * Service-role only. Mirrors the rag-eval.ts pattern:
 *   verifyServiceRole → resolveRagBackend → rpcService loop → summary.
 *
 * Per-run failure handling: a parse error, an LLM timeout, or an RPC
 * failure logs the run as a soft failure (added to `failures[]`) and the
 * loop continues. The audit row is only written by fn_apply_graph_extraction_audited
 * on success, so failed runs naturally stay in the "needs extract" queue
 * for the next batch.
 *
 * Wired by n8n: WF_GRAPH_EXTRACT_NIGHTLY runs daily at 03:30 UTC.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyServiceRole, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { chatCompletionWithRetry, LlmCompletionError } from '../lib/llm-completion.js';
import { resolveRagBackend, summarizeForAudit, type ResolvedBackend } from '../lib/capability-resolver.js';
import {
  buildGraphExtractUserPrompt,
  GRAPH_EXTRACT_SYSTEM,
  parseGraphExtractJson,
} from '../lib/graph-extract.js';

interface RunNeedingExtract {
  run_id: string;
  kind: string;
  story_id: string | null;
  finished_at: string;
}

interface ApplyResult {
  run_id: string;
  nodes_added: number;
  edges_added: number;
  edges_skipped: number;
}

interface RunSummary {
  batch_id: string;
  judge_model: string;
  candidates: number;
  processed: number;
  failed: number;
  nodes_added: number;
  edges_added: number;
  edges_skipped: number;
  duration_ms: number;
  failures: Array<{ run_id: string; reason: string }>;
}

function apiKeyFor(resolved: ResolvedBackend | null): string | undefined {
  if (!resolved?.auth_env_var) return undefined;
  return process.env[resolved.auth_env_var] ?? undefined;
}

export async function graphExtractRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      batch_id?: string;
      batch_size?: number;
      max_age_hours?: number;
      judge_model?: string;
    };
  }>('/graph/extract/run', async (req: FastifyRequest<{
    Body: {
      batch_id?: string;
      batch_size?: number;
      max_age_hours?: number;
      judge_model?: string;
    };
  }>, reply: FastifyReply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401)
        .send({ error: 'Service-role required' });
    }

    const body = req.body ?? {};
    const batchId = body.batch_id ?? crypto.randomUUID();
    const batchSize = Math.max(1, Math.min(100, body.batch_size ?? 20));
    const maxAgeHours = Math.max(1, Math.min(720, body.max_age_hours ?? 168));

    const started = Date.now();

    // Dynamic backend resolution — no hardcoded model.
    const resolved = await resolveRagBackend('rag.graph_extract');
    const judgeModel = body.judge_model ?? resolved?.model_id;
    if (!judgeModel) {
      return reply.code(503).send({
        error: 'No LLM backend available for rag.graph_extract',
        hint: 'aisha_resolve_clow_backend returned no provider. Populate ai_provider_registry, ' +
              'run WF_PROVIDER_HEALTH_PROBE, or pass judge_model in body to override.',
        resolution: summarizeForAudit(resolved),
      });
    }

    // ── 1. Discover runs needing extraction (oldest first, capped) ──────
    let candidates: RunNeedingExtract[];
    try {
      candidates = await rpcService<RunNeedingExtract[]>('fn_get_runs_needing_graph_extract', {
        p_batch_size: batchSize,
        p_max_age_hours: maxAgeHours,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err: msg }, 'graph_extract candidate fetch failed');
      return reply.code(502).send({ error: 'Failed to fetch candidates', detail: msg });
    }

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return reply.send({
        batch_id: batchId,
        judge_model: judgeModel,
        candidates: 0,
        processed: 0,
        failed: 0,
        nodes_added: 0,
        edges_added: 0,
        edges_skipped: 0,
        duration_ms: Date.now() - started,
        failures: [],
        hint: 'No runs needing extraction. The queue is caught up.',
      } satisfies RunSummary & { hint: string });
    }

    const failures: Array<{ run_id: string; reason: string }> = [];
    let processed = 0;
    let nodesAdded = 0;
    let edgesAdded = 0;
    let edgesSkipped = 0;

    // ── 2. Process each run sequentially (cost control + provider rate limits) ──
    for (const cand of candidates) {
      try {
        // 2a. Fetch aggregated context
        const ctx = await rpcService<unknown>('fn_get_run_extract_context', {
          p_run_id: cand.run_id,
        });

        // 2b. Call LLM in JSON mode
        const completion = await chatCompletionWithRetry({
          model: judgeModel,
          messages: [
            { role: 'system', content: GRAPH_EXTRACT_SYSTEM },
            { role: 'user', content: buildGraphExtractUserPrompt(ctx) },
          ],
          temperature: 0,
          max_tokens: 1500,
          json_mode: true,
          base_url: resolved?.endpoint_url ?? undefined,
          api_key: apiKeyFor(resolved),
          // Bez resolveru (resolved = null) zůstane neuvedené → klíč spárovaný
          // s endpointem z prostředí; s resolverem rozhoduje jeho prohlášení.
          auth_env_var: resolved?.auth_env_var,
          provider_slug: resolved?.provider_slug ?? undefined,
        });

        // 2c. Strict parse — soft-fail to retry next batch on shape errors
        const payload = parseGraphExtractJson(completion.text);
        if (payload === null) {
          failures.push({
            run_id: cand.run_id,
            reason: 'LLM output failed strict JSON parse / shape validation',
          });
          continue;
        }

        // 2d. Apply server-side (validates + upserts + audit row, atomic)
        const result = await rpcService<ApplyResult>('fn_apply_graph_extraction_audited', {
          p_extraction: payload,
          p_judge_model: judgeModel,
          p_run_id: cand.run_id,
        });

        processed += 1;
        nodesAdded += result.nodes_added ?? 0;
        edgesAdded += result.edges_added ?? 0;
        edgesSkipped += result.edges_skipped ?? 0;
      } catch (err) {
        const msg = err instanceof LlmCompletionError ? err.message
          : err instanceof Error ? err.message
          : String(err);
        failures.push({ run_id: cand.run_id, reason: msg });
      }
    }

    const summary: RunSummary = {
      batch_id: batchId,
      judge_model: judgeModel,
      candidates: candidates.length,
      processed,
      failed: failures.length,
      nodes_added: nodesAdded,
      edges_added: edgesAdded,
      edges_skipped: edgesSkipped,
      duration_ms: Date.now() - started,
      failures,
    };
    req.log.info(summary, 'graph_extract batch complete');
    return reply.send(summary);
  });
}
