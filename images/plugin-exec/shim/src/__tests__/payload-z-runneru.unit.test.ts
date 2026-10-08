/**
 * Payload, který se nevešel do ENV, si běh vyzvedne z runneru — na token běhu.
 * ⛔ 2026-10-01: kód pluginu 155 KB v PLUGIN_PAYLOAD → „argument list too long“, kontejner
 * se nespustil. Spuštění:
 *   npx vitest run images/plugin-exec/shim/src/__tests__/payload-z-runneru.unit.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('nactiPayloadZRunneru', () => {
  it('GET /beh/payload na BROKER_URL s tokenem běhu, vrátí tělo beze změny', async () => {
    vi.stubEnv('BROKER_URL', 'http://inst-plugin-broker:3031');
    vi.stubEnv('BROKER_TOKEN', 'tok-behu');
    const volani: Array<{ url: string; method: string; auth: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      volani.push({ url, method: String(init?.method), auth: String((init?.headers as Record<string, string>).Authorization) });
      return new Response('{"plugin_code":"velky kod","action":"sync"}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const { nactiPayloadZRunneru } = await import('../broker.js');
    expect(await nactiPayloadZRunneru()).toBe('{"plugin_code":"velky kod","action":"sync"}');
    expect(volani).toEqual([{ url: 'http://inst-plugin-broker:3031/beh/payload', method: 'GET', auth: 'Bearer tok-behu' }]);
  });

  it('⛔ bez BROKER_URL/TOKENU se payload NEVYMÝŠLÍ — chyba', async () => {
    vi.stubEnv('BROKER_URL', '');
    vi.stubEnv('BROKER_TOKEN', '');
    const { nactiPayloadZRunneru } = await import('../broker.js');
    await expect(nactiPayloadZRunneru()).rejects.toThrow(/BROKER_URL/);
  });

  it('⛔ runner odmítne (cizí token, payload v ENV) → chyba se stavem, ne prázdný payload', async () => {
    vi.stubEnv('BROKER_URL', 'http://inst-plugin-broker:3031');
    vi.stubEnv('BROKER_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"unknown_run"}', { status: 401 })));
    const { nactiPayloadZRunneru } = await import('../broker.js');
    await expect(nactiPayloadZRunneru()).rejects.toThrow(/401/);
  });
});
