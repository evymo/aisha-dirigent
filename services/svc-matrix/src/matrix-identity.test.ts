/**
 * Unit tests for the KC→Matrix identity bridge (resolveMatrixIdentity).
 *
 * Locks in the fail-loud / no-split-brain invariant: the derived matrixUserId
 * (and the service password behind it) is keyed ONLY on the stable user.userId,
 * so a failure of the fallible get_profile_display_name RPC can NEVER move a
 * Keycloak user onto a different Matrix account.
 *
 * Boundaries mocked: rpcService (PostgREST), config, and global fetch (Synapse).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VerifiedUser } from './auth.js';

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock('./postgrest.js', () => ({ rpcService: mockRpc }));

vi.mock('./config.js', () => ({
  config: {
    synapseAdminUrl: 'http://synapse:8008',
    synapseRegistrationSecret: 'shared-secret',
    matrixDomain: 'aisha.guru',
  },
}));

// The SSRF guard is infra (unit-tested in packages/security); here safeFetch just
// delegates to the mocked global fetch so we can assert the Synapse request/response.
vi.mock('@aisha/security', () => ({
  createSsrfGuard: () => ({
    safeFetch: (url: string, init?: RequestInit) => fetch(url, init),
  }),
  parseHostAllowlist: () => [],
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => payload } as unknown as Response;
}

/** GET → nonce, POST /register → ok with an access token. */
function stubSynapseFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method === 'GET') return jsonResponse({ nonce: 'nonce-123' });
      return jsonResponse({ access_token: 'mx-cs-access-token' });
    }),
  );
}

const USER = { userId: 'kc-sub-abc', roles: [], claims: {} } as unknown as VerifiedUser;

beforeEach(() => {
  mockRpc.mockReset();
  vi.unstubAllGlobals();
});

describe('resolveMatrixIdentity — stable identity (no split-brain)', () => {
  it('derives the SAME matrixUserId whether the profile RPC succeeds or fails', async () => {
    const { resolveMatrixIdentity } = await import('./matrix-identity.js');

    // Profile RPC succeeds and returns a *different* username — under the old
    // code this would have driven the localpart and split the account.
    stubSynapseFetch();
    mockRpc.mockResolvedValueOnce({ display_name: 'Alice', username: 'alice-custom-handle' });
    const withProfile = await resolveMatrixIdentity(USER);

    // Profile RPC fails outright.
    stubSynapseFetch();
    mockRpc.mockRejectedValueOnce(new Error('PostgREST RPC get_profile_display_name failed: 500'));
    const withoutProfile = await resolveMatrixIdentity(USER);

    // Identity is keyed on user.userId, not the profile username.
    expect(withProfile.matrixUserId).toBe('@kc-sub-abc:aisha.guru');
    expect(withoutProfile.matrixUserId).toBe(withProfile.matrixUserId);
  });

  it('keys the registered localpart on user.userId, ignoring the profile username', async () => {
    const { resolveMatrixIdentity } = await import('./matrix-identity.js');

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || init.method === 'GET') return jsonResponse({ nonce: 'nonce-123' });
      return jsonResponse({ access_token: 'mx-cs-access-token' });
    });
    vi.stubGlobal('fetch', fetchMock);
    mockRpc.mockResolvedValueOnce({ display_name: 'Alice', username: 'alice-custom-handle' });

    await resolveMatrixIdentity(USER);

    // The register POST body carries the userId-derived localpart, and the
    // display name (cosmetic) still comes from the profile.
    const registerCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    const body = JSON.parse((registerCall![1] as RequestInit).body as string);
    expect(body.username).toBe('kc-sub-abc');
    expect(body.displayname).toBe('Alice');
  });
});
