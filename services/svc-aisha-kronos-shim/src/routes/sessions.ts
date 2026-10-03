/**
 * Sessions / turns — multi-turn coherence storage.
 *
 * Mapování na AISHA agent_memories (memory_type='maestro_session'):
 *   - POST /sessions/ → mcp_store_agent_memory(agent_slug, 'maestro_session', JSON.stringify({project_id,user_id,name,description,language}))
 *   - POST /turns/    → mcp_store_agent_memory(agent_slug, 'maestro_turn', JSON.stringify({session_id,user_query,system_response,matched_kb_ids,matched_pages}))
 *
 * AISHA RPC mcp_store_agent_memory vrací `memory_id` UUID, který používáme jako
 * Kronos-compatible session_id / turn_id. Maestro session_id je v podstatě
 * jen string handle pro pamatování turnů — multi-turn coherence v Maestru
 * vyhledává předchozí turny, který Maestro samo bere z Kronosu před každým
 * turn. AISHA agent_memories drží stejný kontrakt.
 */
import type { FastifyInstance } from 'fastify';
import { verifyKronosApiKey, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { config } from '../config.js';

interface CreateSessionBody {
  project_id?: string;
  user_id?: string;
  name?: string;
  description?: string;
  language?: string;
}

interface CreateTurnBody {
  session_id?: string;
  project_id?: string;
  user_id?: string;
  user_query?: string;
  system_response?: string;
  matched_kb_ids?: string[];
  matched_pages?: number[];
}

interface AgentMemoryRecord {
  memory_id?: string;
  id?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuidOrNull(value: unknown): string | null {
  if (typeof value === 'string' && UUID_RE.test(value)) return value;
  return null;
}

export async function sessionsRoutes(app: FastifyInstance): Promise<void> {
  // ─────────────────────────────────────────────────────────────────────
  // POST /sessions/ — start new session (Maestro multi-turn coherence handle)
  // ─────────────────────────────────────────────────────────────────────
  app.post<{ Body: CreateSessionBody }>('/sessions/', async (req, reply) => {
    try {
      verifyKronosApiKey(req.headers);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.code(status).send({ detail: err instanceof Error ? err.message : 'Unauthorized' });
    }

    const body = req.body ?? {};
    const sessionMeta = {
      project_id: body.project_id ?? null,
      user_id: body.user_id ?? null,
      name: body.name ?? '',
      description: body.description ?? '',
      language: body.language ?? config.defaultLang,
      created_at: new Date().toISOString(),
    };

    let memoryId: string;
    try {
      const result = await rpcService<AgentMemoryRecord | null>('mcp_store_agent_memory', {
        p_agent_slug: config.sessionAgentSlug,
        p_content: JSON.stringify(sessionMeta),
        p_importance: 5,
        p_memory_type: 'maestro_session',
        p_run_id: null,
        p_ttl_hours: null,
        p_user_id: asUuidOrNull(body.user_id),
      });
      memoryId = result?.memory_id ?? result?.id ?? crypto.randomUUID();
    } catch (err) {
      // Graceful fallback — pokud AISHA PostgREST nedostupný (lokální dev,
      // network partition), vrátíme stub session_id. Maestro multi-turn
      // coherence funguje server-side přes session_id, persistence v AISHA
      // agent_memories je nice-to-have (long-term Hippocampus signals), ne
      // hard requirement pro real-time dialog state.
      req.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'mcp_store_agent_memory unavailable — fallback na stub session_id (Maestro funguje, AISHA persistence skip)',
      );
      memoryId = crypto.randomUUID();
    }

    // Maestro očekává Mongo-style `_id` field v session response (per
    // packages/insight/maestro/maestro/api/dialogue.py:64 → session["_id"]).
    // Současně vracíme `session_id` pro AISHA-side čitelnost.
    return reply.send({
      _id: memoryId,
      session_id: memoryId,
      project_id: sessionMeta.project_id,
      user_id: sessionMeta.user_id,
      name: sessionMeta.name,
      description: sessionMeta.description,
      language: sessionMeta.language,
      created_at: sessionMeta.created_at,
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /turns/ — log dialog turn (Maestro after each query/rag completion)
  // ─────────────────────────────────────────────────────────────────────
  app.post<{ Body: CreateTurnBody }>('/turns/', async (req, reply) => {
    try {
      verifyKronosApiKey(req.headers);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.code(status).send({ detail: err instanceof Error ? err.message : 'Unauthorized' });
    }

    const body = req.body ?? {};
    if (!body.session_id) {
      return reply.code(400).send({ detail: 'session_id is required' });
    }
    const turnMeta = {
      session_id: body.session_id,
      project_id: body.project_id ?? null,
      user_id: body.user_id ?? null,
      user_query: body.user_query ?? '',
      system_response: body.system_response ?? '',
      matched_kb_ids: body.matched_kb_ids ?? [],
      matched_pages: body.matched_pages ?? [],
      created_at: new Date().toISOString(),
    };

    let turnId: string;
    try {
      const result = await rpcService<AgentMemoryRecord | null>('mcp_store_agent_memory', {
        p_agent_slug: config.sessionAgentSlug,
        p_content: JSON.stringify(turnMeta),
        p_importance: 3,
        p_memory_type: 'maestro_turn',
        p_run_id: null,
        p_ttl_hours: 24 * 30, // 30 dní retention pro multi-turn context
        p_user_id: asUuidOrNull(body.user_id),
      });
      turnId = result?.memory_id ?? result?.id ?? crypto.randomUUID();
    } catch (err) {
      // Graceful fallback (viz /sessions/ comment) — Maestro turn fungeje i
      // když AISHA agent_memories persistence selže. Long-term Hippocampus
      // evolution se skipne, ale real-time dialog coherence není ovlivněna.
      req.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'mcp_store_agent_memory pro turn unavailable — fallback stub turn_id',
      );
      turnId = crypto.randomUUID();
    }
    return reply.send({ _id: turnId, turn_id: turnId, ...turnMeta });
  });
}
