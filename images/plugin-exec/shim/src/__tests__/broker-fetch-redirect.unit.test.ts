/**
 * Shim ctx.fetch — volba `redirect` a hlavičky dojdou brokeru beze ztráty.
 *
 * Vada: shim posílal brokeru jen url/method/headers/body. `redirect` zahodil,
 * takže broker následoval každé přesměrování i tehdy, když plugin chtěl
 * 'manual' nebo 'error'. A hlavičky předané jako instance `Headers` se přes
 * JSON.stringify změnily na `{}` — tiše zmizely.
 *
 * Broker (svc-plugin-system /sandbox/fetch) vynucuje obě volby přes SSRF guard;
 * tady se měří jen to, že shim předá, co plugin řekl, a že 3xx obálka od
 * brokeru se pluginu vrátí jako Response s Location.
 *
 * Běh (vitest je v kořeni repa, ne v tomto balíčku):
 *   node_modules/.bin/vitest run --root . --config <dočasná config zahrnující
 *   tento soubor> images/plugin-exec/shim/src/__tests__/broker-fetch-redirect.unit.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSandboxContext } from '../broker.js';

const IDENTITA = {
  plugin: { version: '0.0.0-test' },
  tenant: { id: '00000000-0000-0000-0000-000000000000' },
  config: {},
};

function captureBroker(envelope: { status: number; headers: Record<string, string>; body: string }) {
  const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), payload: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

describe('shim ctx.fetch — redirect a hlavičky', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("předá redirect: 'manual' a vrátí 3xx jako Response s Location", async () => {
    const calls = captureBroker({ status: 302, headers: { location: 'https://api.example.com/next' }, body: '' });
    const ctx = createSandboxContext([], IDENTITA, []);
    const res = await ctx.fetch('https://api.example.com/start', { redirect: 'manual' });
    expect(calls[0].url).toMatch(/\/sandbox\/fetch$/);
    expect(calls[0].payload.redirect).toBe('manual');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://api.example.com/next');
  });

  it("předá redirect: 'error'", async () => {
    const calls = captureBroker({ status: 200, headers: {}, body: 'ok' });
    const ctx = createSandboxContext([], IDENTITA, []);
    await ctx.fetch('https://api.example.com/start', { redirect: 'error' });
    expect(calls[0].payload.redirect).toBe('error');
  });

  it("bez volby pošle fetch výchozí 'follow' (explicitně, ne vynecháním)", async () => {
    const calls = captureBroker({ status: 200, headers: {}, body: 'ok' });
    const ctx = createSandboxContext([], IDENTITA, []);
    await ctx.fetch('https://api.example.com/start');
    expect(calls[0].payload.redirect).toBe('follow');
  });

  it('hlavičky jako instance Headers se nepoztrácejí', async () => {
    const calls = captureBroker({ status: 200, headers: {}, body: 'ok' });
    const ctx = createSandboxContext([], IDENTITA, []);
    await ctx.fetch('https://api.example.com/start', {
      headers: new Headers({ 'X-Api-Key': 'k', Accept: 'application/json' }),
    });
    expect(calls[0].payload.headers).toEqual({ 'x-api-key': 'k', accept: 'application/json' });
  });

  it('hlavičky jako záznam projdou (jména malými písmeny — HTTP je na velikost necitlivé)', async () => {
    const calls = captureBroker({ status: 200, headers: {}, body: 'ok' });
    const ctx = createSandboxContext([], IDENTITA, []);
    await ctx.fetch('https://api.example.com/start', { headers: { SOAPAction: 'x' } });
    expect(calls[0].payload.headers).toEqual({ soapaction: 'x' });
  });
});
