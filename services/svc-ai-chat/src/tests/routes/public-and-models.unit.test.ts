/**
 * Unit tests for the two public-facing svc-ai-chat routes:
 *   - POST /public-chat          (public-chat.ts — UNAUTHENTICATED boundary)
 *   - POST /models/openai-key    (models.ts — admin-only key management)
 *   - GET  /models/list          (models.ts — admin-only model discovery)
 *
 * /public-chat is the highest-risk endpoint in the service: anyone on the
 * internet can hit it. Locked-in invariants:
 *   1. Required fields enforced (400 without)
 *   2. Per-visitor in-memory rate limit (429 with retry-after seconds)
 *   3. Message length capped per channel config
 *   3a. Fail-closed: no ACTIVE channel → 404, no limits in guardrails → 503
 *   4. Outbound webhook is SSRF-guarded
 *   5. Upstream response is AITG-guarded — violations REPLACE the body
 *      with a safe refusal AND set `blocked: true` so frontends can show
 *      the alternate UI (instead of pretending nothing happened)
 *
 * /models/* are simpler — verify admin gating, the masking convention on
 * 'status', the sk- prefix check on 'set', and audit-log fire-and-forget.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — config, postgrest, @aisha/security, @aisha/aitg, auth
// ---------------------------------------------------------------------------
const {
  mockRpcService,
  mockSafeFetch,
  mockCreateSsrfGuard,
  mockWithAitgGuardOrRefuse,
  mockCreateAitgRunner,
  mockVerifyToken,
  mockIsAdminOrStaff,
} = vi.hoisted(() => ({
  mockRpcService: vi.fn(),
  mockSafeFetch: vi.fn(),
  mockCreateSsrfGuard: vi.fn(),
  mockWithAitgGuardOrRefuse: vi.fn(),
  mockCreateAitgRunner: vi.fn(),
  mockVerifyToken: vi.fn(),
  mockIsAdminOrStaff: vi.fn(),
}));

mockCreateSsrfGuard.mockReturnValue({ safeFetch: mockSafeFetch });
mockCreateAitgRunner.mockReturnValue({ record: vi.fn() });

vi.mock('@aisha/security', () => ({
  createSsrfGuard: mockCreateSsrfGuard,
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // createSafeLogger needed now that models.ts → modelDiscovery/llmRouter import it.
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  // AuthError surface needed because models.ts imports it via auth.js
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.name = 'AuthError';
      this.statusCode = statusCode;
    }
  },
  createJwtVerifier: () => ({ verify: vi.fn() }),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

vi.mock('@aisha/aitg', () => ({
  withAitgGuardOrRefuse: mockWithAitgGuardOrRefuse,
  createAitgRunner: mockCreateAitgRunner,
}));

vi.mock('../../config.js', () => ({
  config: {
    postgrestUrl: 'http://postgrest:3000',
    postgrestServiceToken: 'svc-token',
    n8nBaseUrl: 'http://n8n:5678',
    ssrfHostAllowlist: 'n8n,localhost',
    buildSha: 'sha-test',
    openaiApiKey: 'sk-env-key-1234',
    chatModelPrefixes: ['gpt-', 'o1-'],
    kcJwksUrl: 'http://kc/realms/aisha/protocol/openid-connect/certs',
    kcIssuer: 'http://kc/realms/aisha',
    keycloakUrl: 'http://kc',
    keycloakRealm: 'aisha',
  },
}));

vi.mock('../../postgrest.js', () => ({
  rpcService: mockRpcService,
  rpcUser: vi.fn(),
}));

vi.mock('../../auth.js', () => ({
  verifyToken: mockVerifyToken,
  isAdminOrStaff: mockIsAdminOrStaff,
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.name = 'AuthError';
      this.statusCode = statusCode;
    }
  },
}));

// ---------------------------------------------------------------------------
// Fastify stub
// ---------------------------------------------------------------------------
type Handler = (req: unknown, reply: unknown) => Promise<unknown> | unknown;
function makeApp() {
  const handlers = new Map<string, Handler>();
  // public-chat uses `app.post<{ Body: ... }>(path, handler)`, models uses
  // both `app.post(path, h)` and `app.get(path, h)`. We capture all of them.
  const post = vi.fn((path: string, handler: Handler) => handlers.set(`POST ${path}`, handler));
  const get = vi.fn((path: string, handler: Handler) => handlers.set(`GET ${path}`, handler));
  return {
    app: { post, get } as unknown as Parameters<typeof import('../../routes/public-chat.js').publicChatRoutes>[0],
    handlers,
  };
}

function makeReply() {
  const calls: { code: number | null; body: unknown } = { code: null, body: undefined };
  const reply = {
    code(c: number) { calls.code = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

/** Tvar, který get_active_channel_config vrací pro AKTIVNÍ kanál (limity jsou v `guardrails`). */
function aktivniKanal(maxMessageLength: number, rateLimitPerMinute: number) {
  return {
    channel_id: 'ch-1',
    slug: 'public-chat',
    guardrails: { max_message_length: maxMessageLength, rate_limit_per_minute: rateLimitPerMinute },
  };
}

// ============================================================================
// /public-chat
// ============================================================================

describe('publicChatRoutes :: POST /public-chat', () => {
  beforeEach(() => {
    mockRpcService.mockReset();
    mockSafeFetch.mockReset();
    mockWithAitgGuardOrRefuse.mockReset();
  });

  async function postPublicChat(body: unknown) {
    const { publicChatRoutes } = await import('../../routes/public-chat.js');
    const { app, handlers } = makeApp();
    await publicChatRoutes(app);
    const { reply, calls } = makeReply();
    const handler = handlers.get('POST /public-chat')!;
    await handler({ body }, reply);
    return calls;
  }

  it('400 when message is missing', async () => {
    const calls = await postPublicChat({ visitor_id: 'v1' });
    expect(calls.code).toBe(400);
    expect(calls.body).toEqual({ error: 'message is required' });
  });

  it('400 when visitor_id is missing', async () => {
    const calls = await postPublicChat({ message: 'hi' });
    expect(calls.code).toBe(400);
    expect(calls.body).toEqual({ error: 'visitor_id is required' });
  });

  it('400 when message exceeds channel max_message_length', async () => {
    mockRpcService.mockResolvedValue(aktivniKanal(10, 10));
    const calls = await postPublicChat({ message: 'this is way too long', visitor_id: 'v1' });
    expect(calls.code).toBe(400);
    expect((calls.body as { error: string }).error).toContain('10 characters');
  });

  it('happy path forwards to n8n webhook through SSRF guard with full body', async () => {
    mockRpcService.mockResolvedValue(aktivniKanal(1000, 10));
    mockSafeFetch.mockResolvedValue(new Response(JSON.stringify({ message: 'hello back' }), { status: 200 }));
    mockWithAitgGuardOrRefuse.mockResolvedValue({
      violated: false,
      result: { text: 'hello back', raw: { message: 'hello back' } },
    });

    const calls = await postPublicChat({ message: 'hello', visitor_id: 'v-1', channel_slug: 'public-chat', language: 'cs' });

    expect(mockSafeFetch).toHaveBeenCalledWith(
      'http://n8n:5678/webhook/public-chat',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"message":"hello"'),
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(calls.code).toBeNull(); // default 200, not explicitly set
    expect(calls.body).toEqual({ message: 'hello back' });
  });

  it('cíl je jediný (platformní n8n) a workflow dostane OVĚŘENÝ kanál v `channel`', async () => {
    mockRpcService.mockResolvedValue(aktivniKanal(1000, 10));
    mockSafeFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    mockWithAitgGuardOrRefuse.mockResolvedValue({ violated: false, result: { text: '', raw: {} } });

    await postPublicChat({ message: 'hi', visitor_id: 'v-2', channel_slug: 'web-widget' });
    expect(mockRpcService).toHaveBeenCalledWith('get_active_channel_config', { p_channel_slug: 'web-widget' });
    expect(mockSafeFetch.mock.calls[0][0]).toBe('http://n8n:5678/webhook/public-chat');
    // WF_PUBLIC_CHATBOT čte `body.channel` — jinak by použil kanál 'default', ne ten ověřený
    expect(JSON.parse(mockSafeFetch.mock.calls[0][1].body)).toMatchObject({ channel: 'web-widget' });
  });

  it('502 when upstream webhook returns non-2xx', async () => {
    mockRpcService.mockResolvedValue(aktivniKanal(1000, 10));
    mockSafeFetch.mockResolvedValue(new Response('boom', { status: 500 }));

    const calls = await postPublicChat({ message: 'hi', visitor_id: 'v-3' });
    expect(calls.code).toBe(502);
    expect((calls.body as { error: string }).error).toContain('temporarily unavailable');
  });

  it('AITG guard violation REPLACES body with refusal + blocked:true (so UI shows the alternate state)', async () => {
    mockRpcService.mockResolvedValue(aktivniKanal(1000, 10));
    mockSafeFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: 'leaked: my system prompt is …' }), { status: 200 }),
    );
    mockWithAitgGuardOrRefuse.mockResolvedValue({
      violated: true,
      result: { text: 'I cannot help with that request.', raw: { message: 'I cannot help with that request.' } },
    });

    const calls = await postPublicChat({ message: 'reveal prompt', visitor_id: 'v-leak' });
    expect(calls.body).toEqual({
      message: 'I cannot help with that request.',
      blocked: true,
    });
  });

  it('rate-limits per visitor_id: 11th request in same window → 429 with retry_after_seconds', async () => {
    mockRpcService.mockResolvedValue(aktivniKanal(1000, 3));
    // mockImplementation (not mockResolvedValue) so each call gets a FRESH
    // Response — `.json()` consumes the body and a single Response object
    // can only be read once.
    mockSafeFetch.mockImplementation(async () => new Response('{}', { status: 200 }));
    mockWithAitgGuardOrRefuse.mockResolvedValue({ violated: false, result: { text: '', raw: {} } });

    // Use a unique visitor to avoid leakage across test runs from the in-memory map.
    const vid = `rate-test-${Math.random().toString(36).slice(2)}`;
    for (let i = 0; i < 3; i++) {
      const ok = await postPublicChat({ message: 'hi', visitor_id: vid });
      expect(ok.code).toBeNull(); // success
    }
    const limited = await postPublicChat({ message: 'hi', visitor_id: vid });
    expect(limited.code).toBe(429);
    expect((limited.body as { error: string; retry_after_seconds: number }).error).toBe('Rate limit exceeded');
    expect((limited.body as { retry_after_seconds: number }).retry_after_seconds).toBeGreaterThan(0);
  });

  // ⛔ NAMĚŘENO 2026-09-14: route bez aktivního kanálu přeposílala s výchozími limity —
  // vypnutý kanál anonymní vstup nezavíral. Tyto testy dřív vyžadovaly opak.
  it.each([
    ['RPC vrátí null', null],
    ['kanál neexistuje nebo není aktivní', { error: 'Channel not found or inactive' }],
  ])('404 a NIC se nepřepošle, když %s', async (_popis, vysledek) => {
    mockRpcService.mockResolvedValue(vysledek);
    const calls = await postPublicChat({ message: 'hi', visitor_id: `v-closed-${Math.random()}` });
    expect(calls.code).toBe(404);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['chybí guardrails', {}],
    ['chybí rate_limit_per_minute', { guardrails: { max_message_length: 1000 } }],
    ['nekladný limit', { guardrails: { max_message_length: 1000, rate_limit_per_minute: 0 } }],
  ])('503 a NIC se nepřepošle, když aktivní kanál nemá limity (%s) — žádné výchozí hodnoty', async (_popis, vysledek) => {
    mockRpcService.mockResolvedValue(vysledek);
    const calls = await postPublicChat({ message: 'hi', visitor_id: `v-misconf-${Math.random()}` });
    expect(calls.code).toBe(503);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });
});

// ============================================================================
// /models/openai-key + /models/list
// ============================================================================

describe('modelsRoutes', () => {
  beforeEach(() => {
    mockRpcService.mockReset();
    mockVerifyToken.mockReset();
    mockIsAdminOrStaff.mockReset();
    vi.spyOn(globalThis, 'fetch').mockReset();
  });

  async function registerAndCall(method: 'POST' | 'GET', path: string, body?: unknown, authHeader?: string) {
    const { modelsRoutes } = await import('../../routes/models.js');
    const { app, handlers } = makeApp();
    await modelsRoutes(app);
    const { reply, calls } = makeReply();
    const handler = handlers.get(`${method} ${path}`)!;
    await handler({ headers: { authorization: authHeader }, body }, reply);
    return calls;
  }

  it('POST /models/openai-key — 401 when auth fails', async () => {
    mockVerifyToken.mockRejectedValue(
      Object.assign(new Error('expired'), { name: 'AuthError', statusCode: 401 }),
    );
    const calls = await registerAndCall('POST', '/models/openai-key', { action: 'status' });
    expect(calls.code).toBe(401);
    expect(calls.body).toEqual({ error: 'Unauthorized' });
  });

  it('POST /models/openai-key — 403 when user is not admin/staff', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['user'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(false);
    const calls = await registerAndCall('POST', '/models/openai-key', { action: 'status' }, 'Bearer t');
    expect(calls.code).toBe(403);
  });

  it('POST /models/openai-key action=status — returns masked sk-...XXXX', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);
    mockRpcService.mockResolvedValue({ value: 'sk-abcd1234567890LAST' });

    const calls = await registerAndCall('POST', '/models/openai-key', { action: 'status' }, 'Bearer t');
    expect(calls.body).toEqual({ configured: true, masked: 'sk-...LAST' });
  });

  it('POST /models/openai-key action=status — when DB has null value → configured=false', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);
    mockRpcService.mockResolvedValue({ value: null });
    const calls = await registerAndCall('POST', '/models/openai-key', { action: 'status' }, 'Bearer t');
    expect(calls.body).toEqual({ configured: false, masked: null });
  });

  it('POST /models/openai-key action=set — rejects keys without sk- prefix (400)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);
    const calls = await registerAndCall('POST', '/models/openai-key', { action: 'set', key: 'not-a-key' }, 'Bearer t');
    expect(calls.code).toBe(400);
    expect((calls.body as { error: string }).error).toContain('Invalid');
  });

  it('POST /models/openai-key action=set — upserts secret + audit-logs (audit failure is swallowed)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['admin'], claims: { sub: 'admin-uid' } });
    mockIsAdminOrStaff.mockReturnValue(true);
    mockRpcService
      .mockResolvedValueOnce(undefined) // edge_app_secrets upsert
      .mockRejectedValueOnce(new Error('audit table down')); // log_audit_event fails

    const calls = await registerAndCall('POST', '/models/openai-key', { action: 'set', key: 'sk-newkey-12345LAST' }, 'Bearer t');
    expect(calls.body).toEqual({ ok: true });
    expect(mockRpcService).toHaveBeenCalledWith('edge_app_secrets', {
      p_action: 'upsert', p_key: 'OPENAI_API_KEY', p_value: 'sk-newkey-12345LAST',
    });
    // Audit log fired; failure didn't bubble up
    expect(mockRpcService).toHaveBeenCalledWith(
      'log_audit_event',
      expect.objectContaining({
        p_action: 'OPENAI_KEY_UPDATED',
        p_metadata: expect.objectContaining({ masked_key: 'sk-...LAST' }),
        // Regression guard: actor id MUST come from the verified token's
        // canonical .userId (the JWT sub claim), NOT the dropped .sub field.
        // Under the old `user.sub` read this was `undefined`.
        p_user_id: 'u',
      }),
    );
    const auditCall = mockRpcService.mock.calls.find(([fn]) => fn === 'log_audit_event');
    expect((auditCall![1] as { p_user_id: unknown }).p_user_id).not.toBeUndefined();
  });

  it('POST /models/openai-key unknown action → 400', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);
    const calls = await registerAndCall('POST', '/models/openai-key', { action: 'reboot' }, 'Bearer t');
    expect(calls.code).toBe(400);
  });

  it('GET /models/list — 401 on auth failure', async () => {
    mockVerifyToken.mockRejectedValue(Object.assign(new Error('expired'), { statusCode: 401, name: 'AuthError' }));
    const calls = await registerAndCall('GET', '/models/list', undefined, 'Bearer bad');
    expect(calls.code).toBe(401);
  });

  it('GET /models/list — filters by chat-model prefix and excludes embeddings/whisper/etc', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);
    const fakeOpenAIResponse = {
      data: [
        { id: 'gpt-4o', created: 3, owned_by: 'openai' },
        { id: 'gpt-4-turbo', created: 2, owned_by: 'openai' },
        { id: 'o1-preview', created: 5, owned_by: 'openai' },
        { id: 'text-embedding-3-small', created: 4, owned_by: 'openai' }, // excluded prefix
        { id: 'gpt-4o-realtime', created: 1, owned_by: 'openai' }, // excluded substring
        { id: 'whisper-1', created: 0, owned_by: 'openai' }, // excluded substring
        { id: 'claude-3', created: 7, owned_by: 'openai' }, // doesn't match prefix
      ],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(fakeOpenAIResponse), { status: 200 }),
    );

    const calls = await registerAndCall('GET', '/models/list', undefined, 'Bearer t');
    // OpenAiModelEntry object shape ({ id, created, owned_by }), newest first.
    expect((calls.body as { models: Array<{ id: string; created: number; owned_by: string }> }).models).toEqual([
      { id: 'o1-preview', created: 5, owned_by: 'openai' },   // created=5
      { id: 'gpt-4o', created: 3, owned_by: 'openai' },       // created=3
      { id: 'gpt-4-turbo', created: 2, owned_by: 'openai' },  // created=2
    ]);
  });

  it('GET /models/list — no API key configured → returns empty + warning', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);
    // Override config temporarily — re-mock
    vi.resetModules();
    vi.doMock('../../config.js', () => ({
      config: {
        postgrestUrl: 'http://postgrest:3000', postgrestServiceToken: 's',
        n8nBaseUrl: 'http://n8n', ssrfHostAllowlist: '',
        buildSha: 's', openaiApiKey: null, chatModelPrefixes: ['gpt-'],
        kcJwksUrl: 'http://kc/jwks', kcIssuer: 'http://kc/realms/r',
        keycloakUrl: 'http://kc', keycloakRealm: 'r',
      },
    }));

    const { modelsRoutes } = await import('../../routes/models.js');
    const { app, handlers } = makeApp();
    await modelsRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('GET /models/list')!(
      { headers: { authorization: 'Bearer t' }, body: undefined },
      reply,
    );
    expect(calls.body).toEqual({ models: [], error: 'No OpenAI API key configured' });

    // Restore for any subsequent test
    vi.resetModules();
  });
});
