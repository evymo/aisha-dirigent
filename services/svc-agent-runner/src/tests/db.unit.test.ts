/**
 * rpcService proti SKUTEČNÉMU tvaru odpovědí PostgRESTu.
 *
 * Testy tras (runs-and-docker) rpcService mockují, takže tvar odpovědi nikdy
 * neviděly. Naměřeno na instanci 2026-09-29 09:55Z: `update_agent_run_status` je
 * RETURNS void → prázdné tělo → `res.json()` spadl, POST /runs vrátil 500 a běh
 * zůstal 'running' navždy. Tady se volá opravdový rpcService nad podvrženým fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: { postgrestUrl: 'http://postgrest.test', postgrestServiceToken: 'tok' },
}));
const { rpcService } = await import('../db.js');

function odpoved(status: number, telo: string | null): Response {
  return new Response(telo, { status, headers: telo ? { 'Content-Type': 'application/json' } : {} });
}

afterEach(() => vi.unstubAllGlobals());

describe('rpcService: tvar odpovědi PostgRESTu', () => {
  it('funkce RETURNS void (204, prázdné tělo) → undefined, žádná výjimka', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(odpoved(204, null)));
    await expect(rpcService('update_agent_run_status', { p_status: 'running' })).resolves.toBeUndefined();
  });

  it('200 s prázdným tělem → undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(odpoved(200, '')));
    await expect(rpcService('update_agent_run_status', {})).resolves.toBeUndefined();
  });

  it('skalár (RETURNS uuid) → holý řetězec, pole řádků → pole', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(odpoved(200, '"4f0c2a1e-0000-4000-8000-000000000001"')));
    await expect(rpcService('enqueue_agent_run', {})).resolves.toBe('4f0c2a1e-0000-4000-8000-000000000001');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(odpoved(200, '[{"id":"a"}]')));
    await expect(rpcService('get_agent_run', {})).resolves.toEqual([{ id: 'a' }]);
  });

  it('chyba PostgRESTu se ohlásí jménem funkce a stavem, ne tichým undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(odpoved(404, '{"message":"not found"}')));
    await expect(rpcService('neexistuje', {})).rejects.toThrow(/RPC neexistuje failed \(404\)/);
  });

  it('rozbité JSON tělo NENÍ prázdné tělo — spadne nahlas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(odpoved(200, '{"id":')));
    await expect(rpcService('get_agent_run', {})).rejects.toThrow(SyntaxError);
  });
});
