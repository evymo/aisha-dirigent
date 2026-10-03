import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before vi.mock() calls
// ---------------------------------------------------------------------------
const hoisted = vi.hoisted(() => ({
  mockHttpFetch: vi.fn(),
  mockCreateApiClient: vi.fn(),
  isUsingDevFallback: { value: false },
}));

vi.mock('@/integrations/api/client', () => ({
  createApiClient: hoisted.mockCreateApiClient,
  gatewayUrl: 'http://localhost:3001',
  get isUsingDevFallback() {
    return hoisted.isUsingDevFallback.value;
  },
}));

vi.mock('@/integrations/auth/oidc-config', () => ({
  oidcConfig: {
    authority: 'http://localhost:8080/realms/aisha',
    clientId: 'aisha-app',
  },
}));

vi.mock('@/lib/net/httpFetch', () => ({
  httpFetch: hoisted.mockHttpFetch,
}));

vi.mock('@/lib/security/safeLogger', () => ({
  safeError: vi.fn(),
}));

// Polyfill AbortSignal.timeout for test environments (jsdom)
if (typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('TimeoutError', 'TimeoutError')), ms);
    return controller.signal;
  };
}

// Static import — vi.mock above ensures dependencies are mocked
import {
  createPhiApiClient,
  createLegacyPhiClient,
  phiVerifyPassword,
} from '@/integrations/db/secureClient';

// ---------------------------------------------------------------------------

describe('secureClient — v2 PHI mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.isUsingDevFallback.value = false;
    hoisted.mockCreateApiClient.mockImplementation(
      (getToken: () => Promise<string | null>) => ({
        rpc: vi.fn(async () => {
          const token = await getToken();
          return { data: { token }, error: null };
        }),
      }),
    );
  });

  it('createPhiApiClient vytváří klienta s rpc metodou', () => {
    const client = createPhiApiClient('test-phi-token');

    expect(client).toBeDefined();
    expect(typeof client.rpc).toBe('function');
  });

  it('createPhiApiClient odmítne dev fallback backend', () => {
    hoisted.isUsingDevFallback.value = true;

    expect(() => createPhiApiClient('token')).toThrow('secure mode is not available');
  });

  it('createLegacyPhiClient backward-compat odmítne dev fallback', () => {
    hoisted.isUsingDevFallback.value = true;

    expect(() => createLegacyPhiClient()).toThrow('secure mode is not available');
  });

  it('phiVerifyPassword volá KC token endpoint', async () => {
    hoisted.mockHttpFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'phi-jwt-token' }),
    });

    const result = await phiVerifyPassword('user@example.com', 'secret');

    expect(result.ok).toBe(true);
    expect(result.accessToken).toBe('phi-jwt-token');
    expect(hoisted.mockHttpFetch).toHaveBeenCalledWith(
      'http://localhost:8080/realms/aisha/protocol/openid-connect/token',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('phiVerifyPassword vrací chybu při špatném heslu', async () => {
    hoisted.mockHttpFetch.mockResolvedValue({
      ok: false,
      status: 401,
    });

    const result = await phiVerifyPassword('user@example.com', 'wrong');

    expect(result.ok).toBe(false);
    expect(result.message).toBe('Authentication failed.');
  });
});
