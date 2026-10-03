/**
 * Unit tests for POST /evaluate (services/svc-ai-chat/src/routes/evaluate.ts) — K-17.
 *
 * ⛔ NAMĚŘENO 2026-09-29: route poslala každý `Bearer ey…` na ověření uživatelského
 * tokenu (Keycloak). Služební token JE JWT, takže služební cesta byla nedosažitelná
 * (401). Dávka hodnotila uloženou zlatou odpověď místo živého výstupu → teď 501.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockVerifyToken, mockVerifyService, mockIsAdmin, mockEvaluate, mockResolveDefault, mockResolveAvailable } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockVerifyService: vi.fn(),
  mockIsAdmin: vi.fn(),
  mockEvaluate: vi.fn(),
  mockResolveDefault: vi.fn(),
  mockResolveAvailable: vi.fn(),
}));

class AuthErrorMock extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

vi.mock('../../auth.js', () => ({
  verifyToken: mockVerifyToken,
  verifyServiceRole: mockVerifyService,
  isAdminOrStaff: mockIsAdmin,
  AuthError: AuthErrorMock,
}));
vi.mock('../../lib/messageEvaluation.js', () => ({ evaluateChatMessage: mockEvaluate }));
vi.mock('../../lib/defaultModel.js', () => ({ resolveDefaultBackend: mockResolveDefault }));
vi.mock('../../lib/llmRouter.js', () => ({ resolveAvailableModel: mockResolveAvailable }));

type Handler = (req: unknown, reply: unknown) => Promise<unknown> | unknown;
async function call(body: unknown, authHeader = 'Bearer eyJhbGciOiJIUzI1NiJ9.service') {
  const { evaluateRoutes } = await import('../../routes/evaluate.js');
  const handlers = new Map<string, Handler>();
  const app = { post: vi.fn((p: string, h: Handler) => handlers.set(p, h)) };
  await evaluateRoutes(app as unknown as Parameters<typeof evaluateRoutes>[0]);
  const calls: { code: number | null; body: unknown } = { code: null, body: undefined };
  const reply = {
    code(c: number) { calls.code = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
  };
  await handlers.get('/evaluate')!({ headers: { authorization: authHeader }, body, log: { error: vi.fn() } }, reply);
  return calls;
}

beforeEach(() => {
  for (const m of [mockVerifyToken, mockVerifyService, mockIsAdmin, mockEvaluate, mockResolveDefault, mockResolveAvailable]) m.mockReset();
  mockResolveDefault.mockResolvedValue({ model: 'judge', provider: 'local' });
});

describe('POST /evaluate — autentizace', () => {
  it('služební token, který VYPADÁ jako JWT, projde službou — uživatelský ověřovač se nevolá (regrese K-17)', async () => {
    mockVerifyService.mockImplementation(() => undefined);
    mockEvaluate.mockResolvedValue({ kind: 'ok', avgScore: 0.8, scores: {}, model: 'judge', tokensUsed: 10 });
    const r = await call({ message_id: 'm1' });
    expect(r.code).toBeNull();
    expect(r.body).toMatchObject({ avg_score: 0.8, message_id: 'm1' });
    expect(mockVerifyToken).not.toHaveBeenCalled();
    expect(mockEvaluate).toHaveBeenCalledWith('m1', { model: 'judge', provider: 'local' });
  });

  it('uživatel správce projde', async () => {
    mockVerifyService.mockImplementation(() => { throw new AuthErrorMock(403, 'nope'); });
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['admin'] });
    mockIsAdmin.mockReturnValue(true);
    mockEvaluate.mockResolvedValue({ kind: 'ok', avgScore: 0.5, scores: {}, model: 'judge', tokensUsed: 1 });
    const r = await call({ message_id: 'm1' }, 'Bearer eyJuser');
    expect(r.code).toBeNull();
  });

  it('uživatel bez správy → 403, nic se nehodnotí', async () => {
    mockVerifyService.mockImplementation(() => { throw new AuthErrorMock(403, 'nope'); });
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: [] });
    mockIsAdmin.mockReturnValue(false);
    const r = await call({ message_id: 'm1' }, 'Bearer eyJuser');
    expect(r.code).toBe(403);
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it('ani služba, ani platný uživatel → 401', async () => {
    mockVerifyService.mockImplementation(() => { throw new AuthErrorMock(403, 'nope'); });
    mockVerifyToken.mockRejectedValue(new AuthErrorMock(401, 'bad'));
    const r = await call({ message_id: 'm1' }, 'Bearer garbage');
    expect(r.code).toBe(401);
    expect(mockEvaluate).not.toHaveBeenCalled();
  });
});

describe('POST /evaluate — výsledky', () => {
  beforeEach(() => mockVerifyService.mockImplementation(() => undefined));

  it('dávka (jen eval_run_id) → 501, soudce se nevolá', async () => {
    const r = await call({ eval_run_id: 'r1' });
    expect(r.code).toBe(501);
    expect(r.body).toMatchObject({ error: 'batch_eval_not_available' });
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it('bez message_id → 400', async () => {
    expect((await call({})).code).toBe(400);
  });

  it.each([
    [{ kind: 'not_found' }, 404],
    [{ kind: 'not_assistant' }, 400],
    [{ kind: 'invalid_scores', raw: 'x' }, 502],
    [{ kind: 'not_persisted', error: 'db down' }, 500],
  ])('výsledek %o → HTTP %i (selhání uložení se nespolkne)', async (outcome, code) => {
    mockEvaluate.mockResolvedValue(outcome);
    expect((await call({ message_id: 'm1' })).code).toBe(code);
  });
});
