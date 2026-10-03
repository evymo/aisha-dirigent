/**
 * Unit tests for the POST /homeassistant-api action dispatcher.
 *
 * The web client (src/hooks/homeassistant/haApi.ts) posts a single body
 * with an `action` discriminator. This route must delegate:
 *   action='health'               → the connectivity-check (fetchHaConfig)
 *   action='sync_production_data' → the production sync (fetchHaStates)
 * and reject unknown/missing actions with 400 before any privileged work.
 *
 * We mock at the boundary: auth (verifyToken/isAdminOrStaff), HA config
 * loading, the HA client (fetchHaConfig/fetchHaStates), and the RPC layer.
 * Routing is proven by which HA-client call fires for each action.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockVerifyToken,
  mockIsAdminOrStaff,
  mockGetHomeAssistantConfig,
  mockFetchHaConfig,
  mockFetchHaStates,
  mockRpcService,
} = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockIsAdminOrStaff: vi.fn(),
  mockGetHomeAssistantConfig: vi.fn(),
  mockFetchHaConfig: vi.fn(),
  mockFetchHaStates: vi.fn(),
  mockRpcService: vi.fn(),
}));

class FakeAuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

vi.mock('../auth.js', () => ({
  verifyToken: mockVerifyToken,
  isAdminOrStaff: mockIsAdminOrStaff,
  AuthError: FakeAuthError,
}));

vi.mock('../lib/ha-config.js', () => ({
  getHomeAssistantConfig: mockGetHomeAssistantConfig,
}));

vi.mock('../lib/ha-client.js', async () => {
  // Keep the real parse helpers; only the network-bound calls are mocked.
  const actual = await vi.importActual<typeof import('../lib/ha-client.js')>('../lib/ha-client.js');
  return {
    ...actual,
    fetchHaConfig: mockFetchHaConfig,
    fetchHaStates: mockFetchHaStates,
  };
});

vi.mock('../postgrest.js', () => ({ rpcService: mockRpcService }));

async function buildApp(): Promise<FastifyInstance> {
  const { homeAssistantApiRoute } = await import('./homeassistant-api.js');
  const app = Fastify();
  await app.register(homeAssistantApiRoute);
  await app.ready();
  return app;
}

const ADMIN_USER = { userId: 'user-1', email: 'admin@example.com', roles: ['admin'], claims: {} };

let app: FastifyInstance;

beforeEach(async () => {
  mockVerifyToken.mockReset();
  mockIsAdminOrStaff.mockReset();
  mockGetHomeAssistantConfig.mockReset();
  mockFetchHaConfig.mockReset();
  mockFetchHaStates.mockReset();
  mockRpcService.mockReset();

  mockVerifyToken.mockResolvedValue(ADMIN_USER);
  mockIsAdminOrStaff.mockReturnValue(true);
  mockGetHomeAssistantConfig.mockResolvedValue({ baseUrl: 'http://ha.local:8123', accessToken: 'tok' });
  mockFetchHaConfig.mockResolvedValue({
    config: { location_name: 'Lab', time_zone: 'UTC', unit_system: { temperature: '°C' } },
    haVersion: '2026.7.0',
    transport: 'rest',
  });
  mockFetchHaStates.mockResolvedValue({ haVersion: '2026.7.0', states: [], transport: 'rest' });
  mockRpcService.mockResolvedValue(null);

  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

describe('POST /homeassistant-api', () => {
  it("action='health' delegates to the connectivity-check path", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/homeassistant-api',
      headers: { authorization: 'Bearer valid' },
      payload: { action: 'health' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.ha_version).toBe('2026.7.0');
    // Routed to health handler, NOT sync.
    expect(mockFetchHaConfig).toHaveBeenCalledTimes(1);
    expect(mockFetchHaStates).not.toHaveBeenCalled();
  });

  it("action='sync_production_data' delegates to the sync path", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/homeassistant-api',
      headers: { authorization: 'Bearer valid' },
      payload: { action: 'sync_production_data', sensor_entities: ['sensor.temp'] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    // Routed to sync handler, NOT health.
    expect(mockFetchHaStates).toHaveBeenCalledTimes(1);
    expect(mockFetchHaConfig).not.toHaveBeenCalled();
  });

  it('rejects an unknown action with 400 before any HA call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/homeassistant-api',
      headers: { authorization: 'Bearer valid' },
      payload: { action: 'delete_everything' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/action/i);
    expect(mockFetchHaConfig).not.toHaveBeenCalled();
    expect(mockFetchHaStates).not.toHaveBeenCalled();
  });

  it('rejects a missing action with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/homeassistant-api',
      headers: { authorization: 'Bearer valid' },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(mockFetchHaConfig).not.toHaveBeenCalled();
    expect(mockFetchHaStates).not.toHaveBeenCalled();
  });

  it('preserves the delegated auth check — non-admin is forbidden', async () => {
    mockIsAdminOrStaff.mockReturnValue(false);

    const res = await app.inject({
      method: 'POST',
      url: '/homeassistant-api',
      headers: { authorization: 'Bearer valid' },
      payload: { action: 'health' },
    });

    expect(res.statusCode).toBe(403);
    expect(mockFetchHaConfig).not.toHaveBeenCalled();
  });
});
