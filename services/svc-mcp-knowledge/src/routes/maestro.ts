/**
 * Maestro MCP routes — DEBUG/SERVICE-ROLE ONLY proxy.
 *
 * ⚠️  STANDARDNÍ CESTA pro frontend i story dialog je `services/svc-ai-chat
 * /story-consult` (Brain-aware orchestrace s Tao + Psyche + Hippocampus +
 * governance vrstvami). Tato MCP route je low-level proxy pro:
 *  - n8n agenty s service-role tokenem (např. WF_MAESTRO_DIALOG_AGENT)
 *  - sandbox testy v WF_SELF_LEARNING_LOOP (project_id = `sandbox-{run_id}`)
 *  - debug nástroje
 *
 * Frontend NESMÍ volat tyto endpointy přímo — obešel by Tao/Psyche/Hippocampus
 * a poškodil charakter AISHA. Gate test insight-usp-integrity.gate.test.ts
 * kontroluje, že frontend hook `useMaestro` neexistuje (existuje jen `useStoryConsult`).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyServiceRole, AuthError } from '../auth.js';
import { config } from '../config.js';

export async function maestroRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // POST /maestro/chat — Proxy na Maestro `/projects/{id}/query/rag` (single-turn
  // s server-side multi-turn coherence přes session_id query param).
  //
  // SERVICE-ROLE ONLY. Maestro API předává: query (current message) + kb_ids
  // (per-story filter) + lang. session_id se předává jako query parameter pro
  // multi-turn coherence — caller (n8n agent / sandbox test) může reuse session_id
  // pro pokračování dialogu.
  //
  // Brain layer system prompt z svc-ai-chat orchestrace se Maestrovi NEPŘEDÁVÁ —
  // Maestro má vlastní interní system prompt configurovaný per projekt v Insight
  // stacku. Pokud potřebuješ Tao/Psyche/Hippocampus aplikované na response, použij
  // svc-ai-chat /story-consult orchestraci (tam se brain prompt aplikuje na
  // cloud LLM call s Maestro retrieval jako context).
  // ---------------------------------------------------------------------------
  app.post<{
    Body: {
      project_id?: string;
      session_id?: string;
      message: string;
      kb_ids?: string[];
      top_n_count?: number;
      lang?: string;
    };
  }>('/maestro/chat', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.code(status).send({
        error: 'Service-role required',
        hint: 'Frontend must use POST /story-consult on svc-ai-chat for brain-aware orchestration. '
            + 'Direct Maestro access bypasses Tao/Psyche/Hippocampus governance and is forbidden.',
      });
    }

    if (!config.maestroUrl || !config.maestroApiKey) {
      return reply.code(503).send({ error: 'Maestro not configured (MAESTRO_URL / MAESTRO_API_KEY missing)' });
    }

    const { project_id, session_id, message, kb_ids, top_n_count, lang } = req.body ?? {};

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return reply.code(400).send({ error: 'message is required' });
    }
    if (message.length > 10_000) {
      return reply.code(400).send({ error: 'message exceeds maximum length' });
    }

    const projectId = project_id ?? config.maestroDefaultProjectId;

    const body: Record<string, unknown> = {
      query: message.trim(),
      lang: lang ?? config.insightDefaultLang,
      return_matched_chunks: true,
      return_highlights: false,
      top_n_count: top_n_count ?? 5,
    };
    if (kb_ids && kb_ids.length > 0) body.kb_ids = kb_ids;

    const sessionParam = session_id ? `?session_id=${encodeURIComponent(session_id)}` : '';
    const url = `${config.maestroUrl.replace(/\/+$/, '')}/projects/${encodeURIComponent(projectId)}/query/rag${sessionParam}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': config.maestroApiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '(empty)');
        req.log.error({ status: res.status, errText: errText.slice(0, 500) }, 'Maestro API error');
        return reply.code(502).send({ error: 'Maestro chat failed', status: res.status });
      }

      const data = await res.json();
      return reply.send({ ok: true, data });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return reply.code(504).send({ error: 'Maestro request timed out' });
      }
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ msg }, 'Maestro service error');
      return reply.code(502).send({ error: 'Maestro service unavailable' });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /maestro/health — Service health passthrough (service-role only).
  // ---------------------------------------------------------------------------
  app.get('/maestro/health', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Service-role required' });
    }

    if (!config.maestroUrl) {
      return reply.code(503).send({ ok: false, error: 'Maestro not configured' });
    }

    try {
      const res = await fetch(`${config.maestroUrl.replace(/\/+$/, '')}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      const ok = res.ok;
      await res.body?.cancel();
      return reply.send({ ok, status: res.status });
    } catch (err) {
      return reply.code(502).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}
