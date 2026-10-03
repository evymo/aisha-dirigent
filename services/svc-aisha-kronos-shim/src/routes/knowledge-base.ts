/**
 * GET /knowledge_base/?project_id=...&fields=name,source_file,...&per_page=0
 *
 * Maestro očekává `{data: [{kb_id, name, source_file, source_type, enable_highlights}, ...]}`
 * Shim mapuje na AISHA story KB:
 *   - per_page=0 = vrať vše
 *   - source_type je v AISHA stringově heuristicky odvozeno (pdf/docx/txt/md)
 *
 * Pro AISHA stories: kb_id namespace je `story-{story_uuid}`, takže shim
 * vrátí jeden virtuální KB záznam per project_id (Maestro stejně KB obsah
 * pak vyhledává přes /nlp/rag/ s kb_ids filterem).
 */
import type { FastifyInstance } from 'fastify';
import { verifyKronosApiKey, AuthError } from '../auth.js';

interface KbListQuery {
  project_id?: string;
  fields?: string;
  per_page?: number;
}

export async function knowledgeBaseRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: KbListQuery }>('/knowledge_base/', async (req, reply) => {
    try {
      verifyKronosApiKey(req.headers);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.code(status).send({ detail: err instanceof Error ? err.message : 'Unauthorized' });
    }

    const projectId = req.query.project_id ?? 'aisha';

    // Single virtual KB record per project — AISHA real KB lookup je v /nlp/rag/
    // (přímo do Ragnaroku). Maestro tu jen seznamuje "co je k dispozici" pro
    // dialog FSM resolution; obsah se pak volá v RAG.
    const virtualKb = {
      kb_id: projectId,
      name: `AISHA KB pro ${projectId}`,
      source_file: 'aisha-rpc://knowledge_items',
      source_type: 'aisha-rpc',
      enable_highlights: true,
      created_at: new Date().toISOString(),
    };

    return reply.send({ data: [virtualKb], total: 1, page: 1, per_page: 0 });
  });
}
