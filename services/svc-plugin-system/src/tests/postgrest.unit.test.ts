/**
 * Unit tests for PostgREST sandbox RPC enforcement.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

async function loadPostgrestWithWhitelist(rpcWhitelist: string[]) {
  vi.resetModules();
  // The shared @aisha/postgrest-client resolves the PostgREST URL + service token
  // from the canonical env (POSTGREST_URL / POSTGREST_SERVICE_TOKEN) — the same
  // source every service's config reads — so the token is provided here, not via a
  // config-object mock. `rpcSandboxed`'s whitelist still comes from config.
  process.env.POSTGREST_URL = 'http://postgrest:3000';
  process.env.POSTGREST_SERVICE_TOKEN = 'service-token';
  vi.doMock('../config.js', () => ({
    config: {
      postgrestUrl: 'http://postgrest:3000',
      postgrestServiceToken: 'service-token',
      rpcWhitelist,
    },
  }));
  return await import('../postgrest.js');
}

describe('rpcSandboxed', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    (globalThis as { fetch: unknown }).fetch = mockFetch;
  });

  it('denies all plugin RPC calls when PLUGIN_RPC_WHITELIST is empty', async () => {
    const { rpcSandboxed } = await loadPostgrestWithWhitelist([]);

    await expect(rpcSandboxed('get_my_stories', {})).rejects.toThrow(
      'No RPC functions are allowed for this plugin',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('denies RPC functions missing from the whitelist', async () => {
    const { rpcSandboxed } = await loadPostgrestWithWhitelist(['get_my_stories']);

    await expect(rpcSandboxed('admin_reset_user_password', {})).rejects.toThrow(
      "Plugin RPC call to 'admin_reset_user_password' is not whitelisted",
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls PostgREST with service token only for whitelisted functions', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { rpcSandboxed } = await loadPostgrestWithWhitelist(['get_my_stories']);

    await expect(rpcSandboxed('get_my_stories', { p_limit: 10 })).resolves.toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://postgrest:3000/rpc/get_my_stories',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer service-token' }),
        body: JSON.stringify({ p_limit: 10 }),
      }),
    );
  });
});
