/**
 * RAG eval pipeline (Step 0 of retrieval optimization plan 2026).
 *
 * Endpoints:
 *   POST /rag/eval/run                — run a batch over the active golden set,
 *                                       score each row, persist via audited RPC,
 *                                       then recompute baselines.
 *   POST /rag/eval/baseline/recompute — recompute aggregated baselines only.
 *
 * Both endpoints are service-role only. The /rag/eval/run endpoint is the
 * single entry point called by WF_RAG_EVAL_NIGHTLY — keeping the orchestration
 * server-side (not in n8n) avoids n8n splitInBatches edge cases when scoring
 * has retries.
 *
 * What is measured: kb_retrieval slice only. The eval bypasses compose_context
 * layering (ruleset / agent_memory / learnings) so the baseline reflects raw
 * retrieval quality, which is what Steps 1 (contextual retrieval) and 3
 * (embedding migration) change. A separate /rag/eval/run-full will be added
 * when Step 5 (critic loop) needs to measure end-to-end faithfulness.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyServiceRole, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { chatCompletionWithRetry, LlmCompletionError } from '../lib/llm-completion.js';
import { scoreEvalRun, type RetrievedChunk } from '../lib/rag-eval-judges.js';
import { resolveRagBackend, summarizeForAudit, type ResolvedBackend } from '../lib/capability-resolver.js';
import { embedQueryWithBackend, resolveEmbeddingBackendForSpace, type EmbeddingBackend } from '../lib/embed-query-in-space.js';
import { scoreRetrieval } from '../lib/rag-retrieval-metrics.js';

/** One per-(context_profile, language) row from fn_compare_rag_embedding_models. */
interface EmbeddingComparisonRow {
  context_profile_slug: string | null;
  language: string;
  a_ndcg: number | null;
  b_ndcg: number | null;
  a_recall: number | null;
  b_recall: number | null;
  a_mrr: number | null;
  b_mrr: number | null;
  a_composite: number | null;
  b_composite: number | null;
  a_scored_rows: number;
  b_scored_rows: number;
  ndcg_delta: number;
  /** model_a id | model_b id | 'tie' | 'insufficient_data'. */
  winner: string;
}

/** Pick the API key from the env var the resolver pointed at (if any). */
function apiKeyFor(resolved: ResolvedBackend | null): string | undefined {
  if (!resolved?.auth_env_var) return undefined;
  return process.env[resolved.auth_env_var] ?? undefined;
}

interface GoldenRow {
  id: string;
  slug: string;
  question: string;
  ground_truth_answer: string;
  expected_chunk_slugs: string[];
  context_profile_slug: string | null;
  expertise_area_slug: string | null;
  story_id: string | null;
  difficulty: number | null;
  language: string;
  tags: string[];
}

interface RetrievedRow {
  knowledge_item_id: string;
  chunk_id: string | null;
  chunk_text: string | null;
  chunk_slug: string | null;
  similarity: number | null;
}

const ANSWER_SYSTEM =
  'You are AISHA, a precise assistant that answers strictly from the provided context. ' +
  'If the context does not contain the answer, say so. Cite relevant chunk numbers in [brackets]. ' +
  'Keep answers concise — 1 to 4 sentences — in the same language as the question.';

function buildAnswerUserPrompt(question: string, chunks: RetrievedChunk[]): string {
  const ctx = chunks
    .map((c, i) => `[${i + 1}] ${c.text.slice(0, 1500)}`)
    .join('\n\n');
  return `Context:\n${ctx || '(no context retrieved)'}\n\nQuestion:\n${question}\n\nAnswer:`;
}

interface RunSummary {
  batch_id: string;
  embedding_model: string;
  llm_model: string;
  judge_model: string;
  golden_total: number;
  scored: number;
  failed: number;
  baseline_rows_upserted: number;
  duration_ms: number;
  failures: Array<{ golden_slug: string; reason: string }>;
}

export async function ragEvalRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // POST /rag/eval/run — orchestrate a batch
  // ---------------------------------------------------------------------------
  app.post<{
    Body: {
      batch_id?: string;
      profile_slug?: string;
      language?: string;
      limit?: number;
      embedding_model?: string;
      llm_model?: string;
      judge_model?: string;
      retrieval_limit?: number;
      similarity_threshold?: number;
    };
  }>('/rag/eval/run', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401)
        .send({ error: 'Service-role required' });
    }

    const body = req.body ?? {};
    const batchId = body.batch_id ?? crypto.randomUUID();
    // Kandidát je buď výslovně pojmenovaný (sweep porovnává konkrétní modely), nebo
    // TEN, kterým instance právě zapisuje korpus v1 — vybraný resolverem prostoru.
    // ⛔ Dřív `?? config.embeddingModel` = literál `text-embedding-3-small` (1536):
    // eval bez parametru měřil model, který do žádného zdejšího prostoru nepatří.
    const embeddingModel =
      body.embedding_model ?? (await resolveEmbeddingBackendForSpace('v1'))?.model_id ?? null;
    if (!embeddingModel) {
      return reply.code(503).send({
        error: 'No embedding model to evaluate',
        hint: 'Pass embedding_model, or make a v1-space embedding model available ' +
              '(fn_resolve_embedding_model_for_space(v1) returned nothing).',
      });
    }
    const retrievalLimit = body.retrieval_limit ?? 6;
    const similarityThreshold = body.similarity_threshold ?? 0.3;

    const started = Date.now();

    // ── Step 1.5: dynamic backend resolution ─────────────────────────────
    // Ask AISHA which LLM to use for (a) generating answers and (b) acting
    // as judge — based on live ai_provider_registry health + benchmarks +
    // budget. If the resolver finds nothing, the body-level overrides
    // (llm_model, judge_model) are accepted as last-resort manual hints;
    // ultimately if neither path yields a backend, the eval batch refuses
    // to start rather than silently fall back to an unknown default.
    const answerResolved = await resolveRagBackend('rag.eval_answer');
    const judgeResolved = await resolveRagBackend('rag.eval_judge');

    const llmModel = body.llm_model ?? answerResolved?.model_id;
    const judgeModel = body.judge_model ?? judgeResolved?.model_id ?? llmModel;

    if (!llmModel || !judgeModel) {
      return reply.code(503).send({
        error: 'No LLM backend available for RAG eval',
        hint: 'aisha_resolve_clow_backend returned no provider for rag.eval_answer / rag.eval_judge. ' +
              'Populate ai_provider_registry, run WF_PROVIDER_HEALTH_PROBE, or pass llm_model in body to override.',
        answer_resolution: summarizeForAudit(answerResolved),
        judge_resolution: summarizeForAudit(judgeResolved),
      });
    }

    // ── Step 1.6: resolve the CANDIDATE embedding model ──────────────────
    // The eval embeds the query with EXACTLY this model in its native space, so the
    // recorded embedding_model is the model that actually produced the vector (it used
    // to be a label while the query was always embedded with the hardcoded v1 OpenAI
    // model). Fail loud if the named model has no live embedding backend — silently
    // substituting a different model would compare the query against a corpus embedded
    // by a DIFFERENT model (the model-as-index-constant invariant).
    const [embModel] = await rpcService<EmbeddingBackend[]>('fn_resolve_embedding_model', {
      p_model_id: embeddingModel,
    });
    if (!embModel) {
      return reply.code(503).send({
        error: 'Embedding model not resolvable',
        hint: `No enabled is_embedding provider serves "${embeddingModel}". ` +
              'Register/enable it in ai_model_registry (is_embedding) + ai_provider_registry.',
      });
    }
    const embModelVersion = `${embModel.provider_slug}:${embModel.model_id}`;

    // ── Step 1: fetch active golden set ──────────────────────────────────
    let golden: GoldenRow[];
    try {
      golden = await rpcService<GoldenRow[]>('fn_get_rag_eval_golden_set', {
        p_language: body.language ?? null,
        p_limit: body.limit ?? null,
        p_profile_slug: body.profile_slug ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err: msg }, 'rag_eval golden fetch failed');
      return reply.code(502).send({ error: 'Failed to fetch golden set', detail: msg });
    }

    if (!Array.isArray(golden) || golden.length === 0) {
      return reply.code(404).send({
        error: 'No active golden records',
        hint: 'Seed via aisha/db/seed/core/31_rag_eval_golden.sql (npm run db:seed:local)',
      });
    }

    const failures: Array<{ golden_slug: string; reason: string }> = [];
    let scored = 0;

    // ── Step 2: score each golden record sequentially ────────────────────
    //   Sequential not parallel: token/cost control + provider rate limits.
    //   Each record makes 3+ LLM calls (1 answer + up to 4 judges).
    for (const row of golden) {
      try {
        // 2a. Embed the question with the CANDIDATE model in its native space (honest) via the
        //     shared embed-query-in-space seam (same code path the prod search route uses).
        const embedded = await embedQueryWithBackend(embModel, row.question);

        // 2b. Retrieve top-N chunks in the MATCHING vector space via mcp_search_knowledge_v3
        //     (wires in the previously-dead v3 v1/v2 dispatch). v1 ⇒ embedding vector(1024);
        //     v2 ⇒ embedding_v2 halfvec(2560). The query vector goes to the matching param.
        const retrieved = await rpcService<RetrievedRow[]>('mcp_search_knowledge_v3', {
          p_category: null,
          p_context_tags: row.tags && row.tags.length > 0 ? row.tags : null,
          p_expertise_slug: row.expertise_area_slug,
          p_include_ai_instructions: true,
          p_item_types: null,
          p_limit: retrievalLimit,
          p_model_pref: embedded.ragSpace,
          p_query_embedding_v1: embedded.queryEmbeddingV1,
          p_query_embedding_v2: embedded.queryEmbeddingV2,
          // Brick2-guard: pin the corpus to the SAME model that produced the query vector —
          // a HARD identity filter, so the eval never cosine-compares across embedding spaces.
          p_query_model: embModel.model_id,
          p_query_text: row.question,
          p_similarity_threshold: similarityThreshold,
          p_story_id: row.story_id,
        });

        const chunks: RetrievedChunk[] = (retrieved ?? [])
          .filter((r) => r.chunk_text && r.chunk_text.length > 0)
          .map((r) => ({
            id: r.chunk_id ?? r.knowledge_item_id,
            text: r.chunk_text ?? '',
            slug: r.chunk_slug ?? null,
          }));

        // 2b-bis. Rank-aware retrieval quality (THE metric for choosing an embedding
        //   model) — retrieved slugs in search-rank order vs the golden ground-truth set.
        //   num_expected=0 (golden not labelled with expected_chunk_slugs) ⇒ unscored, so
        //   the sweep aggregate excludes it rather than counting 0 as a real score.
        const retrievalMetrics = scoreRetrieval(
          chunks.map((c) => c.slug),
          row.expected_chunk_slugs ?? [],
          retrievalLimit,
        );

        // 2c. Generate answer via the resolved primary LLM (or body override)
        const completion = await chatCompletionWithRetry({
          model: llmModel,
          messages: [
            { role: 'system', content: ANSWER_SYSTEM },
            { role: 'user', content: buildAnswerUserPrompt(row.question, chunks) },
          ],
          temperature: 0,
          max_tokens: 512,
          base_url: answerResolved?.endpoint_url ?? undefined,
          api_key: apiKeyFor(answerResolved),
          auth_env_var: answerResolved?.auth_env_var,
          provider_slug: answerResolved?.provider_slug ?? undefined,
        });
        const generatedAnswer = completion.text;

        // 2d. Score against 4 metrics (judge LLM also resolved dynamically)
        const scores = await scoreEvalRun({
          question: row.question,
          generated_answer: generatedAnswer,
          ground_truth_answer: row.ground_truth_answer,
          retrieved_chunks: chunks,
          expected_chunk_slugs: row.expected_chunk_slugs ?? [],
          judge_model: judgeModel,
          judge_base_url: judgeResolved?.endpoint_url ?? undefined,
          judge_api_key: apiKeyFor(judgeResolved),
          judge_auth_env_var: judgeResolved?.auth_env_var,
          judge_provider_slug: judgeResolved?.provider_slug ?? undefined,
        });

        // 2e. Persist via audited RPC
        await rpcService('fn_record_rag_eval_run_audited', {
          p_ai_run_id: null,
          p_batch_id: batchId,
          p_context_profile_slug: row.context_profile_slug,
          p_cost: null,
          p_embedding_model: embeddingModel,
          p_embedding_model_version: embModelVersion,
          p_generated_answer: generatedAnswer,
          p_golden_id: row.id,
          p_judge_model: judgeModel,
          p_latency_ms: completion.latency_ms + scores.judge_latency_ms_total,
          p_llm_model: llmModel,
          p_metadata: {
            language: row.language,
            difficulty: row.difficulty,
            tags: row.tags,
            answer_tokens: completion.usage.total_tokens,
            judge_tokens: scores.judge_tokens_total,
            set_based_precision: scores.set_based_precision,
            set_based_recall: scores.set_based_recall,
            reasoning: scores.reasoning,
            answer_resolution: summarizeForAudit(answerResolved),
            judge_resolution: summarizeForAudit(judgeResolved),
            // Brick 1c: rank-aware retrieval metrics (the embedding-model selection signal).
            rag_space: embModel.rag_space,
            retrieval: retrievalMetrics,
          },
          p_retrieved_chunk_ids: chunks.map((c) => c.id),
          p_scores: {
            faithfulness: scores.faithfulness,
            answer_relevancy: scores.answer_relevancy,
            context_precision: scores.context_precision,
            context_recall: scores.context_recall,
          },
        });

        scored += 1;
      } catch (err) {
        const reason = err instanceof LlmCompletionError
          ? `${err.statusCode} ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
        req.log.warn({ golden_slug: row.slug, reason }, 'rag_eval row failed');
        failures.push({ golden_slug: row.slug, reason });
      }
    }

    // ── Step 3: recompute baselines so dashboard reflects this batch ─────
    let baselineRowsUpserted = 0;
    try {
      baselineRowsUpserted = await rpcService<number>('fn_compute_rag_baseline_audited', {
        p_period_hours: 24,
      });
    } catch (err) {
      req.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'baseline recompute failed (soft-fail)');
    }

    const summary: RunSummary = {
      batch_id: batchId,
      embedding_model: embeddingModel,
      llm_model: llmModel,
      judge_model: judgeModel,
      golden_total: golden.length,
      scored,
      failed: failures.length,
      baseline_rows_upserted: baselineRowsUpserted,
      duration_ms: Date.now() - started,
      failures: failures.slice(0, 50),
    };

    return reply.send({ ok: true, ...summary });
  });

  // ---------------------------------------------------------------------------
  // POST /rag/eval/baseline/recompute — recompute baselines only
  // ---------------------------------------------------------------------------
  app.post<{
    Body: { period_hours?: number };
  }>('/rag/eval/baseline/recompute', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401)
        .send({ error: 'Service-role required' });
    }

    const periodHours = req.body?.period_hours ?? 24;
    try {
      const rows = await rpcService<number>('fn_compute_rag_baseline_audited', {
        p_period_hours: periodHours,
      });
      return reply.send({ ok: true, rows_upserted: rows, period_hours: periodHours });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err: msg }, 'baseline recompute failed');
      return reply.code(502).send({ error: 'Baseline recompute failed', detail: msg });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /rag/eval/compare — head-to-head verdict for two embedding models.
  // Run /rag/eval/run once per candidate (different embedding_model), then call
  // this for the per-(context_profile, language) winner by nDCG@K + an overall
  // tally. This is the signal AISHA reads to pin a context's embedding space
  // (brick 2). 'insufficient_data' when the golden has no expected_chunk_slugs
  // for a group — never a fabricated winner.
  // ---------------------------------------------------------------------------
  app.post<{
    Body: { model_a?: string; model_b?: string; period_hours?: number };
  }>('/rag/eval/compare', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401)
        .send({ error: 'Service-role required' });
    }
    const modelA = req.body?.model_a;
    const modelB = req.body?.model_b;
    if (!modelA || !modelB || modelA === modelB) {
      return reply.code(400).send({ error: 'model_a and model_b are required and must differ' });
    }
    try {
      const groups = await rpcService<EmbeddingComparisonRow[]>('fn_compare_rag_embedding_models', {
        p_model_a: modelA,
        p_model_b: modelB,
        p_period_hours: req.body?.period_hours ?? 168,
      });
      const tally: Record<string, number> = { [modelA]: 0, [modelB]: 0, tie: 0, insufficient_data: 0 };
      for (const r of groups ?? []) tally[r.winner] = (tally[r.winner] ?? 0) + 1;
      const overall =
        (tally[modelA] ?? 0) > (tally[modelB] ?? 0) ? modelA
        : (tally[modelB] ?? 0) > (tally[modelA] ?? 0) ? modelB
        : (tally[modelA] ?? 0) === 0 ? 'insufficient_data'
        : 'tie';
      return reply.send({ ok: true, model_a: modelA, model_b: modelB, overall_winner: overall, tally, groups: groups ?? [] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err: msg }, 'embedding comparison failed');
      return reply.code(502).send({ error: 'Embedding comparison failed', detail: msg });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /rag/eval/health — quick smoke for nightly cron preflight.
  //
  // Returns what the capability-resolver picks RIGHT NOW for each RAG
  // purpose, plus the embedding model in current use. n8n cron consumes
  // this before triggering /rag/eval/run so it can short-circuit and emit
  // a clear "no provider available" audit row instead of running a doomed
  // batch.
  // ---------------------------------------------------------------------------
  app.get('/rag/eval/health', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401)
        .send({ error: 'Service-role required' });
    }
    const [answer, judge, prefix, embeddingV1] = await Promise.all([
      resolveRagBackend('rag.eval_answer', { no_cache: true }),
      resolveRagBackend('rag.eval_judge', { no_cache: true }),
      resolveRagBackend('rag.contextual_prefix', { no_cache: true }),
      resolveEmbeddingBackendForSpace('v1'),
    ]);
    const ready = answer !== null && judge !== null && embeddingV1 !== null;
    return reply.send({
      ok: ready,
      // Model, kterým se právě zapisuje korpus v1 — null = není čím embedovat (ne default).
      embedding_model: embeddingV1?.model_id ?? null,
      resolved: {
        rag_eval_answer: summarizeForAudit(answer),
        rag_eval_judge: summarizeForAudit(judge),
        rag_contextual_prefix: summarizeForAudit(prefix),
      },
    });
  });
}
