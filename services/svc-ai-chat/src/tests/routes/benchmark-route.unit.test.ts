/**
 * Unit tests for POST /admin/benchmark (services/svc-ai-chat/src/routes/benchmark.ts).
 * Admin-gated; on admin it queries available models, derives a judge, runs the
 * benchmark, and returns the summary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpcService, mockVerifyToken, mockIsAdmin, mockBenchmark, mockMakeJudge, mockSelectServiceable, mockFetch } = vi.hoisted(() => ({
  mockRpcService: vi.fn(),
  mockVerifyToken: vi.fn(),
  mockIsAdmin: vi.fn(),
  mockBenchmark: vi.fn(),
  mockMakeJudge: vi.fn(),
  mockSelectServiceable: vi.fn(),
  mockFetch: vi.fn(),
}));

class AuthErrorMock extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

vi.mock('../../postgrest.js', () => ({ rpcService: mockRpcService, rpcUser: vi.fn() }));
vi.mock('../../auth.js', () => ({ verifyToken: mockVerifyToken, isAdminOrStaff: mockIsAdmin, AuthError: AuthErrorMock }));
vi.mock('../../lib/benchmarkRunner.js', () => ({ benchmarkModels: mockBenchmark, makeLlmJudge: mockMakeJudge }));
vi.mock('../../lib/llmRouter.js', () => ({ selectServiceableProviderForms: mockSelectServiceable }));
vi.mock('../../config.js', () => ({ config: { postgrestUrl: 'http://pg', postgrestServiceToken: 'tok' } }));

vi.stubGlobal('fetch', mockFetch);

type Handler = (req: unknown, reply: unknown) => Promise<unknown> | unknown;
function makeApp() {
  const handlers = new Map<string, Handler>();
  const post = vi.fn((path: string, h: Handler) => handlers.set(`POST ${path}`, h));
  return {
    app: { post } as unknown as Parameters<typeof import('../../routes/benchmark.js').benchmarkRoutes>[0],
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
async function call(body?: unknown, authHeader: string | undefined = 'Bearer valid') {
  const { benchmarkRoutes } = await import('../../routes/benchmark.js');
  const { app, handlers } = makeApp();
  await benchmarkRoutes(app);
  const { reply, calls } = makeReply();
  const handler = handlers.get('POST /admin/benchmark')!;
  await handler({ headers: { authorization: authHeader }, body }, reply);
  return calls;
}

const okJson = (data: unknown) => ({ ok: true, json: async () => data, text: async () => JSON.stringify(data) });

beforeEach(() => {
  mockRpcService.mockReset();
  mockVerifyToken.mockReset();
  mockIsAdmin.mockReset();
  mockBenchmark.mockReset();
  mockMakeJudge.mockReset();
  mockSelectServiceable.mockReset();
  mockFetch.mockReset();
  mockSelectServiceable.mockReturnValue(['openai']);
  mockRpcService.mockResolvedValue(null);
});

describe('benchmarkRoutes :: POST /admin/benchmark', () => {
  it('403 for a non-admin user — never benchmarks', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u' });
    mockIsAdmin.mockReturnValue(false);
    const calls = await call({});
    expect(calls.code).toBe(403);
    expect(mockBenchmark).not.toHaveBeenCalled();
  });

  it('401 on AuthError', async () => {
    mockVerifyToken.mockRejectedValue(new AuthErrorMock(401, 'bad'));
    const calls = await call({}, 'Bearer bad');
    expect(calls.code).toBe(401);
  });

  it('admin → queries models, runs benchmark, returns the summary', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'admin-1' });
    mockIsAdmin.mockReturnValue(true);
    // pgGet: first call = available models, second = approved (judge).
    mockFetch
      .mockResolvedValueOnce(okJson([{ id: 'm1', provider: 'openai', model_id: 'gpt-x' }]))
      .mockResolvedValueOnce(okJson([{ provider: 'openai', model_id: 'gpt-judge' }]));
    mockMakeJudge.mockReturnValue(async () => ({ relevance: 1, groundedness: 1, safety: 1, coherence: 1 }));
    mockBenchmark.mockResolvedValue({ evalRunId: 'run-1', modelsBenchmarked: 1, perModel: [{ modelId: 'gpt-x', taskType: 'chat', overall: 0.8, sampleCount: 4 }] });

    const calls = await call({});

    expect(mockBenchmark).toHaveBeenCalledTimes(1);
    const passedModels = mockBenchmark.mock.calls[0][1];
    expect(passedModels).toEqual([{ id: 'm1', provider: 'openai', model_id: 'gpt-x' }]);
    expect(calls.body).toMatchObject({ evalRunId: 'run-1', modelsBenchmarked: 1 });
  });
});
