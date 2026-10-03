/**
 * POST /admin/benchmark — run the quality benchmark on demand (admin only).
 *
 * Benchmarks available models across the task suite, scoring each (heuristic + an
 * LLM-as-judge derived from the best approved+serviceable model — no hardcode; none →
 * heuristic-only), and records one current ai_model_benchmarks row per (model,task_type)
 * via record_model_benchmark. The aggregate 'chat' score then feeds the resolver ranking.
 */
import type { FastifyInstance } from 'fastify';
import { verifyToken, isAdminOrStaff, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { config } from '../config.js';
import { benchmarkModels, makeLlmJudge, type BenchmarkModel } from '../lib/benchmarkRunner.js';
import { selectServiceableProviderForms } from '../lib/llmRouter.js';

async function pgGet<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${config.postgrestUrl}/${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${config.postgrestServiceToken}` },
  });
  if (!res.ok) throw new Error(`GET ${pathAndQuery} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function benchmarkRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body?: { model_ids?: string[]; useJudge?: boolean } }>('/admin/benchmark', async (req, reply) => {
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }
    if (!isAdminOrStaff(user)) return reply.code(403).send({ error: 'Admin required' });

    const rpc = (fn: string, params: Record<string, unknown>): Promise<unknown> => rpcService(fn, params);
    const body = req.body ?? {};
    // Serviceable provider forms in BOTH shapes — the slug ('google-genai') AND the backend-id
    // ('google'). ai_model_registry.provider stores the id form, so the slug form alone would skip
    // every google/gemini model. Used by both the judge pick and the runner's per-model filter
    // (derived from live backends, not a roster).
    const serviceable = new Set(selectServiceableProviderForms());

    // Models to benchmark: available + non-deprecated + CHAT-capable (optionally a caller subset).
    // Sada úloh je chat; embedding model by dostal skóre 0 za úlohy, které neumí ze své
    // podstaty, a to skóre by pak řadilo jeho výběr pro RAG prostor (latest_eval_score).
    const rows = await pgGet<Array<{ id: string; provider: string; model_id: string }>>(
      'ai_model_registry?is_available=eq.true&is_deprecated=eq.false&is_chat_capable=eq.true&select=id,provider,model_id',
    );
    let models: BenchmarkModel[] = rows.map((m) => ({ id: m.id, provider: m.provider, model_id: m.model_id }));
    if (body.model_ids?.length) {
      const wanted = new Set(body.model_ids);
      models = models.filter((m) => wanted.has(m.id));
    }

    // Judge = the best APPROVED + serviceable model (derived, never hardcoded); none → heuristic-only.
    let judge;
    if (body.useJudge !== false) {
      const approved = await pgGet<Array<{ provider: string; model_id: string }>>(
        'ai_model_registry?eval_status=eq.approved&is_available=eq.true&select=provider,model_id&order=model_id.asc',
      );
      const judgeModel = approved.find((m) => serviceable.has(m.provider));
      if (judgeModel) judge = makeLlmJudge({ provider: judgeModel.provider, model_id: judgeModel.model_id });
    }

    const result = await benchmarkModels(rpc, models, { judge, serviceableProviders: serviceable });

    await rpcService('log_audit_event', {
      p_action: 'MODELS_BENCHMARK_TRIGGERED',
      p_metadata: { eval_run_id: result.evalRunId, models: result.modelsBenchmarked, judged: judge !== undefined },
      p_user_id: user.userId,
    }).catch(() => {});

    return reply.send({
      evalRunId: result.evalRunId,
      modelsBenchmarked: result.modelsBenchmarked,
      perModel: result.perModel,
    });
  });
}
