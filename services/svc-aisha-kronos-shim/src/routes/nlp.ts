/**
 * NLP routes — Maestro deleguje RAG retrieval na Kronos:
 *   POST /projects/{id}/nlp/rag/        → query_rag_top_n (sync)
 *   POST /projects/{id}/nlp/rag/stream  → query_rag (streaming NDJSON)
 *
 * Shim forwarduje VOLBOU PŘÍMO na Ragnarok — skipuje Kronos KB metadata layer
 * (AISHA má KB v knowledge_items.story_id + Ragnarok ES, ne v Kronos Mongo).
 *
 * Per-story KB filter je explicit v Ragnarok body přes `kb_ids`. Pokud Maestro
 * pošle prázdné kb_ids, shim defaultne na `[project_id]` (per-project namespace).
 */
import type { FastifyInstance } from 'fastify';
import { verifyKronosApiKey, AuthError } from '../auth.js';
import { ragnarokRagSync, ragnarokRagStream } from '../lib/ragnarok-proxy.js';
import { config } from '../config.js';

interface RagBody {
  query: string;
  kb_ids?: string[] | null;
  lang?: string | null;
  return_highlights?: boolean;
  return_matched_chunks?: boolean;
  model_name_llm?: string | null;
}

export async function nlpRoutes(app: FastifyInstance): Promise<void> {
  // ─────────────────────────────────────────────────────────────────────
  // POST /projects/{id}/nlp/rag/ — sync RAG (Maestro query_rag_top_n)
  // ─────────────────────────────────────────────────────────────────────
  app.post<{
    Params: { project_id: string };
    Querystring: { session_id?: string; user_id?: string };
    Body: RagBody;
  }>('/projects/:project_id/nlp/rag/', async (req, reply) => {
    try {
      verifyKronosApiKey(req.headers);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.code(status).send({ detail: err instanceof Error ? err.message : 'Unauthorized' });
    }

    const projectId = req.params.project_id;
    const body = req.body ?? { query: '' };
    if (!body.query) {
      return reply.code(400).send({ detail: 'query is required' });
    }

    // Ragnarok kb_ids = specifické UUID per uploaded KB (z `/knowledge_base/file`).
    // Pokud caller neposlal explicit kb_ids → necháme prázdné (Ragnarok pak
    // prohledá všechny KBs v rámci project_id namespace, což je AISHA story scope).
    const kbIds = body.kb_ids && body.kb_ids.length > 0 ? body.kb_ids : undefined;

    try {
      const data = await ragnarokRagSync(
        projectId,
        {
          query: body.query,
          kb_ids: kbIds,
          lang: body.lang ?? config.defaultLang,
          return_highlights: body.return_highlights ?? false,
          return_matched_chunks: body.return_matched_chunks ?? true,
        },
        req.query.session_id ?? null,
      );
      return reply.send(data);
    } catch (err) {
      req.log.error({ err }, 'Ragnarok rag sync proxy failed');
      return reply.code(502).send({
        detail: `Ragnarok RAG failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /projects/{id}/nlp/rag/stream — streaming RAG (Maestro query_rag)
  // ─────────────────────────────────────────────────────────────────────
  app.post<{
    Params: { project_id: string };
    Querystring: { session_id?: string; user_id?: string };
    Body: RagBody;
  }>('/projects/:project_id/nlp/rag/stream', async (req, reply) => {
    try {
      verifyKronosApiKey(req.headers);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.code(status).send({ detail: err instanceof Error ? err.message : 'Unauthorized' });
    }

    const projectId = req.params.project_id;
    const body = req.body ?? { query: '' };
    if (!body.query) {
      return reply.code(400).send({ detail: 'query is required' });
    }

    // Ragnarok kb_ids = specifické UUID per uploaded KB (z `/knowledge_base/file`).
    // Pokud caller neposlal explicit kb_ids → necháme prázdné (Ragnarok pak
    // prohledá všechny KBs v rámci project_id namespace, což je AISHA story scope).
    const kbIds = body.kb_ids && body.kb_ids.length > 0 ? body.kb_ids : undefined;

    try {
      const stream = await ragnarokRagStream(
        projectId,
        {
          query: body.query,
          kb_ids: kbIds,
          lang: body.lang ?? config.defaultLang,
          return_highlights: body.return_highlights ?? false,
          return_matched_chunks: body.return_matched_chunks ?? true,
        },
        req.query.session_id ?? null,
      );

      reply.raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
        'X-Accel-Buffering': 'no',
      });

      const reader = stream.getReader();
      const writable = reply.raw;
      const pump = async (): Promise<void> => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            writable.end();
            return;
          }
          writable.write(value);
        }
      };
      await pump().catch((err) => {
        req.log.warn({ err }, 'Ragnarok stream pump aborted');
        writable.end();
      });
      return;
    } catch (err) {
      req.log.error({ err }, 'Ragnarok rag stream proxy failed');
      return reply.code(502).send({
        detail: `Ragnarok RAG stream failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}
