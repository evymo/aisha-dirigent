import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

// Auth: admin principal. isAdminOrStaff → true so we reach the OpenAI fetch.
// Čtečka pověření (2026-10-02): v testu trezor = prostředí procesu (tvar createCredentialReader).
vi.mock('../lib/credentials.js', () => ({
  credentials: {
    get: async (n: string) => (n === 'OPENAI_API_KEY' ? 'sk-test' : null),
    getMany: async (ns: readonly string[]) => Object.fromEntries(ns.map((n) => [n, process.env[n] ?? null])),
    migrateEnvCredentials: async () => ({ moved: [], kept: [], absent: [], failed: [] }),
    invalidate: () => undefined,
  },
  POVERENI_Z_PROSTREDI: [],
}));
vi.mock('../auth.js', () => ({
  verifyToken: vi.fn().mockResolvedValue({ userId: 'u1', roles: ['admin'] }),
  isAdminOrStaff: () => true,
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));
// Keep the route module hermetic — the boot-time discover/self-test collaborators
// are unrelated to the list handler under test.
vi.mock('../lib/modelDiscovery.js', () => ({
  discoverModels: vi.fn(),
  isNonChatModelId: () => false,
}));
vi.mock('../lib/modelSelfTest.js', () => ({ selfTestModels: vi.fn() }));
vi.mock('../lib/llmRouter.js', () => ({ getAllBackends: () => [] }));
vi.mock('../postgrest.js', () => ({ rpcService: vi.fn() }));
vi.mock('../config.js', () => ({
  config: { openaiApiKey: 'sk-test', chatModelPrefixes: ['gpt-', 'o1-', 'o3-', 'o4-'] },
}));

import { modelsRoutes } from '../routes/models.js';

async function buildApp() {
  const app = Fastify();
  await app.register(modelsRoutes);
  await app.ready();
  return app;
}

describe('POST /models/list alias', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-4o', created: 200, owned_by: 'openai' },
          { id: 'gpt-3.5-turbo', created: 100, owned_by: 'openai' },
          { id: 'text-embedding-3-small', created: 300, owned_by: 'openai' },
        ],
      }),
    }) as unknown as typeof fetch;
  });
  afterEach(() => vi.clearAllMocks());

  it('POST /models/list returns the SAME payload as GET /models/list', async () => {
    const app = await buildApp();
    const auth = { authorization: 'Bearer ey.header.payload' };

    const getRes = await app.inject({ method: 'GET', url: '/models/list', headers: auth });
    const postRes = await app.inject({ method: 'POST', url: '/models/list', headers: auth });

    expect(getRes.statusCode).toBe(200);
    expect(postRes.statusCode).toBe(200);
    expect(postRes.json()).toEqual(getRes.json());
    // Only chat-prefixed models, newest first — returned as OpenAiModelEntry
    // objects ({ id, created, owned_by }), the shape the client hook consumes.
    expect(postRes.json()).toEqual({
      models: [
        { id: 'gpt-4o', created: 200, owned_by: 'openai' },
        { id: 'gpt-3.5-turbo', created: 100, owned_by: 'openai' },
      ],
    });

    await app.close();
  });
});
