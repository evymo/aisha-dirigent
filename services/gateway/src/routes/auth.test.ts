import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const tokens = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
};

const SLEDOVANE = ['ALLOWED_REDIRECT_URIS', 'NODE_ENV', 'FRONTEND_URL', 'PUBLIC_URL', 'APP_DOMAIN', 'API_DOMAIN_PUBLIC'] as const;
const puvodni = Object.fromEntries(SLEDOVANE.map((k) => [k, process.env[k]]));

const configuredRedirectUris = [
  'http://localhost:5173',
  'https://web.example.test',
  'aisha-dirigent://oauth-callback',
  'https://vscode.dev/redirect*',
  'https://strom.example.test/app/**',
].join(',');

const loadAuthModule = async (env: Partial<Record<(typeof SLEDOVANE)[number], string | undefined>> = {}) => {
  vi.resetModules();
  process.env.ALLOWED_REDIRECT_URIS = configuredRedirectUris;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import('./auth.js');
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const k of SLEDOVANE) {
    if (puvodni[k] === undefined) delete process.env[k];
    else process.env[k] = puvodni[k];
  }
});

describe('auth redirect hardening', () => {
  it('allows configured web origin paths', async () => {
    const { isAllowedRedirect } = await loadAuthModule();

    expect(isAllowedRedirect('https://web.example.test/member')).toBe(true);
  });

  it('rejects host-prefix open redirects', async () => {
    const { isAllowedRedirect } = await loadAuthModule();

    expect(isAllowedRedirect('https://web.example.test.evil.test/member')).toBe(false);
    expect(isAllowedRedirect('https://web.example.test@evil.test/member')).toBe(false);
  });

  // ⛔ Audit vydání 2026-10-01 (PR-S1): `https://vscode.dev/redirect*` pustil přesměrovač
  // s libovolným `?url=` — a k cíli jdou access i refresh token. Předponový zástupný znak
  // proto nepustí nic, ani když ho operátor zapíše.
  it('does NOT honour a prefix wildcard — an open redirector would receive the tokens', async () => {
    const { isAllowedRedirect } = await loadAuthModule();

    expect(isAllowedRedirect('https://vscode.dev/redirect?url=vscode%3A%2F%2Fcizi.rozsireni%2Fx')).toBe(false);
    expect(isAllowedRedirect('https://vscode.dev/redirect')).toBe(false);
  });

  it('keeps the same-origin path tree (/**) wildcard', async () => {
    const { isAllowedRedirect } = await loadAuthModule();

    expect(isAllowedRedirect('https://strom.example.test/app/a/b')).toBe(true);
    expect(isAllowedRedirect('https://strom.example.test/jinde')).toBe(false);
  });

  it('rejects unconfigured redirect hosts', async () => {
    const { isAllowedRedirect } = await loadAuthModule();

    expect(isAllowedRedirect('https://evil.test/redirect')).toBe(false);
  });

  it('places browser redirect tokens in the URL fragment instead of the query string', async () => {
    const { buildTokenRedirectUrl } = await loadAuthModule();
    const redirectUrl = new URL(buildTokenRedirectUrl('https://web.example.test/member?x=1', tokens));

    expect(redirectUrl.searchParams.get('access_token')).toBeNull();
    expect(redirectUrl.searchParams.get('refresh_token')).toBeNull();

    const fragment = new URLSearchParams(redirectUrl.hash.slice(1));
    expect(fragment.get('access_token')).toBe(tokens.access_token);
    expect(fragment.get('refresh_token')).toBe(tokens.refresh_token);
    expect(fragment.get('expires_in')).toBe(String(tokens.expires_in));
  });

  it('keeps custom-scheme callback tokens in the query for deep-link compatibility', async () => {
    const { buildTokenRedirectUrl } = await loadAuthModule();
    const redirectUrl = buildTokenRedirectUrl('aisha-dirigent://oauth-callback', tokens);

    expect(redirectUrl).toBe(
      'aisha-dirigent://oauth-callback?access_token=access-token&token_type=bearer&expires_in=3600&refresh_token=refresh-token',
    );
  });
});

describe('auth routes fail closed without derivable addresses (production)', () => {
  const bezDomen = {
    NODE_ENV: 'production',
    FRONTEND_URL: undefined,
    PUBLIC_URL: undefined,
    APP_DOMAIN: undefined,
    API_DOMAIN_PUBLIC: undefined,
  };

  async function zadost(url: string, env: Parameters<typeof loadAuthModule>[0]) {
    const { authRoutes } = await loadAuthModule(env);
    const app = Fastify();
    await app.register(authRoutes);
    const res = await app.inject({ method: 'GET', url });
    await app.close();
    return res;
  }

  it.each(['/authorize?provider=keycloak', '/callback?code=abc&state=x', '/verify?token=t&type=signup'])(
    '%s → 503, no redirect, no token exchange',
    async (url) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const res = await zadost(url, bezDomen);
      expect(res.statusCode).toBe(503);
      expect(res.headers.location).toBeUndefined();
      expect(res.json()).toMatchObject({ error: 'auth_not_configured' });
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    },
  );

  it('with domains declared, /authorize redirects to Keycloak with the derived callback', async () => {
    const res = await zadost('/authorize?provider=keycloak', {
      ...bezDomen,
      APP_DOMAIN: 'web.example.test',
      API_DOMAIN_PUBLIC: 'api.example.test',
    });
    expect(res.statusCode).toBe(302);
    const cil = new URL(res.headers.location as string);
    expect(cil.searchParams.get('redirect_uri')).toBe('https://api.example.test/auth/v1/callback');
    const stav = JSON.parse(atob(cil.searchParams.get('state') ?? '')) as { redirect_to?: string };
    expect(stav.redirect_to).toBe('https://web.example.test');
  });
});
