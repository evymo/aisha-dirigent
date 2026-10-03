/**
 * Shim si konfiguraci běhu vyzvedne z brokeru — ne z ENV.
 * ⛔ 2026-09-16: `ctx.config` byl vždy `{}` z PLUGIN_PAYLOAD (ENV kontejneru).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('nactiKonfiguraci', () => {
  it('zavolá /sandbox/config s tokenem běhu a vrátí objekt', async () => {
    vi.stubEnv('BROKER_URL', 'http://broker.invalid');
    vi.stubEnv('BROKER_TOKEN', 'tok-behu');
    const volani: Array<{ url: string; auth: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      volani.push({ url, auth: String((init?.headers as Record<string, string>).Authorization) });
      return new Response(JSON.stringify({ apiKey: 'tajne' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const { nactiKonfiguraci } = await import('../broker.js');
    expect(await nactiKonfiguraci()).toEqual({ apiKey: 'tajne' });
    expect(volani).toEqual([{ url: 'http://broker.invalid/sandbox/config', auth: 'Bearer tok-behu' }]);
  });

  it('⛔ bez brokeru se konfigurace NEVYMÝŠLÍ — chyba', async () => {
    vi.stubEnv('BROKER_URL', '');
    vi.stubEnv('BROKER_TOKEN', '');
    const { nactiKonfiguraci } = await import('../broker.js');
    await expect(nactiKonfiguraci()).rejects.toThrow(/BROKER_URL/);
  });

  it('⛔ broker vrátí chybu → chyba (běh se nespustí)', async () => {
    vi.stubEnv('BROKER_URL', 'http://broker.invalid');
    vi.stubEnv('BROKER_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    const { nactiKonfiguraci } = await import('../broker.js');
    await expect(nactiKonfiguraci()).rejects.toThrow(/503/);
  });
});
