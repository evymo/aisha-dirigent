/**
 * Tvar odpovědi PostgRESTu přes SKUTEČNÉ HTTP — falešný PostgREST na loopbacku.
 *
 * ⛔ NAMĚŘENO (fork 2026-09-29, services/svc-agent-runner db.unit.test.ts): funkce
 * `RETURNS void` odpoví 204 No Content BEZ TĚLA. `strictRpc` na každé 2xx volal
 * `res.json()` → SyntaxError AŽ PO ZÁPISU v databázi. Volající pak zápis, který
 * proběhl, hlásil jako chybu — svc-health-ai z ní dělal 429 a falešný audit
 * „rate_limited" u KAŽDÉ analýzy.
 *
 * client.test.ts podvrhuje globální `fetch` — tady jde požadavek opravdovým
 * `fetch` přes TCP, takže se měří i to, co dělá undici s odpovědí 204 (hlavičky,
 * prázdné tělo), ne jen to, co si o ní myslí mock.
 *
 * Kontrakt:
 *   204                         → null (úspěch bez hodnoty), požadavek DOŠEL (zápis proběhl)
 *   200 + JSON                  → hodnota
 *   200 + prázdné tělo          → výjimka (vada serveru, NE tichý null)
 *   non-2xx                     → PostgRESTError se stavem
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createNullableServiceRpc,
  createNullableUserRpc,
  createServiceRpc,
  createUserRpc,
  PostgRESTError,
  rpc,
  type VoidRpcResult,
} from '../index.js';

interface Prijato {
  fn: string;
  authorization: string | undefined;
  body: unknown;
}

let server: Server;
let prijato: Prijato[] = [];

/** Odpovědi falešného PostgRESTu podle jména funkce — tvar jako PostgREST v12+ (v14.1 v Dockerfile.postgrest). */
function odpovez(fn: string, res: ServerResponse): void {
  switch (fn) {
    case 'void_fn':
      // RETURNS void: 204 bez těla a bez Content-Type.
      res.writeHead(204);
      res.end();
      return;
    case 'void_fn_s_hlavickou':
      // 204, ale s Content-Type: json — rozhoduje STAV, ne hlavička.
      res.writeHead(204, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end();
      return;
    case 'json_fn':
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify([{ id: 'r1', ok: true }]));
      return;
    case 'skalar_fn':
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end('"4f0c2a1e-0000-4000-8000-000000000001"');
      return;
    case 'null_fn':
      // JSON `null` je HODNOTA (např. funkce vrátila NULL) — ne prázdné tělo.
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end('null');
      return;
    case 'prazdna_200':
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end();
      return;
    case 'boom':
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 'XX000', message: 'internal', details: null, hint: null }));
      return;
    default:
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 'PGRST202', message: `Could not find the function public.${fn}` }));
  }
}

function obsluha(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const m = /^\/rpc\/([a-z0-9_]+)$/.exec(req.url ?? '');
    const fn = m?.[1] ?? '';
    const text = Buffer.concat(chunks).toString('utf8');
    prijato.push({ fn, authorization: req.headers.authorization, body: text ? JSON.parse(text) : null });
    odpovez(fn, res);
  });
}

beforeAll(async () => {
  server = createServer(obsluha);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  process.env.POSTGREST_URL = `http://127.0.0.1:${port}`;
  process.env.POSTGREST_SERVICE_TOKEN = 'servisni-token-fixtura';
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  prijato = [];
});

describe('strictRpc (createServiceRpc / createUserRpc) přes HTTP', () => {
  it('204 (RETURNS void) → null a požadavek DOŠEL na server — žádná výjimka po zápisu', async () => {
    const rpcService = createServiceRpc({ timeoutMs: 5_000, accept: false });
    await expect(rpcService<VoidRpcResult>('void_fn', { p_x: 1 })).resolves.toBeNull();
    expect(prijato).toEqual([
      { fn: 'void_fn', authorization: 'Bearer servisni-token-fixtura', body: { p_x: 1 } },
    ]);
  });

  it('204 i s Content-Type: application/json → null (rozhoduje stav, ne hlavička)', async () => {
    await expect(createServiceRpc()<null>('void_fn_s_hlavickou')).resolves.toBeNull();
  });

  it('createUserRpc: 204 → null, nese JWT volajícího', async () => {
    const rpcUser = createUserRpc({ timeoutMs: 5_000, accept: false });
    await expect(rpcUser<null>('void_fn', { p_endpoint_key: 'k' }, 'jwt-uzivatele')).resolves.toBeNull();
    expect(prijato[0]?.authorization).toBe('Bearer jwt-uzivatele');
  });

  it('200 + JSON → hodnota (pole řádků, skalár, JSON null)', async () => {
    const rpcService = createServiceRpc({ accept: true, preferRepresentation: true });
    await expect(rpcService('json_fn')).resolves.toEqual([{ id: 'r1', ok: true }]);
    await expect(rpcService('skalar_fn')).resolves.toBe('4f0c2a1e-0000-4000-8000-000000000001');
    await expect(rpcService('null_fn')).resolves.toBeNull();
  });

  it('200 s PRÁZDNÝM tělem je vada serveru → hlasitá výjimka, ne tichý null', async () => {
    await expect(createServiceRpc()('prazdna_200')).rejects.toThrow(SyntaxError);
  });

  it('500 → PostgRESTError se stavem a tělem', async () => {
    const err = await createServiceRpc()('boom').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PostgRESTError);
    expect((err as PostgRESTError).status).toBe(500);
    expect(String((err as PostgRESTError).body)).toContain('XX000');
  });
});

describe('nullableRpc (createNullable*Rpc) přes HTTP', () => {
  it('204 bez hlavičky → null', async () => {
    await expect(createNullableServiceRpc()('void_fn')).resolves.toBeNull();
  });

  it('204 s Content-Type: application/json → null (dřív res.json() na prázdném těle → SyntaxError)', async () => {
    await expect(createNullableServiceRpc()('void_fn_s_hlavickou')).resolves.toBeNull();
    await expect(createNullableUserRpc()('void_fn_s_hlavickou', {}, 'jwt')).resolves.toBeNull();
  });

  it('200 + JSON → hodnota; 500 → PostgRESTError', async () => {
    await expect(createNullableServiceRpc()('json_fn')).resolves.toEqual([{ id: 'r1', ok: true }]);
    await expect(createNullableServiceRpc()('boom')).rejects.toBeInstanceOf(PostgRESTError);
  });
});

describe('rpc (lenient, reflexe) přes HTTP', () => {
  it('204 → null', async () => {
    await expect(rpc('void_fn')).resolves.toBeNull();
  });
});
