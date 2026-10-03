import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// Collaborators mocked at the boundary: JWT, routing RPC, the LLM dispatch, and
// the AITG guard. The guard mock runs the wrapped fn and reports no violation by
// default (violation + real classifiers are covered in the aitg package).
vi.mock('../auth.js', () => ({
  verifyToken: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));
vi.mock('../postgrest.js', () => ({ rpcService: vi.fn() }));
vi.mock('../lib/llmRouter.js', () => ({
  resolveAvailableModel: vi.fn(() => ({ model: 'gpt-4o', provider: 'openai' })),
  unifiedChat: vi.fn(),
}));
vi.mock('../lib/dispatchJournal.js', () => ({ journalDispatch: vi.fn(async () => 'decision-1') }));
vi.mock('@aisha/aitg', () => ({
  createAitgRunner: vi.fn(() => ({ record: vi.fn() })),
  withAitgGuard: vi.fn(async (_opts: unknown, fn: () => Promise<{ text: string }>) => {
    const result = await fn();
    return { result, runIds: {}, violated: false, observations: {} };
  }),
}));
vi.mock('../config.js', () => ({
  config: { postgrestUrl: 'http://pg', postgrestServiceToken: 't', buildSha: 'test' },
}));

import { labRecommendationRoutes } from '../routes/lab-recommendation.js';
import { verifyToken, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { resolveAvailableModel, unifiedChat } from '../lib/llmRouter.js';

const STORY_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const AUTH = { authorization: 'Bearer ey.header.payload' };

const VALID_MODEL_OUTPUT = {
  conditions: ['fatigue'],
  requires_fasting: true,
  sample_types_required: ['blood'],
  ai_notes: 'Requires clinician review.',
  panels: [
    {
      panel_id: 'p1',
      panel_name: 'Baseline safety',
      panel_description: 'Pre-program baseline',
      timing: 'pre_program',
      is_mandatory: true,
      total_price: 500,
      reason: 'Establish baseline',
      tests: [
        {
          code: 'CBC',
          name: 'Complete blood count',
          category: 'hematology',
          priority: 'required',
          reason: 'Safety baseline',
          price: 250,
          sample_type: 'blood',
          requires_fasting: false,
        },
      ],
    },
  ],
};

const REQUEST_BODY = {
  story_id: STORY_ID,
  products: ['retisin'],
  anamnesis: 'Persistent fatigue',
  language: 'cs',
};

function mockRouteAndUser() {
  (verifyToken as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
    userId: USER_ID,
    roles: [],
  });
  (rpcService as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
    run_id: 'r1',
    agents: [{ slug: 'lab-advisor', model: 'gpt-4o' }],
  });
}

async function buildApp() {
  const app = Fastify();
  await app.register(labRecommendationRoutes);
  await app.ready();
  return app;
}

describe('POST /lab-recommendation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('200 with a schema-valid recommendation on a valid model response', async () => {
    mockRouteAndUser();
    (unifiedChat as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      text: JSON.stringify(VALID_MODEL_OUTPUT),
      provider: 'openai',
      model: 'gpt-4o',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/lab-recommendation', headers: AUTH, payload: REQUEST_BODY });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      success: boolean;
      recommendation: {
        story_id: string;
        user_id: string;
        panels: Array<{ tests: unknown[] }>;
        total_tests_count: number;
      };
    };
    expect(body.success).toBe(true);
    // Identity is stamped server-side from the JWT, never from model output.
    expect(body.recommendation.story_id).toBe(STORY_ID);
    expect(body.recommendation.user_id).toBe(USER_ID);
    // The contract the client validates: recommendation.panels[].tests.
    expect(body.recommendation.panels[0].tests.length).toBe(1);
    expect(body.recommendation.total_tests_count).toBe(1);
    expect(resolveAvailableModel).toHaveBeenCalledWith('gpt-4o');
    await app.close();
  });

  it('401 and no LLM call when the JWT is rejected', async () => {
    (verifyToken as unknown as { mockRejectedValue: (v: unknown) => void }).mockRejectedValue(
      new (AuthError as unknown as new (c: number, m: string) => Error)(401, 'bad token'),
    );
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/lab-recommendation', headers: AUTH, payload: REQUEST_BODY });

    expect(res.statusCode).toBe(401);
    expect(rpcService).not.toHaveBeenCalled();
    expect(unifiedChat).not.toHaveBeenCalled();
    await app.close();
  });

  it('502 (no silent fallback) when the model output fails schema validation', async () => {
    mockRouteAndUser();
    // Valid JSON, but panels is not an array → contract violation.
    (unifiedChat as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      text: JSON.stringify({ ...VALID_MODEL_OUTPUT, panels: 'not-an-array' }),
      provider: 'openai',
      model: 'gpt-4o',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/lab-recommendation', headers: AUTH, payload: REQUEST_BODY });

    expect(res.statusCode).toBe(502);
    const body = res.json() as { error: string; recommendation?: unknown };
    expect(body.error).toBe('model_output_invalid');
    // Fail loud — no fabricated recommendation.
    expect(body.recommendation).toBeUndefined();
    await app.close();
  });

  it('400 when the request body violates the contract', async () => {
    mockRouteAndUser();
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/lab-recommendation',
      headers: AUTH,
      payload: { story_id: 'not-a-uuid', products: ['retisin'] },
    });
    expect(res.statusCode).toBe(400);
    expect(unifiedChat).not.toHaveBeenCalled();
    await app.close();
  });
});
