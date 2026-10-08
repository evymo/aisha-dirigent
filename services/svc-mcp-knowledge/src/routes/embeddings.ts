import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyServiceRole } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { composeRuleEmbeddingText } from '../lib/rule-embedding-text.js';
import { embedTextsWithBackend, resolveEmbeddingBackendForSpace } from '../lib/embed-query-in-space.js';

/**
 * 503 pro zápisovou dráhu, pro jejíž prostor není živý embedding model.
 *
 * Fail-closed záměrně: `expert_rules.content_embedding` i `agent_memories.embedding`
 * jsou vector(1024) = prostor v1. Model jiného rozměru by zápis shodil v DB a tichý
 * pád na cloud by obsah poslal ven bez rozhodnutí.
 */
const NO_V1_BACKEND = {
  error: 'No embedding backend available for rag space v1',
  hint: 'fn_resolve_embedding_model_for_space(v1) nevrátil model: žádný dostupný is_embedding model ' +
        's rozměrem prostoru v1 u povoleného zdravého providera. Discovery (svc-ai-chat) ho vede jako ' +
        'dostupný, až ho uvidí v živém listingu a změří rozměr.',
} as const;

/**
 * POST /embeddings/rules — Generate embeddings for expert_rules.
 * POST /embeddings/memories — Generate embeddings for agent_memories.
 * Service-role only.
 */
export async function embeddingsRoutes(app: FastifyInstance): Promise<void> {
  /** Generate embeddings for expert_rules */
  app.post<{
    Body: { force?: boolean; batch_size?: number; slug?: string };
  }>('/embeddings/rules', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch {
      return reply.code(401).send({ error: 'Unauthorized — service role required' });
    }

    const force = req.body?.force ?? false;
    const batchSize = Math.min(req.body?.batch_size ?? 10, 50);
    const targetSlug = req.body?.slug;

    // Fetch rules needing embeddings
    const rules = await rpcService<Array<{
      id: string;
      slug: string;
      title: string;
      summary: string;
      body_markdown: string;
      ai_instructions: string | null;
      ai_context_tags: string[] | null;
    }>>('get_rules_for_embedding', {
      p_force: force,
      p_batch_size: batchSize,
      p_slug: targetSlug ?? null,
    });

    if (!rules || rules.length === 0) {
      return reply.send({ message: 'No rules need embedding generation', processed: 0, results: [] });
    }

    // ⛔ NAMĚŘENO 2026-09-13: tahle dráha šla natvrdo na OpenAI (text-embedding-3-small,
    // 1536) do vector(1024) — nemohla projít nikdy a cold-start krok 6b na ní stál.
    // Sloupec je prostor v1, model vybírá TÝŽ resolver prostoru jako korpus a dotaz.
    const backend = await resolveEmbeddingBackendForSpace('v1');
    if (!backend) return reply.code(503).send(NO_V1_BACKEND);

    const results: Array<{ slug: string; status: string; chars?: number; error?: string }> = [];

    for (const rule of rules) {
      try {
        const text = composeRuleEmbeddingText(rule);
        // Dopočet vektorů pravidel = dávka.
        const [embedding] = await embedTextsWithBackend(backend, [text], 'davka');

        await rpcService('update_rule_embedding', {
          p_embedding: JSON.stringify(embedding),
          p_id: rule.id,
        });

        results.push({ slug: rule.slug, status: 'success', chars: text.length });
      } catch (err) {
        results.push({ slug: rule.slug, status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    }

    const succeeded = results.filter((r) => r.status === 'success').length;
    const failed = results.filter((r) => r.status === 'error').length;

    return reply.send({ processed: rules.length, succeeded, failed, model: backend.model_id, results });
  });

  /** Generate embeddings for agent_memories */
  app.post<{
    Body: { agent_slug?: string; memory_id?: string; batch_size?: number };
  }>('/embeddings/memories', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch {
      return reply.code(401).send({ error: 'Unauthorized — service role required' });
    }

    const batchSize = Math.min(req.body?.batch_size ?? 50, 100);

    const memories = await rpcService<Array<{
      id: string;
      content: string;
      agent_slug: string;
      memory_type: string;
    }>>('fn_get_memories_without_embeddings', {
      p_agent_slug: req.body?.agent_slug ?? null,
      p_batch_size: batchSize,
      p_memory_id: req.body?.memory_id ?? null,
    });

    if (!memories || memories.length === 0) {
      return reply.send({ status: 'ok', message: 'No memories need embedding', processed: 0 });
    }

    // agent_memories.embedding je vector(1024) = prostor v1 — týž resolver jako pravidla.
    const backend = await resolveEmbeddingBackendForSpace('v1');
    if (!backend) return reply.code(503).send(NO_V1_BACKEND);

    const texts = memories.map((m) => `[${m.agent_slug}/${m.memory_type}] ${m.content}`);
    // Dopočet vektorů pamětí = dávka.
    const embeddings = await embedTextsWithBackend(backend, texts, 'davka');

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < memories.length; i++) {
      try {
        await rpcService('fn_update_memory_embedding', {
          p_embedding: JSON.stringify(embeddings[i]),
          p_memory_id: memories[i].id,
        });
        successCount++;
      } catch (err) {
        errorCount++;
        errors.push(`${memories[i].id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return reply.send({
      status: errorCount === 0 ? 'ok' : 'partial',
      processed: memories.length,
      success: successCount,
      errors: errorCount,
      error_details: errors.length > 0 ? errors : undefined,
    });
  });
}
