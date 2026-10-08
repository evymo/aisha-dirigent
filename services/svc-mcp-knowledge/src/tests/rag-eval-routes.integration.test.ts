/**
 * Integration tests for /rag/eval/* routes (Step 0 of optimization plan 2026).
 *
 * Uses Fastify.inject with all external deps mocked:
 *   - verifyServiceRole (auth.ts)
 *   - rpcService (postgrest.ts)         → fakes RPC responses
 *   - embed (embed-dispatcher.ts) → fake embedding vectors
 *   - chatCompletionWithRetry (llm-completion.ts) → fake LLM answers
 *   - scoreEvalRun (rag-eval-judges.ts) → fake scores
 *
 * Why this matters: the eval orchestration is the longest call chain in
 * svc-mcp-knowledge (golden fetch → embed → retrieve → LLM answer → 4
 * judge calls → audited RPC). A regression in the chain — missing arg,
 * swapped Promise, wrong dependency ordering — would silently corrupt
 * the eval baseline that every later optimization step measures against.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Fastify is resolved dynamically so this test file can be collected even in
// worktrees that haven't run `npm install` inside services/svc-mcp-knowledge.
// In CI (where deps are installed), the import succeeds and the suite runs.
// In a fresh worktree the suite is skipped — gate test + unit tests still
// cover the static + business-logic parts of the route.
let Fastify: typeof import('fastify').default | null = null;
try {
  Fastify = (await import('fastify')).default;
} catch {
  Fastify = null;
}
const describeIfFastify = Fastify ? describe : describe.skip;

class MockAuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

const verifyServiceRoleMock = vi.hoisted(() => vi.fn());
vi.mock('../auth.js', () => ({
  verifyServiceRole: verifyServiceRoleMock,
  AuthError: MockAuthError,
}));

const rpcServiceMock = vi.hoisted(() => vi.fn());
// Čtečka pověření (2026-10-02): v testu trezor = prostředí procesu (tvar createCredentialReader).
vi.mock('../lib/credentials.js', () => ({
  credentials: () => ({ get: async (n: string) => process.env[n] ?? null }),
}));
vi.mock('../postgrest.js', () => ({
  rpcService: rpcServiceMock,
}));

// brick1 moved the eval query embedding from generateEmbeddings() to embed() (embed-dispatcher) +
// mapBackendKind. Mock embed; keep the REAL mapBackendKind so the route's backend-kind map resolves.
const embedMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/embed-dispatcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/embed-dispatcher.js')>();
  return {
    ...actual,
    embed: embedMock,
    // Cesty volají embedSIdentitou (identita vah k vektoru); vektory dál dodává embedMock.
    embedSIdentitou: async (o: Parameters<typeof actual.embedSIdentitou>[0]) => ({
      vectors: (await embedMock(o)) as number[][],
      identita: null,
    }),
  };
});

// fn_resolve_embedding_model returns the CANDIDATE embedding backend — brick1c re-embeds the query
// with exactly this model (a new resolver call between the judge resolve and the golden fetch).
const EMB_MODEL = {
  provider_slug: 'openai',
  model_id: 'text-embedding-3-small',
  backend_kind: 'direct_cloud',
  auth_env_var: 'OPENAI_API_KEY',
  endpoint_url: null,
};

const chatCompletionWithRetryMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/llm-completion.js', () => ({
  chatCompletionWithRetry: chatCompletionWithRetryMock,
  LlmCompletionError: class extends Error {
    statusCode: number;
    constructor(status: number, message: string) {
      super(message);
      this.statusCode = status;
    }
  },
}));

const scoreEvalRunMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/rag-eval-judges.js', () => ({
  scoreEvalRun: scoreEvalRunMock,
}));

// ⛔ config.embeddingModel (literál text-embedding-3-small) je pryč (2026-09-13): bez
// `embedding_model` v těle se kandidát bere z resolveru prostoru v1 — první RPC volání běhu.
const SPACE_V1 = [{ ...EMB_MODEL, model_id: 'lens-embedding', provider_slug: 'vllm-local', embedding_dimensions: 1024, rag_space: 'v1' }];

async function buildApp() {
  if (!Fastify) throw new Error('fastify not available — test should be skipped');
  const { ragEvalRoutes } = await import('../routes/rag-eval.js');
  const app = Fastify({ logger: false });
  await app.register(ragEvalRoutes);
  return app;
}

const goldenFixture = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'es-en-rule',
    question: 'What is required for every SECURITY DEFINER function?',
    ground_truth_answer: 'SET search_path TO public is mandatory.',
    expected_chunk_slugs: ['rule-security-definer'],
    context_profile_slug: 'evidence_strict',
    expertise_area_slug: null,
    story_id: null,
    difficulty: 4,
    language: 'en',
    tags: ['rules'],
  },
];

const retrievedFixture = [
  {
    knowledge_item_id: '22222222-2222-2222-2222-222222222222',
    chunk_id: '33333333-3333-3333-3333-333333333333',
    chunk_text: 'SECURITY DEFINER functions must SET search_path TO public…',
    chunk_slug: 'rule-security-definer',
    similarity: 0.91,
  },
];

/**
 * Resolver mock fixture: returns a healthy LLM backend. Tests using the
 * `/rag/eval/run` route call resolveRagBackend twice (answer + judge) BEFORE
 * the golden fetch — prepend this to rpcServiceMock so the resolver always
 * succeeds in the test environment unless the test specifically wants to
 * simulate "no backend available".
 */
function resolverMockHealthy() {
  return {
    provider_slug: 'test-vllm',
    model_id: 'test-model',
    backend_kind: 'local_vllm',
    endpoint_url: 'http://test/v1',
    auth_env_var: 'VLLM_API_KEY',
    cost_class: 'budget',
    health_status: 'healthy',
    overall_score: 0.9,
  };
}

beforeEach(async () => {
  verifyServiceRoleMock.mockReset();
  rpcServiceMock.mockReset();
  chatCompletionWithRetryMock.mockReset();
  scoreEvalRunMock.mockReset();
  // Clear the in-memory cache inside capability-resolver — otherwise tests
  // would share resolved entries across describe blocks.
  const { clearCapabilityCache } = await import('../lib/capability-resolver.js');
  clearCapabilityCache();
});

afterEach(() => {
  vi.clearAllMocks();
});

describeIfFastify('POST /rag/eval/run', () => {
  it('returns 401 when service-role header missing', async () => {
    verifyServiceRoleMock.mockImplementation(() => {
      throw new MockAuthError('missing', 401);
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/rag/eval/run',
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'Service-role required' });
    expect(rpcServiceMock).not.toHaveBeenCalled();
  });

  it('returns 404 when golden set is empty', async () => {
    verifyServiceRoleMock.mockImplementation(() => undefined);
    rpcServiceMock
      .mockResolvedValueOnce(SPACE_V1) // fn_resolve_embedding_model_for_space(v1) — bez embedding_model v těle
      // Resolver: rag.eval_answer + rag.eval_judge
      .mockResolvedValueOnce(resolverMockHealthy())
      .mockResolvedValueOnce(resolverMockHealthy())
      .mockResolvedValueOnce([EMB_MODEL]) // fn_resolve_embedding_model (brick1c re-embed)
      // fn_get_rag_eval_golden_set → empty
      .mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/rag/eval/run',
      headers: { authorization: 'Bearer x' },
      payload: { batch_id: 'b1' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'No active golden records' });
  });

  it('⛔ 503 bez embedding_model a bez modelu prostoru v1 — žádný literální default', async () => {
    verifyServiceRoleMock.mockImplementation(() => undefined);
    rpcServiceMock.mockResolvedValueOnce([]); // fn_resolve_embedding_model_for_space(v1) → nic

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/rag/eval/run',
      headers: { authorization: 'Bearer x' },
      payload: { batch_id: 'b0' },
    });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'No embedding model to evaluate' });
    expect(rpcServiceMock.mock.calls[0][0]).toBe('fn_resolve_embedding_model_for_space');
    expect(rpcServiceMock.mock.calls[0][1]).toMatchObject({ p_rag_space: 'v1' });
  });

  it('returns 503 when capability-resolver yields no LLM backend AND body has no override', async () => {
    verifyServiceRoleMock.mockImplementation(() => undefined);
    rpcServiceMock
      .mockResolvedValueOnce(SPACE_V1) // fn_resolve_embedding_model_for_space(v1)
      .mockResolvedValueOnce({}) // resolver answer → null
      .mockResolvedValueOnce({}); // resolver judge → null
    // Ensure no env fallback for this test
    delete process.env.RAG_EVAL_LLM_MODEL;
    delete process.env.RAG_JUDGE_MODEL;

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/rag/eval/run',
      headers: { authorization: 'Bearer x' },
      payload: { batch_id: 'b1' }, // no llm_model / judge_model override
    });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toMatchObject({
      error: 'No LLM backend available for RAG eval',
    });
  });

  it('orchestrates end-to-end: embed → retrieve → answer → score → record → recompute baseline', async () => {
    verifyServiceRoleMock.mockImplementation(() => undefined);
    rpcServiceMock
      // 0. capability-resolver answer + judge (Step 1.5)
      .mockResolvedValueOnce(resolverMockHealthy())
      .mockResolvedValueOnce(resolverMockHealthy())
      .mockResolvedValueOnce([EMB_MODEL]) // fn_resolve_embedding_model (brick1c re-embed)
      // 1. fn_get_rag_eval_golden_set
      .mockResolvedValueOnce(goldenFixture)
      // 2. mcp_search_knowledge_v2
      .mockResolvedValueOnce(retrievedFixture)
      // 3. fn_record_rag_eval_run_audited
      .mockResolvedValueOnce('44444444-4444-4444-4444-444444444444')
      // 4. fn_compute_rag_baseline_audited
      .mockResolvedValueOnce(3);
    embedMock.mockResolvedValueOnce([Array(1536).fill(0.01)]);
    chatCompletionWithRetryMock.mockResolvedValueOnce({
      text: 'SET search_path TO public is mandatory.',
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      latency_ms: 800,
      model: 'gpt-4o-mini',
      finish_reason: 'stop',
    });
    scoreEvalRunMock.mockResolvedValueOnce({
      faithfulness: 0.95,
      answer_relevancy: 0.9,
      context_precision: 1.0,
      context_recall: 1.0,
      judge_tokens_total: 320,
      judge_latency_ms_total: 1200,
      reasoning: {},
      set_based_precision: true,
      set_based_recall: true,
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/rag/eval/run',
      headers: { authorization: 'Bearer x' },
      payload: {
        batch_id: 'batch-001',
        embedding_model: 'text-embedding-3-small',
        llm_model: 'gpt-4o-mini',
        judge_model: 'gpt-4o-mini',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.batch_id).toBe('batch-001');
    expect(body.golden_total).toBe(1);
    expect(body.scored).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.baseline_rows_upserted).toBe(3);
    // Běh říká, PRO KOHO vyhledání měřil: publikum se hledání neposílá → jen korpus `public`.
    expect(body.retrieval_audience).toBe('none:public-corpus');
    const hledani = rpcServiceMock.mock.calls.find((c) => c[0] === 'mcp_search_knowledge_v3');
    expect(hledani, 'vyhodnocení hledá přes v3').toBeDefined();
    expect(Object.keys(hledani![1] as Record<string, unknown>)).not.toContain('p_audience_user_id');
    const zaznam = rpcServiceMock.mock.calls.find((c) => c[0] === 'fn_record_rag_eval_run_audited');
    expect((zaznam![1] as { p_metadata: Record<string, unknown> }).p_metadata.retrieval_audience).toBe('none:public-corpus');

    // Verify the audited record RPC got the scores
    const recordCall = rpcServiceMock.mock.calls.find(
      (c) => c[0] === 'fn_record_rag_eval_run_audited',
    );
    expect(recordCall, 'fn_record_rag_eval_run_audited must be called').toBeDefined();
    const recordArgs = recordCall![1];
    expect(recordArgs.p_golden_id).toBe(goldenFixture[0].id);
    expect(recordArgs.p_scores).toMatchObject({
      faithfulness: 0.95,
      answer_relevancy: 0.9,
      context_precision: 1.0,
      context_recall: 1.0,
    });
    expect(recordArgs.p_retrieved_chunk_ids).toContain(retrievedFixture[0].chunk_id);
  });

  it('aggregates per-row failures without aborting the batch', async () => {
    verifyServiceRoleMock.mockImplementation(() => undefined);
    rpcServiceMock
      .mockResolvedValueOnce(SPACE_V1) // fn_resolve_embedding_model_for_space(v1)
      // resolver answer + judge
      .mockResolvedValueOnce(resolverMockHealthy())
      .mockResolvedValueOnce(resolverMockHealthy())
      .mockResolvedValueOnce([EMB_MODEL]) // fn_resolve_embedding_model (brick1c re-embed)
      .mockResolvedValueOnce([
        { ...goldenFixture[0], slug: 'g-ok' },
        { ...goldenFixture[0], id: '99999999-9999-9999-9999-999999999999', slug: 'g-fail' },
      ])
      // For g-ok: retrieve → record
      .mockResolvedValueOnce(retrievedFixture)
      .mockResolvedValueOnce('rec-ok')
      // For g-fail: retrieve throws (simulate)
      .mockRejectedValueOnce(new Error('retrieve exploded'))
      // baseline recompute
      .mockResolvedValueOnce(2);
    embedMock
      .mockResolvedValueOnce([Array(1536).fill(0.01)])
      .mockResolvedValueOnce([Array(1536).fill(0.02)]);
    chatCompletionWithRetryMock.mockResolvedValueOnce({
      text: 'ok',
      usage: { total_tokens: 100, prompt_tokens: 80, completion_tokens: 20 },
      latency_ms: 200, model: 'm', finish_reason: 'stop',
    });
    scoreEvalRunMock.mockResolvedValueOnce({
      faithfulness: 0.9, answer_relevancy: 0.85, context_precision: 1, context_recall: 1,
      judge_tokens_total: 100, judge_latency_ms_total: 200,
      reasoning: {}, set_based_precision: true, set_based_recall: true,
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/rag/eval/run',
      headers: { authorization: 'Bearer x' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.golden_total).toBe(2);
    expect(body.scored).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.failures[0].golden_slug).toBe('g-fail');
    expect(body.failures[0].reason).toContain('retrieve exploded');
  });

  it('soft-fails baseline recompute (does not crash the batch)', async () => {
    verifyServiceRoleMock.mockImplementation(() => undefined);
    rpcServiceMock
      .mockResolvedValueOnce(SPACE_V1) // fn_resolve_embedding_model_for_space(v1)
      // resolver answer + judge
      .mockResolvedValueOnce(resolverMockHealthy())
      .mockResolvedValueOnce(resolverMockHealthy())
      .mockResolvedValueOnce([EMB_MODEL]) // fn_resolve_embedding_model (brick1c re-embed)
      .mockResolvedValueOnce(goldenFixture)
      .mockResolvedValueOnce(retrievedFixture)
      .mockResolvedValueOnce('rec-id')
      .mockRejectedValueOnce(new Error('baseline RPC unavailable'));
    embedMock.mockResolvedValueOnce([Array(1536).fill(0.01)]);
    chatCompletionWithRetryMock.mockResolvedValueOnce({
      text: 'ok',
      usage: { total_tokens: 50, prompt_tokens: 40, completion_tokens: 10 },
      latency_ms: 100, model: 'm', finish_reason: 'stop',
    });
    scoreEvalRunMock.mockResolvedValueOnce({
      faithfulness: 0.95, answer_relevancy: 0.9, context_precision: 1, context_recall: 1,
      judge_tokens_total: 100, judge_latency_ms_total: 200,
      reasoning: {}, set_based_precision: true, set_based_recall: true,
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/rag/eval/run',
      headers: { authorization: 'Bearer x' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.scored).toBe(1);
    expect(body.baseline_rows_upserted).toBe(0); // soft-failed
  });
});

describeIfFastify('POST /rag/eval/baseline/recompute', () => {
  it('401 without service-role', async () => {
    verifyServiceRoleMock.mockImplementation(() => {
      throw new MockAuthError('missing', 401);
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/rag/eval/baseline/recompute',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('200 with rows_upserted returned by RPC', async () => {
    verifyServiceRoleMock.mockImplementation(() => undefined);
    rpcServiceMock.mockResolvedValueOnce(7);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/rag/eval/baseline/recompute',
      headers: { authorization: 'Bearer x' },
      payload: { period_hours: 48 },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      rows_upserted: 7,
      period_hours: 48,
    });
    expect(rpcServiceMock).toHaveBeenCalledWith('fn_compute_rag_baseline_audited', {
      p_period_hours: 48,
    });
  });

  it('502 when RPC throws', async () => {
    verifyServiceRoleMock.mockImplementation(() => undefined);
    rpcServiceMock.mockRejectedValueOnce(new Error('rpc down'));

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/rag/eval/baseline/recompute',
      headers: { authorization: 'Bearer x' },
      payload: {},
    });
    expect(res.statusCode).toBe(502);
  });
});

describeIfFastify('GET /rag/eval/health', () => {
  it('401 without service-role', async () => {
    verifyServiceRoleMock.mockImplementation(() => {
      throw new MockAuthError('missing', 401);
    });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/rag/eval/health' });
    expect(res.statusCode).toBe(401);
  });

  it('200 with resolver-derived backends for all 3 RAG purposes', async () => {
    verifyServiceRoleMock.mockImplementation(() => undefined);
    // aisha_resolve_clow_backend gets called 3 times (answer, judge, prefix).
    rpcServiceMock
      .mockResolvedValueOnce({
        provider_slug: 'vllm-prod', model_id: 'Qwen/Qwen3-30B', backend_kind: 'local_vllm',
        endpoint_url: 'http://vllm:8000/v1', auth_env_var: 'VLLM_API_KEY',
        cost_class: 'budget', health_status: 'healthy', overall_score: 0.87,
      })
      .mockResolvedValueOnce({
        provider_slug: 'openai', model_id: 'gpt-4o-mini', backend_kind: 'direct_cloud',
        endpoint_url: 'https://api.openai.com/v1', auth_env_var: 'OPENAI_API_KEY',
        cost_class: 'standard', health_status: 'healthy', overall_score: 0.84,
      })
      .mockResolvedValueOnce({
        provider_slug: 'vllm-prod', model_id: 'Qwen/Qwen3-30B', backend_kind: 'local_vllm',
        endpoint_url: 'http://vllm:8000/v1', auth_env_var: 'VLLM_API_KEY',
        cost_class: 'budget', health_status: 'healthy', overall_score: 0.87,
      })
      .mockResolvedValueOnce(SPACE_V1); // fn_resolve_embedding_model_for_space(v1)

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/rag/eval/health',
      headers: { authorization: 'Bearer x' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    // Model, kterým se zapisuje korpus v1 — z resolveru prostoru, ne z konfigurace.
    expect(body.embedding_model).toBe('lens-embedding');
    expect(body.resolved.rag_eval_answer).toMatchObject({
      resolved: true,
      resolved_provider_slug: 'vllm-prod',
      resolved_model_id: 'Qwen/Qwen3-30B',
    });
    expect(body.resolved.rag_eval_judge.resolved_model_id).toBe('gpt-4o-mini');
    expect(body.resolved.rag_contextual_prefix.resolved_provider_slug).toBe('vllm-prod');
  });

  it('ok=false when answer OR judge backend is unavailable', async () => {
    verifyServiceRoleMock.mockImplementation(() => undefined);
    rpcServiceMock
      .mockResolvedValueOnce({}) // answer: empty → null
      .mockResolvedValueOnce({}) // judge: empty → null
      .mockResolvedValueOnce({}) // prefix: empty → null
      .mockResolvedValueOnce([]); // embedding v1: nic

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/rag/eval/health',
      headers: { authorization: 'Bearer x' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
    expect(body.resolved.rag_eval_answer.resolved).toBe(false);
  });
});
