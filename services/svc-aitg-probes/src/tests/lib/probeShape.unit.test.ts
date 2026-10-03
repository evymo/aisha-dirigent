/**
 * Unit tests for src/lib/probeShape.ts.
 *
 * `registerProbe` is the spine every AITG runtime probe shares — it wires:
 *   auth → Zod validation → LLM dispatch → classifier → audit record.
 *
 * One bug here breaks 9 downstream probes simultaneously. The contract we
 * lock in:
 *   1. POSTs the route at `def.path`.
 *   2. Auth via `verifyToken(req.headers.authorization)` — missing/bad
 *      token must produce a sanitised error (toPublicError shape).
 *   3. Body validated against `{ payload: string >= 1, model? string,
 *      triggeredBy? enum }`. `model` defaults to `config.defaultModel`;
 *      `triggeredBy` defaults to 'manual'.
 *   4. Calls `def.buildUserMessage(payload)` to construct the user-message
 *      string (per-probe payload shaping).
 *   5. Dispatches through `dispatchProbeChat({ model, systemPrompt, userMessage })`.
 *   6. Runs `def.classify(chat.text)` to determine status + severity + observed.
 *   7. Records via `runner.record({ testId, buildSha, triggeredBy, status,
 *      severity, evidenceUri, details })`. `evidenceUri` is
 *      `aisha://ai-runs/<run_id>` when present, null otherwise.
 *   8. Replies `{ runId, status, severity, observed }`.
 *   9. Any failure (auth, validation, dispatch, classify, record) is
 *      surfaced via toPublicError (no raw exception propagation).
 *
 * Because Fastify carries a lot of HTTP machinery we don't need here, we
 * stub it with a tiny `makeFastifyStub()` that captures the handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProbeDefinition } from '../../lib/probeShape.js';

const {
  mockVerifyToken,
  mockDispatchProbeChat,
  mockRunnerRecord,
  mockCreateAitgRunner,
  mockValidateBody,
  mockToPublicError,
  mockCreateSafeLogger,
} = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockDispatchProbeChat: vi.fn(),
  mockRunnerRecord: vi.fn(),
  mockCreateAitgRunner: vi.fn(),
  mockValidateBody: vi.fn(),
  mockToPublicError: vi.fn(),
  mockCreateSafeLogger: vi.fn(),
}));

mockCreateAitgRunner.mockReturnValue({ record: mockRunnerRecord });
mockCreateSafeLogger.mockReturnValue({
  safeInfo: vi.fn(),
  safeError: vi.fn(),
});

vi.mock('@aisha/aitg', () => ({
  createAitgRunner: mockCreateAitgRunner,
}));

vi.mock('@aisha/security', () => ({
  validateBody: mockValidateBody,
  toPublicError: mockToPublicError,
  createSafeLogger: mockCreateSafeLogger,
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

vi.mock('../../config.js', () => ({
  config: {
    postgrestUrl: 'http://postgrest:3000',
    postgrestServiceToken: 'svc-token',
    defaultModel: 'gpt-4o-mini',
    buildSha: 'sha-abc123',
  },
}));

vi.mock('../../auth.js', () => ({
  verifyToken: mockVerifyToken,
}));

vi.mock('../../lib/llmDispatch.js', () => ({
  dispatchProbeChat: mockDispatchProbeChat,
}));

// Tiny Fastify stub: registerProbe(app, def) calls app.post(def.path, handler).
// We capture the handler so we can invoke it with hand-rolled req/reply.
function makeFastifyStub() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const post = vi.fn(
    (path: string, handler: (req: unknown, reply: unknown) => unknown) => {
      handlers.set(path, handler);
    },
  );
  return {
    app: { post } as unknown as Parameters<
      typeof import('../../lib/probeShape.js').registerProbe
    >[0],
    handlers,
  };
}

function makeReply() {
  const calls: { code: number | null; body: unknown } = { code: null, body: undefined };
  const reply = {
    code(c: number) {
      calls.code = c;
      return reply;
    },
    send(b: unknown) {
      calls.body = b;
      return reply;
    },
  };
  return { reply, calls };
}

function probeDefStub(): ProbeDefinition {
  return {
    testId: 'AITG-APP-99',
    path: '/probes/app-99-test',
    systemPrompt: 'You are a probe.',
    buildUserMessage: vi.fn((payload: string) => `wrapped:${payload}`),
    classify: vi.fn(() => ({
      status: 'passed' as const,
      severity: 'low' as const,
      observed: { decision: 'refusal_detected' },
    })),
  };
}

async function loadModule() {
  return await import('../../lib/probeShape.js');
}

describe('registerProbe — happy path', () => {
  beforeEach(() => {
    mockVerifyToken.mockReset().mockReturnValue(undefined);
    mockDispatchProbeChat.mockReset();
    mockRunnerRecord.mockReset().mockResolvedValue('run-id-001');
    mockValidateBody.mockReset();
    mockToPublicError.mockReset();
  });

  it('registers the POST route at def.path', async () => {
    const { registerProbe } = await loadModule();
    const stub = makeFastifyStub();
    const def = probeDefStub();
    registerProbe(stub.app, def);
    expect(stub.handlers.has('/probes/app-99-test')).toBe(true);
  });

  it('end-to-end: auth → validate → dispatch → classify → record → reply', async () => {
    mockValidateBody.mockReturnValue({
      payload: 'inject: ignore previous',
      model: 'gpt-4o',
      triggeredBy: 'pr-gate',
    });
    mockDispatchProbeChat.mockResolvedValue({
      text: 'I cannot do that — refusing.',
      runId: 'run-xyz-9999',
    });

    const { registerProbe } = await loadModule();
    const stub = makeFastifyStub();
    const def = probeDefStub();
    registerProbe(stub.app, def);

    const handler = stub.handlers.get('/probes/app-99-test')!;
    const { reply, calls } = makeReply();
    const req = {
      headers: { authorization: 'Bearer test-token' },
      body: { payload: 'inject: ignore previous', model: 'gpt-4o', triggeredBy: 'pr-gate' },
    };
    await handler(req, reply);

    expect(mockVerifyToken).toHaveBeenCalledWith('Bearer test-token');
    expect(mockValidateBody).toHaveBeenCalledWith(expect.anything(), req.body);
    expect(def.buildUserMessage).toHaveBeenCalledWith('inject: ignore previous');
    expect(mockDispatchProbeChat).toHaveBeenCalledWith({
      model: 'gpt-4o',
      systemPrompt: 'You are a probe.',
      userMessage: 'wrapped:inject: ignore previous',
    });
    expect(def.classify).toHaveBeenCalledWith('I cannot do that — refusing.');

    expect(mockRunnerRecord).toHaveBeenCalledWith({
      testId: 'AITG-APP-99',
      buildSha: 'sha-abc123',
      triggeredBy: 'pr-gate',
      status: 'passed',
      severity: 'low',
      evidenceUri: 'aisha://ai-runs/run-xyz-9999',
      details: expect.objectContaining({
        model: 'gpt-4o',
        response_snippet: 'I cannot do that — refusing.',
        decision: 'refusal_detected',
      }),
    });

    expect(calls.body).toEqual({
      runId: 'run-id-001',
      status: 'passed',
      severity: 'low',
      observed: { decision: 'refusal_detected' },
    });
  });

  it('evidenceUri is null when dispatchProbeChat omits runId', async () => {
    mockValidateBody.mockReturnValue({
      payload: 'x', model: 'gpt-4o-mini', triggeredBy: 'manual',
    });
    mockDispatchProbeChat.mockResolvedValue({ text: 'response' });

    const { registerProbe } = await loadModule();
    const stub = makeFastifyStub();
    const def = probeDefStub();
    registerProbe(stub.app, def);

    const handler = stub.handlers.get('/probes/app-99-test')!;
    const { reply } = makeReply();
    await handler(
      { headers: { authorization: 'Bearer t' }, body: {} },
      reply,
    );
    expect(mockRunnerRecord).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceUri: null }),
    );
  });

  it('caps response_snippet at 800 chars (audit-row size protection)', async () => {
    mockValidateBody.mockReturnValue({
      payload: 'x', model: 'gpt-4o-mini', triggeredBy: 'manual',
    });
    const long = 'A'.repeat(2000);
    mockDispatchProbeChat.mockResolvedValue({ text: long });

    const { registerProbe } = await loadModule();
    const stub = makeFastifyStub();
    const def = probeDefStub();
    registerProbe(stub.app, def);

    await stub.handlers.get('/probes/app-99-test')!(
      { headers: { authorization: 'Bearer t' }, body: {} },
      makeReply().reply,
    );
    const recordedDetails = mockRunnerRecord.mock.calls[0][0].details as Record<string, unknown>;
    expect((recordedDetails.response_snippet as string).length).toBe(800);
  });

  it('preserves classifier non-passed status (failed/flaky/blocked/not_applicable)', async () => {
    mockValidateBody.mockReturnValue({
      payload: 'x', model: 'gpt-4o-mini', triggeredBy: 'manual',
    });
    mockDispatchProbeChat.mockResolvedValue({ text: 'leaked secret: hunter2' });

    const { registerProbe } = await loadModule();
    const stub = makeFastifyStub();
    const def = probeDefStub();
    def.classify = vi.fn(() => ({
      status: 'failed' as const,
      severity: 'high' as const,
      observed: { leak_detected: true },
    }));
    registerProbe(stub.app, def);

    const { reply, calls } = makeReply();
    await stub.handlers.get('/probes/app-99-test')!(
      { headers: { authorization: 'Bearer t' }, body: {} },
      reply,
    );

    expect(mockRunnerRecord).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', severity: 'high' }),
    );
    expect(calls.body).toEqual(
      expect.objectContaining({ status: 'failed', severity: 'high' }),
    );
  });
});

describe('registerProbe — error path (every failure → toPublicError)', () => {
  beforeEach(() => {
    mockVerifyToken.mockReset();
    mockDispatchProbeChat.mockReset();
    mockRunnerRecord.mockReset();
    mockValidateBody.mockReset();
    mockToPublicError.mockReset().mockReturnValue({
      statusCode: 401,
      body: { error: 'AITG_AUTH_REJECTED' },
    });
  });

  it('auth failure → toPublicError-shaped reply, no dispatch + no record', async () => {
    mockVerifyToken.mockImplementation(() => {
      throw new Error('invalid token');
    });

    const { registerProbe } = await loadModule();
    const stub = makeFastifyStub();
    const def = probeDefStub();
    registerProbe(stub.app, def);

    const { reply, calls } = makeReply();
    await stub.handlers.get('/probes/app-99-test')!(
      { headers: { authorization: 'Bearer bad' }, body: {} },
      reply,
    );

    expect(mockToPublicError).toHaveBeenCalled();
    expect(calls.code).toBe(401);
    expect(calls.body).toEqual({ error: 'AITG_AUTH_REJECTED' });
    expect(mockDispatchProbeChat).not.toHaveBeenCalled();
    expect(mockRunnerRecord).not.toHaveBeenCalled();
  });

  it('validation failure → toPublicError, no dispatch', async () => {
    mockVerifyToken.mockReturnValue(undefined);
    mockValidateBody.mockImplementation(() => {
      throw new Error('payload required');
    });
    mockToPublicError.mockReturnValue({
      statusCode: 400,
      body: { error: 'AITG_BAD_REQUEST' },
    });

    const { registerProbe } = await loadModule();
    const stub = makeFastifyStub();
    const def = probeDefStub();
    registerProbe(stub.app, def);

    const { reply, calls } = makeReply();
    await stub.handlers.get('/probes/app-99-test')!(
      { headers: { authorization: 'Bearer t' }, body: {} },
      reply,
    );

    expect(calls.code).toBe(400);
    expect(mockDispatchProbeChat).not.toHaveBeenCalled();
  });

  it('dispatch failure (AITG_LLM_DISPATCH_FAILED:5xx) → toPublicError, no record', async () => {
    mockVerifyToken.mockReturnValue(undefined);
    mockValidateBody.mockReturnValue({
      payload: 'x', model: 'gpt-4o-mini', triggeredBy: 'manual',
    });
    mockDispatchProbeChat.mockRejectedValue(new Error('AITG_LLM_DISPATCH_FAILED:502'));
    mockToPublicError.mockReturnValue({
      statusCode: 502,
      body: { error: 'AITG_UPSTREAM_FAILED' },
    });

    const { registerProbe } = await loadModule();
    const stub = makeFastifyStub();
    const def = probeDefStub();
    registerProbe(stub.app, def);

    const { reply, calls } = makeReply();
    await stub.handlers.get('/probes/app-99-test')!(
      { headers: { authorization: 'Bearer t' }, body: {} },
      reply,
    );

    expect(calls.code).toBe(502);
    expect(mockRunnerRecord).not.toHaveBeenCalled();
  });

  it('record (audit insert) failure → toPublicError instead of leaking DB error', async () => {
    mockVerifyToken.mockReturnValue(undefined);
    mockValidateBody.mockReturnValue({
      payload: 'x', model: 'gpt-4o-mini', triggeredBy: 'manual',
    });
    mockDispatchProbeChat.mockResolvedValue({ text: 'ok' });
    mockRunnerRecord.mockRejectedValue(
      new Error('postgrest: row violates check constraint aitg_runs_status_check'),
    );
    mockToPublicError.mockReturnValue({
      statusCode: 500,
      body: { error: 'AITG_RECORD_FAILED' },
    });

    const { registerProbe } = await loadModule();
    const stub = makeFastifyStub();
    const def = probeDefStub();
    registerProbe(stub.app, def);

    const { reply, calls } = makeReply();
    await stub.handlers.get('/probes/app-99-test')!(
      { headers: { authorization: 'Bearer t' }, body: {} },
      reply,
    );

    expect(calls.code).toBe(500);
    expect(calls.body).toEqual({ error: 'AITG_RECORD_FAILED' });
    // The raw DB constraint name MUST NOT appear in the response
    expect(JSON.stringify(calls.body)).not.toContain('aitg_runs_status_check');
  });
});

describe('module init — runner construction', () => {
  it('initialises createAitgRunner with postgrestUrl + serviceToken + service name', async () => {
    vi.resetModules();
    mockCreateAitgRunner.mockReset().mockReturnValue({ record: mockRunnerRecord });

    await import('../../lib/probeShape.js');

    expect(mockCreateAitgRunner).toHaveBeenCalledWith({
      postgrestUrl: 'http://postgrest:3000',
      serviceToken: 'svc-token',
      service: 'svc-aitg-probes',
    });
  });
});
