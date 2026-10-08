/**
 * POST /models/openai-key — Stav a ověření klíče OpenAI (admin only). Klíč se NASTAVUJE
 *   v administraci („Poskytovatelé AI a tokeny" → set_provider_credential_admin); akce
 *   `set` odpovídá 410 (dřív psala přes edge_app_secrets akci, kterou funkce nezná —
 *   každé volání padalo, 2026-10-02).
 * GET /models/list — List available chat models (admin only). Returns
 *   { models: Array<{ id, created, owned_by }> } — the OpenAiModelEntry shape the
 *   `useAvailableModels` client hook consumes directly (no post-mapping).
 * POST /models/discover — Run the discover→self-test pipeline on demand (admin/staff, or the
 *   service token — cold-start vyžádá discovery, když čeká na model, viz handler).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, verifyServiceRole, isAdminOrStaff, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { config } from '../config.js';
import { credentials } from '../lib/credentials.js';
import { discoverModels, isNonChatModelId } from '../lib/modelDiscovery.js';
import { selfTestModels } from '../lib/modelSelfTest.js';
import { getAllBackends } from '../lib/llmRouter.js';

const CHAT_MODEL_PREFIXES = config.chatModelPrefixes ?? ['gpt-', 'o1-', 'o3-', 'o4-'];

export async function modelsRoutes(app: FastifyInstance): Promise<void> {
  // OpenAI key management
  app.post<{ Body: { action: 'status' | 'validate' | 'set'; key?: string } }>('/models/openai-key', async (req, reply) => {
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }
    if (!isAdminOrStaff(user)) return reply.code(403).send({ error: 'Admin required' });

    const { action, key } = req.body ?? {};

    if (action === 'status') {
      // Stav = přítomnost. Žádná část hodnoty (dřív posledních 4 znaků) do prohlížeče.
      const klic = await credentials.get('OPENAI_API_KEY');
      return reply.send({ configured: klic !== null, masked: null });
    }

    if (action === 'validate') {
      const apiKey = key ?? (await credentials.get('OPENAI_API_KEY'));
      if (!apiKey) return reply.send({ valid: false, error: 'No API key' });

      try {
        const resp = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        return reply.send({ valid: resp.ok });
      } catch {
        return reply.send({ valid: false, error: 'Connection failed' });
      }
    }

    if (action === 'set') {
      return reply.code(410).send({
        error: 'Klíč OpenAI se nastavuje v administraci (Poskytovatelé AI a tokeny → OPENAI_API_KEY)',
      });
    }

    return reply.code(400).send({ error: 'action must be status, validate, or set' });
  });

  // List available models — shared handler wired for BOTH verbs below. The
  // 'list-openai-models' client invokes it via the SDK's default POST (no body),
  // and the gateway forwards the verb verbatim; a GET-only route 404s that POST.
  // Registering the identical handler for GET and POST keeps behaviour parity
  // without duplicating the OpenAI fetch/filter logic.
  const listModelsHandler = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }
    if (!isAdminOrStaff(user)) return reply.code(403).send({ error: 'Admin required' });

    const apiKey = await credentials.get('OPENAI_API_KEY');
    if (!apiKey) return reply.send({ models: [], error: 'No OpenAI API key configured' });

    const resp = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) return reply.code(502).send({ error: 'Failed to fetch models from OpenAI' });

    const body = await resp.json() as { data: Array<{ id: string; created: number; owned_by: string }> };
    const models = (body.data ?? [])
      .filter((m) => CHAT_MODEL_PREFIXES.some((p: string) => m.id.startsWith(p)))
      .filter((m) => !isNonChatModelId(m.id))
      .sort((a, b) => b.created - a.created)
      .map((m) => ({ id: m.id, created: m.created, owned_by: m.owned_by }));

    return reply.send({ models });
  };

  app.get('/models/list', listModelsHandler);
  // POST alias — same auth, same payload. See handler comment above.
  app.post('/models/list', listModelsHandler);

  // On-demand model fetch — exposes the SAME boot-time discover→self-test pipeline
  // (server.ts) as an admin action, so an operator can pull newly-available models
  // without restarting the service. Discovered models land eval_status='pending';
  // the self-test then advances them pending→tested/rejected. Admin/staff only.
  //
  // ⛔ NAMĚŘENO 2026-09-13 (C6): cold-start (krok 6b) čeká na embedding model prostoru v1,
  // ale svc-model se nasazuje až po ai-chat a discovery ho zaregistruje při startu nebo
  // v DALŠÍ periodě (DISCOVERY_INTERVAL_MS = 15 min) — strop čekání se proto odvozoval
  // z periody. Na model, jehož nasazení cold-start sám právě dokončil, se nemá čekat
  // podle hodin: cold-start discovery VYŽÁDÁ servisním tokenem (týž, kterým pouští embed
  // kickstart). Servisní token má autoritu service_role nad celou DB — spuštění discovery
  // ji nerozšiřuje. `selfTest: false` = jen discovery (chat smoke všech pending modelů do
  // smyčky čekání nepatří; boot i periodický průchod ho pustí jako dřív).
  app.post<{ Body?: { provider?: string; mode?: 'pending' | 'rejected-only' | 'all-settled'; selfTest?: boolean } }>('/models/discover', async (req, reply) => {
    let userId: string | null = null;
    let lane: 'service' | 'user' = 'service';
    try {
      verifyServiceRole(req.headers.authorization);
    } catch {
      // Není to servisní token → uživatel, a to jen admin/staff.
      lane = 'user';
      let user;
      try {
        user = await verifyToken(req.headers.authorization);
      } catch (err) {
        return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
      }
      if (!isAdminOrStaff(user)) return reply.code(403).send({ error: 'Admin required' });
      userId = user.userId;
    }

    const rpc = (fn: string, params: Record<string, unknown>): Promise<unknown> => rpcService(fn, params);
    const { provider, mode, selfTest: spustitSelfTest } = req.body ?? {};
    if (spustitSelfTest !== undefined && typeof spustitSelfTest !== 'boolean') {
      return reply.code(400).send({ error: 'selfTest must be a boolean' });
    }
    // A re-test re-probes already-settled models (rejected/tested) — it does NOT scan
    // for new ones, so discovery is skipped. The default path discovers + self-tests.
    const isRetest = mode === 'rejected-only' || mode === 'all-settled';
    if (isRetest && spustitSelfTest === false) {
      return reply.code(400).send({ error: 'a re-test mode without self-test does nothing' });
    }
    const backends = provider ? getAllBackends().filter((b) => b.id === provider) : getAllBackends();

    const discovery = isRetest
      ? {
          discovered: 0,
          perProvider: {} as Record<string, number>,
          errors: [] as Array<{ provider: string; error: string }>,
          markedUnavailable: {} as Record<string, number>,
          availabilityUnmeasured: [] as string[],
        }
      : await discoverModels(rpc, backends);
    const selfTest = spustitSelfTest === false
      ? { tested: 0, passed: 0, failed: 0 }
      : await selfTestModels(rpc, undefined, { mode });

    await rpcService('log_audit_event', {
      p_action: isRetest ? 'MODELS_RETEST_TRIGGERED' : 'MODELS_DISCOVER_TRIGGERED',
      p_metadata: {
        provider: provider ?? 'all', mode: mode ?? 'pending', lane, self_test: spustitSelfTest !== false,
        discovered: discovery.discovered, tested: selfTest.tested, errors: discovery.errors.length,
      },
      p_user_id: userId,
    }).catch(() => {});

    return reply.send({
      discovered: discovery.discovered,
      perProvider: discovery.perProvider,
      tested: selfTest.tested,
      passed: selfTest.passed,
      failed: selfTest.failed,
      selfTestRan: spustitSelfTest !== false,
      errors: discovery.errors,
      markedUnavailable: discovery.markedUnavailable,
      availabilityUnmeasured: discovery.availabilityUnmeasured,
    });
  });
}
