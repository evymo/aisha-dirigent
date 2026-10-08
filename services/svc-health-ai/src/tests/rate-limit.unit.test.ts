/**
 * Stráž limitu analýz (`enforce_rate_limit`) přes SKUTEČNÉ HTTP.
 *
 * ⛔ NAMĚŘENO (čtení upstream mainu 66b4e84ff): obě routy volaly
 * `rpcUser('enforce_rate_limit', …)` v `try { } catch { 429 }`. Funkce je
 * `RETURNS void` → PostgREST odpoví 204 bez těla → klient na ní padal
 * SyntaxError → KAŽDÝ požadavek na analýzu dostal 429 (dokument navíc falešný
 * audit „rate_limited"). A naopak: kdyby klient prošel, `catch` by z JAKÉKOLI
 * chyby (výpadek PostgRESTu, cizí výjimka) udělal „rate limited" — 429 místo
 * poruchy, falešný audit.
 *
 * Měří se celá cesta: ověření tokenu proti JWKS na loopbacku (podepsáno
 * skutečným klíčem), opravdový `@aisha/postgrest-client` a falešný PostgREST na
 * loopbacku, který odpovídá tvarem PostgRESTu (204 pro void, 400 + JSON chyba
 * pro RAISE EXCEPTION). Klient se NEmockuje.
 *
 * Kontrakt:
 *   204 (limit nepřekročen)                    → routa pokračuje dalším krokem
 *   P0001 „Rate limit exceeded for <klíč>."   → 429 (+ audit rate_limited u dokumentu)
 *   cokoli jiného (jiná výjimka, 5xx, spojení) → 503, BEZ auditu rate_limited, dál se NEpokračuje
 *                                                (výpadek stráže limitu = fail-closed)
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const REALM = 'fixtura-zdravi';
const UZIVATEL = randomUUID();
/** Značka v těle chyby PostgRESTu — nesmí se objevit v logu služby („log bez hodnot"). */
const ZNACKA_V_TELE = 'znacka-tela-7f3a';

type Chovani = 'povoleno' | 'prekroceno' | 'jina_vyjimka' | 'vypadek_5xx' | 'spojeni_spadne';

interface Volani {
  fn: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

let server: Server;
let base = '';
let token = '';
let chovani: Chovani = 'povoleno';
let volani: Volani[] = [];
let logy: string[] = [];
let app: FastifyInstance;

function json(res: ServerResponse, status: number, telo: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(telo));
}

/** Odpověď na enforce_rate_limit tvarem PostgRESTu (v12+; Dockerfile.postgrest pinuje v14.1). */
function enforceRateLimit(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>): void {
  const klic = String(body.p_endpoint_key);
  switch (chovani) {
    case 'povoleno':
      res.writeHead(204);
      res.end();
      return;
    case 'prekroceno':
      // RAISE EXCEPTION bez ERRCODE ⇒ SQLSTATE P0001 ⇒ PostgREST 400 + JSON chyba.
      json(res, 400, {
        code: 'P0001',
        details: null,
        hint: null,
        message: `Rate limit exceeded for ${klic}. Max ${String(body.p_max_requests)} requests per ${String(body.p_window_ms)} ms.`,
      });
      return;
    case 'jina_vyjimka':
      // Stejný SQLSTATE (každý RAISE bez ERRCODE je P0001), jiná zpráva — NENÍ to překročení limitu.
      json(res, 400, { code: 'P0001', details: null, hint: null, message: `neco jineho ${ZNACKA_V_TELE}` });
      return;
    case 'vypadek_5xx':
      json(res, 503, { code: 'PGRST001', details: ZNACKA_V_TELE, hint: null, message: 'Database client error' });
      return;
    case 'spojeni_spadne':
      req.socket.destroy();
      return;
  }
}

beforeAll(async () => {
  delete process.env.KC_ISSUER; // issuer odvozený z realmu fixtury, ne z prostředí stroje
  const par = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(par.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

  server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === `/realms/${REALM}/protocol/openid-connect/certs`) {
      json(res, 200, { keys: [jwk] });
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const fn = /^\/rpc\/([a-z0-9_]+)$/.exec(req.url ?? '')?.[1] ?? '';
      const text = Buffer.concat(chunks).toString('utf8');
      const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
      volani.push({ fn, authorization: req.headers.authorization, body });
      switch (fn) {
        case 'enforce_rate_limit':
          enforceRateLimit(req, res, body);
          return;
        case 'write_audit_journal':
          json(res, 200, randomUUID());
          return;
        case 'get_health_document_for_analysis_audited':
          json(res, 200, []); // dokument nenalezen → routa skončí 404 (dál není potřeba LLM)
          return;
        case 'get_wearable_sync_payload_for_analysis_audited':
          json(res, 200, null); // dávka nenalezena → 404
          return;
        default:
          json(res, 404, { code: 'PGRST202', message: `Could not find the function public.${fn}` });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // config.ts čte prostředí při importu → nastavit PŘED dynamickým importem rout.
  process.env.KEYCLOAK_URL = base;
  process.env.KEYCLOAK_REALM = REALM;
  process.env.POSTGREST_URL = base;
  // Náhodná fixtura, ne literál: brána service-security (No hardcoded secrets) by
  // dlouhý řetězec přiřazený do *TOKEN četla jako tajemství — a měla by pravdu tvarem.
  process.env.POSTGREST_SERVICE_TOKEN = randomUUID();

  token = await new SignJWT({ email: 'clen@fixtura.invalid' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(`${base}/realms/${REALM}`)
    .setSubject(UZIVATEL)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(par.privateKey);

  const { analyzeDocumentRoutes } = await import('../routes/analyze-document.js');
  const { analyzeWearableRoutes } = await import('../routes/analyze-wearable.js');
  const sber = new Writable({
    write(chunk: Buffer, _enc, done) {
      logy.push(chunk.toString('utf8'));
      done();
    },
  });
  app = Fastify({ logger: { level: 'info', stream: sber } });
  await app.register(analyzeDocumentRoutes);
  await app.register(analyzeWearableRoutes);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  volani = [];
  logy = [];
});

const dokument = () =>
  app.inject({
    method: 'POST',
    url: '/analyze-document',
    headers: { authorization: `Bearer ${token}` },
    payload: { documentId: 'dok-1' },
  });

const wearable = () =>
  app.inject({
    method: 'POST',
    url: '/analyze-wearable-sync',
    headers: { authorization: `Bearer ${token}` },
    payload: { syncBatchId: 'davka-1' },
  });

const auditRateLimited = () =>
  volani.filter(
    (v) => v.fn === 'write_audit_journal' && (v.body.p_details as { result?: string } | undefined)?.result === 'rate_limited',
  );

const fns = () => volani.map((v) => v.fn);

describe('analyze-document: stráž limitu', () => {
  it('limit nepřekročen (204) → pokračuje k dokumentu, žádný audit rate_limited', async () => {
    chovani = 'povoleno';
    const res = await dokument();
    expect(fns()).toContain('get_health_document_for_analysis_audited');
    expect(res.statusCode).toBe(404); // fixtura dokument nevrátí — důkaz, že stráž PROPUSTILA
    expect(auditRateLimited()).toHaveLength(0);
    // stráž dostala JWT uživatele, ne servisní token
    expect(volani.find((v) => v.fn === 'enforce_rate_limit')?.authorization).toBe(`Bearer ${token}`);
  });

  it('limit překročen (P0001 „Rate limit exceeded for health_document_analysis.") → 429 + audit rate_limited', async () => {
    chovani = 'prekroceno';
    const res = await dokument();
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'Rate limit exceeded' });
    expect(auditRateLimited()).toHaveLength(1);
    expect(auditRateLimited()[0]?.body.p_user_id).toBe(UZIVATEL);
    expect(fns()).not.toContain('get_health_document_for_analysis_audited');
  });

  it.each<[Chovani, string]>([
    ['jina_vyjimka', 'jiná výjimka P0001'],
    ['vypadek_5xx', 'PostgREST 503'],
    ['spojeni_spadne', 'spadlé spojení'],
  ])('%s (%s) → 503 fail-closed, BEZ auditu rate_limited, dál se nepokračuje, log bez hodnot', async (c) => {
    chovani = c;
    const res = await dokument();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'Rate limit check unavailable' });
    expect(auditRateLimited()).toHaveLength(0);
    expect(fns()).toEqual(['enforce_rate_limit']);
    const log = logy.join('');
    expect(log).toContain('rate_limit_check_failed');
    expect(log).not.toContain(ZNACKA_V_TELE);
    expect(log).not.toContain(token);
  });
});

describe('analyze-wearable-sync: stráž limitu', () => {
  it('limit nepřekročen (204) → pokračuje k dávce', async () => {
    chovani = 'povoleno';
    const res = await wearable();
    expect(fns()).toEqual(['enforce_rate_limit', 'get_wearable_sync_payload_for_analysis_audited']);
    expect(res.statusCode).toBe(404);
  });

  it('limit překročen (P0001 „Rate limit exceeded for wearable_sync_analysis.") → 429', async () => {
    chovani = 'prekroceno';
    const res = await wearable();
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'Rate limit exceeded' });
    expect(fns()).toEqual(['enforce_rate_limit']);
  });

  it.each<[Chovani, string]>([
    ['jina_vyjimka', 'jiná výjimka P0001'],
    ['vypadek_5xx', 'PostgREST 503'],
    ['spojeni_spadne', 'spadlé spojení'],
  ])('%s (%s) → 503 fail-closed, dál se nepokračuje, log bez hodnot', async (c) => {
    chovani = c;
    const res = await wearable();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'Rate limit check unavailable' });
    expect(fns()).toEqual(['enforce_rate_limit']);
    const log = logy.join('');
    expect(log).toContain('rate_limit_check_failed');
    expect(log).not.toContain(ZNACKA_V_TELE);
  });
});

describe('isRateLimitExceeded: hranice klasifikátoru', () => {
  const zprava = (klic: string) =>
    JSON.stringify({ code: 'P0001', details: null, hint: null, message: `Rate limit exceeded for ${klic}. Max 5 requests per 3600000 ms.` });

  it('P0001 + zpráva s TÍMTÉŽ klíčem → true', async () => {
    const { isRateLimitExceeded } = await import('../rate-limit.js');
    const { PostgRESTError } = await import('@aisha/postgrest-client');
    expect(isRateLimitExceeded(new PostgRESTError('x', 400, zprava('health_document_analysis')), 'health_document_analysis')).toBe(true);
  });

  it('jiný klíč (i s týmž prefixem), jiný SQLSTATE, ne-JSON tělo, cizí chyba → false', async () => {
    const { isRateLimitExceeded } = await import('../rate-limit.js');
    const { PostgRESTError } = await import('@aisha/postgrest-client');
    const klic = 'health_document_analysis';
    expect(isRateLimitExceeded(new PostgRESTError('x', 400, zprava('wearable_sync_analysis')), klic)).toBe(false);
    expect(isRateLimitExceeded(new PostgRESTError('x', 400, zprava(`${klic}_jiny`)), klic)).toBe(false);
    expect(isRateLimitExceeded(new PostgRESTError('x', 400, zprava(klic).replace('P0001', 'P0429')), klic)).toBe(false);
    expect(isRateLimitExceeded(new PostgRESTError('x', 502, '<html>Bad Gateway</html>'), klic)).toBe(false);
    expect(isRateLimitExceeded(new SyntaxError('Unexpected end of JSON input'), klic)).toBe(false);
    expect(isRateLimitExceeded(undefined, klic)).toBe(false);
  });
});
