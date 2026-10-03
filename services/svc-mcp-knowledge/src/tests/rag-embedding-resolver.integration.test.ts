/**
 * DB-level integration for the RAG embedding-space measurement (brick 1) — the SQL
 * deliverables on a REAL throwaway Postgres + PostgREST (no OpenAI, no corpus needed):
 *   - fn_resolve_embedding_model: a named is_embedding model resolves to its backend +
 *     corpus space (v1 1536 / v2 2560), capability-availability gated (provider is_enabled);
 *     an unknown / unregistered model resolves to nothing (caller must fail loud).
 *   - fn_compare_rag_embedding_models: two models' runs over the same golden produce a
 *     per-(context_profile, language) winner by nDCG@K; unlabelled golden ⇒ insufficient_data.
 *
 * Run inside the throwaway chain so AISHA_DB_URL + POSTGREST_URL + POSTGREST_SERVICE_TOKEN
 * are set:  npm run test:integration:rag-eval
 * Self-skips otherwise.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { rpcService } from '../postgrest.js';

const DB = process.env.AISHA_DB_URL;
const ON = !!DB && !!process.env.POSTGREST_URL && !!process.env.POSTGREST_SERVICE_TOKEN;
// Deklarovaná integrační lane (harness exportuje AISHA_TEST_LANE=integration) bez vstupů
// je ROZBITÝ harness, ne „není DB, přeskoč" — tichý skip by lane vykázal jako hotový.
if (process.env.AISHA_TEST_LANE === 'integration' && !ON) {
  throw new Error(
    'AISHA_TEST_LANE=integration, ale chybí AISHA_DB_URL / POSTGREST_URL / POSTGREST_SERVICE_TOKEN — ' +
      'lane je špatně zapojená (spouštěj přes npm run test:integration:rag-eval).',
  );
}
const RUN = ON ? describe : describe.skip;

const psql = (sql: string): string =>
  execFileSync('psql', [DB as string, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], { encoding: 'utf8' }).trim();

interface ResolvedEmbedding {
  model_id: string;
  provider_slug: string;
  backend_kind: string;
  embedding_dimensions: number | null;
  rag_space: string;
}
interface ComparisonRow {
  context_profile_slug: string | null;
  language: string;
  a_ndcg: number | null;
  b_ndcg: number | null;
  ndcg_delta: number;
  winner: string;
}

RUN('rag embedding measurement — fn_resolve_embedding_model + fn_compare_rag_embedding_models', () => {
  beforeAll(() => {
    // Make the seeded embedding providers resolvable in the throwaway DB.
    psql(
      `UPDATE public.ai_provider_registry SET is_enabled=true, last_health_status='healthy'
       WHERE slug IN ('openai','vllm-local');`,
    );
    // Lokální vLLM řádky seed od 2026-09-13 zakládá is_available=false — dostupné je
    // vede až discovery, když je uvidí v živém listingu. Tady tentýž stav výslovně.
    psql(`UPDATE public.ai_model_registry SET is_available=true WHERE model_id = 'Qwen/Qwen3-Embedding-4B';`);
  });

  it('a 1536-dim model resolves, but maps to NO local corpus space (rag_space NULL)', async () => {
    // fn_resolve_embedding_model mapuje prostor SHODOU rozměru (1024 → v1, 2560 → v2);
    // 1536 do žádného zdejšího sloupce nepatří. Test dřív tvrdil 'v1' — stav před tou opravou.
    const [m] = await rpcService<ResolvedEmbedding[]>('fn_resolve_embedding_model', {
      p_model_id: 'text-embedding-3-small',
    });
    expect(m).toBeTruthy();
    expect(m.rag_space).toBeNull();
    expect(m.embedding_dimensions).toBe(1536);
  });

  it('resolves the v2 multilingual model to its 2560 halfvec space', async () => {
    const [m] = await rpcService<ResolvedEmbedding[]>('fn_resolve_embedding_model', {
      p_model_id: 'Qwen/Qwen3-Embedding-4B',
    });
    expect(m).toBeTruthy();
    expect(m.rag_space).toBe('v2');
    expect(m.embedding_dimensions).toBe(2560);
  });

  it('returns nothing for an unregistered model (caller fails loud, never substitutes)', async () => {
    const rows = await rpcService<ResolvedEmbedding[]>('fn_resolve_embedding_model', {
      p_model_id: 'no-such-embedding-model',
    });
    expect(rows.length).toBe(0);
  });

  it('picks the higher-nDCG model as the per-context winner', async () => {
    const golden = psql(`SELECT id || '|' || COALESCE(language,'cs') FROM public.rag_eval_golden LIMIT 1;`);
    expect(golden).toBeTruthy();
    const [goldenId, lang] = golden.split('|');
    const ins = (model: string, ndcg: number): void => {
      psql(
        `INSERT INTO public.rag_eval_runs
           (golden_id, batch_id, embedding_model, embedding_model_version, llm_model, judge_model,
            context_profile_slug, faithfulness_score, answer_relevancy_score, context_precision_score,
            context_recall_score, metadata)
         SELECT '${goldenId}', gen_random_uuid(), '${model}', 'p:${model}', 'llm', 'judge',
            g.context_profile_slug, 0.8, 0.8, 0.8, 0.8,
            jsonb_build_object('language','${lang}',
              'retrieval', jsonb_build_object('num_expected',2,'ndcg_at_k',${ndcg},'recall_at_k',1.0,'mrr',1.0))
         FROM public.rag_eval_golden g WHERE g.id='${goldenId}';`,
      );
    };
    ins('cmp-win', 0.91);
    ins('cmp-lose', 0.42);

    const rows = await rpcService<ComparisonRow[]>('fn_compare_rag_embedding_models', {
      p_model_a: 'cmp-win',
      p_model_b: 'cmp-lose',
      p_period_hours: 168,
    });
    const row = rows.find((r) => r.winner !== 'insufficient_data');
    expect(row).toBeTruthy();
    expect(row!.winner).toBe('cmp-win');
    expect(Number(row!.ndcg_delta)).toBeGreaterThan(0);
  });
});
