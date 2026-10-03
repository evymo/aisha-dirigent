/**
 * REAL end-to-end for the v2 (Qwen3-class halfvec(2560)) embedding write path — RAG
 * Brick 0, "celku" verification. No mocks: a real throwaway Postgres + PostgREST, a
 * REAL embedding from a real OpenAI-compatible endpoint at the v2 index dimension
 * (text-embedding-3-large truncated to 2560 via MRL `dimensions`), persisted through
 * the real text wrapper, and read back from the halfvec(2560) column.
 *
 * Proves the design claim end-to-end: non-(default-)OpenAI multilingual embeddings are
 * PRODUCIBLE (backend-agnostic dispatcher) and PERSISTABLE (the write path the audit
 * found had no runtime producer).
 *
 * Opt-in (real cost / real key): RAG_V2_INTEGRATION=1 + OPENAI_API_KEY, run inside the
 * throwaway chain so AISHA_DB_URL + POSTGREST_URL + POSTGREST_SERVICE_TOKEN are set:
 *   npm run test:integration:rag-v2
 * Self-skips otherwise; the flag-set-without-deps case fails loud.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { embed } from '../lib/embed-dispatcher.js';
import { rpcService } from '../postgrest.js';

const DB = process.env.AISHA_DB_URL;
const ON =
  process.env.RAG_V2_INTEGRATION === '1' &&
  !!process.env.OPENAI_API_KEY &&
  !!DB &&
  !!process.env.POSTGREST_URL &&
  !!process.env.POSTGREST_SERVICE_TOKEN;
if (process.env.RAG_V2_INTEGRATION === '1' && !ON) {
  throw new Error(
    'RAG_V2_INTEGRATION=1 but missing OPENAI_API_KEY / AISHA_DB_URL / POSTGREST_URL / POSTGREST_SERVICE_TOKEN — the v2 e2e lane is mis-wired (run via the throwaway chain).',
  );
}
const RUN = ON ? describe : describe.skip;

const psql = (sql: string): string =>
  execFileSync('psql', [DB as string, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], { encoding: 'utf8' }).trim();

RUN('v2-backfill — real end-to-end (OpenAI MRL 2560 -> halfvec(2560) persist)', () => {
  const itemId = randomUUID();
  const chunkId = randomUUID();
  const TEXT = 'Toto je multilingvalni testovaci obsah pro v2 embedding cs en.';

  beforeAll(() => {
    psql(
      `INSERT INTO public.knowledge_items (id,item_type,source_type,source_slug,title,body_markdown,status,visibility)
       VALUES ('${itemId}','engineering_doc','manual','rag-v2-e2e','RAG v2 e2e','${TEXT}','active','public')
       ON CONFLICT (id) DO NOTHING;`,
    );
    psql(
      `INSERT INTO public.knowledge_chunks (id,knowledge_item_id,chunk_index,chunk_text)
       VALUES ('${chunkId}','${itemId}',0,'${TEXT}') ON CONFLICT (id) DO NOTHING;`,
    );
    // A v1 embedding row with embedding_v2 NULL -> fn_get_embeddings_needing_v2 returns it.
    psql(
      `INSERT INTO public.knowledge_embeddings (chunk_id,knowledge_item_id,embedding,model)
       VALUES ('${chunkId}','${itemId}',
               ('[' || array_to_string(array(SELECT 0.01 FROM generate_series(1,1536)), ',') || ']')::vector(1536),
               'text-embedding-3-small');`,
    );
  });

  it('needing-v2 -> real embed(2560) -> wrapper write -> embedding_v2 generated -> no longer a candidate', async () => {
    // 1. the SQL read-side flags our chunk as needing a v2 embedding
    const before = await rpcService<Array<{ chunk_id: string; chunk_text: string }>>('fn_get_embeddings_needing_v2', {
      p_batch_size: 50,
      p_item_id: itemId,
    });
    expect(before.find((r) => r.chunk_id === chunkId)).toBeTruthy();

    // 2. a REAL embedding from a real OpenAI-compatible endpoint at the v2 index dim (MRL 2560)
    const [vec] = await embed({
      texts: [TEXT],
      model: 'text-embedding-3-large',
      backendKind: 'openai',
      apiKey: process.env.OPENAI_API_KEY as string,
      dimensions: 2560,
    });
    expect(vec).toHaveLength(2560);

    // 3. persist through the real PostgREST + the unambiguous halfvec text wrapper
    await rpcService('insert_knowledge_embedding_v2_audited', {
      p_chunk_id: chunkId,
      p_embedding_v2: JSON.stringify(vec),
      p_model: 'text-embedding-3-large',
      p_model_version: 'openai:e2e-mrl-2560',
    });

    // 4. the vector really landed in the halfvec(2560) v2 space, status flipped to generated
    expect(
      psql(`SELECT (embedding_v2 IS NOT NULL), v2_status, model_v2 FROM public.knowledge_embeddings WHERE chunk_id='${chunkId}';`),
    ).toBe('t|generated|text-embedding-3-large');

    // 5. and it is no longer a v2 backfill candidate
    const after = await rpcService<Array<{ chunk_id: string }>>('fn_get_embeddings_needing_v2', {
      p_batch_size: 50,
      p_item_id: itemId,
    });
    expect(after.find((r) => r.chunk_id === chunkId)).toBeFalsy();
  }, 60_000);
});
