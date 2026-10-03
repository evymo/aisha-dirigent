/**
 * Průkaz TABLETU v kiosku: ohlášení bez člověka, stav a roster pro dveře.
 *
 * ⭐ ROZHODNUTÍ MAJITELE (2026-09-28):
 *   · „po kliknutí na zavedení zařízení se klíč odešle na backend, protože je
 *     odemčeno, a následně to zařízení můžeme permanentně v administraci
 *     schválit, aby si tablet mohl ťukat sám bez zadávání kódu";
 *   · „to zařízení samozřejmě musí umět samo klepat, když je schválené".
 *
 * Trasy:
 *   POST /auth/v1/device/enrol  — tablet ohlásí svůj klíč (průkaz vznikne ČEKAJÍCÍ),
 *   GET  /auth/v1/device/stav   — tablet se ptá, jestli už je schválený,
 *   POST /auth/v1/device/session — SCHVÁLENÝ tablet si podpisem vezme krátkou relaci svého
 *                                účtu (F2-B: vstup do aplikace bez přihlášení),
 *   GET  /internal/knock/roster(/version) — klíče schválených zařízení pro dveře.
 *
 * ⛔ OHLÁŠENÍ JEN ZA DVEŘMI A JEN S DŮKAZEM KLÍČE. Adresa požadavku musí být právě
 *    otevřená zaťukáním (svc-knock `/dvere` = 204, tatáž chůze přes proxy jako
 *    u verdiktu) a požadavek podepsaný klíčem, který se ohlašuje (AISHA-REQ1).
 *    Ohlášení nic neschvaluje, nic nevydá a dveře neprodlouží.
 * ⛔ ROSTER JEN S VLASTNÍM TOKENEM DVEŘÍ (`KNOCK_ROSTER_TOKEN`), ne se sdíleným
 *    INTERNAL_API_KEY — přístupy mezi službami se nezaměňují. Nese jen VEŘEJNÉ
 *    klíče (knock_roster_zarizeni); kódy techniků zůstávají v prostředí dveří.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import {
  parseDeviceRequestHeaders,
  verifyDeviceRequest,
  type DeviceRequestVerdict,
} from '@aisha/knock-protocol';
import { nodeCrypto } from '@aisha/knock-protocol/node';
import { config } from '../config.js';
import { vydejTokenZarizeni, vytvorStropRelaci } from '../auth/relace-zarizeni.js';
import { guardedFetch } from '../lib/guarded-fetch.js';

/** Komu je podepsaný požadavek určený — týž řetězec podepisuje appka. */
export const DEVICE_AUDIENCE = 'aisha-gateway';
/** Okno pro čas v podpisu (s). Tablet po LTE může mít hodiny mírně vedle. */
const OKNO_S = 300;
const MAX_TELO = 2048;
/** Strop relací na průkaz: appka si relaci obnovuje ~1× za 15 min; víc = smyčka nebo zneužití. */
export const STROP_RELACI = 10;
const OKNO_STROPU_MS = 10 * 60_000;

async function rpcSluzba<T>(fn: string, params: Record<string, unknown>): Promise<T | null> {
  const resp = await guardedFetch(`${config.postgrestUrl}/rpc/${fn}`, {
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.POSTGREST_SERVICE_TOKEN ?? ''}` },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  return (await resp.json()) as T;
}

/**
 * Jednorázovost podpisu (nonce) — v paměti procesu, s vypršením po dvojnásobku
 * okna. Opakovaný požadavek v okně se odmítne jako `replay`.
 */
export function vytvorNonceCache(oknoS: number, ted: () => number = () => Date.now()) {
  const videne = new Map<string, number>();
  return (kid: string, nonceHex: string): boolean => {
    const t = ted();
    for (const [k, platnost] of videne) if (platnost < t) videne.delete(k);
    const klic = `${kid}:${nonceHex}`;
    if (videne.has(klic)) return false;
    videne.set(klic, t + oknoS * 2000);
    return true;
  };
}

/** Je adresa požadavku právě otevřená zaťukáním? Stejná chůze přes proxy jako u verdiktu. */
export async function dvereOtevrene(knockUrl: string, xff: string | undefined): Promise<boolean> {
  if (!knockUrl || !xff) return false;
  try {
    const r = await guardedFetch(`${knockUrl.replace(/\/+$/, '')}/dvere`, {
      headers: { 'x-forwarded-for': xff },
      signal: AbortSignal.timeout(5_000),
    });
    return r.status === 204;
  } catch {
    // Nedostupné dveře = zavřeno (fail-closed); důvod nese odpověď 403 níž.
    return false;
  }
}

export function stejnyToken(ocekavany: string, dodany: string | undefined): boolean {
  if (!ocekavany || !dodany) return false;
  const a = Buffer.from(ocekavany);
  const b = Buffer.from(dodany);
  return a.length === b.length && timingSafeEqual(a, b);
}

function overPodpis(
  req: FastifyRequest,
  telo: Uint8Array,
  publicKeyHex: string | null,
  claimNonce: (kid: string, nonce: string) => boolean,
): DeviceRequestVerdict {
  const parsed = parseDeviceRequestHeaders(req.headers as Record<string, string | string[] | undefined>);
  return verifyDeviceRequest(
    { audience: DEVICE_AUDIENCE, method: req.method, target: req.url, body: telo },
    parsed,
    publicKeyHex,
    { audience: DEVICE_AUDIENCE, crypto: nodeCrypto, now: Math.floor(Date.now() / 1000), windowSec: OKNO_S, claimNonce },
  );
}

interface TeloOhlaseni {
  kid: string;
  publicKeyHex: string;
  scope: string;
  verze?: Record<string, string>;
}

function prectiTelo(syrove: Buffer): TeloOhlaseni | null {
  try {
    const j = JSON.parse(syrove.toString('utf8')) as Record<string, unknown>;
    if (typeof j.kid !== 'string' || typeof j.publicKeyHex !== 'string' || typeof j.scope !== 'string') return null;
    if (j.verze !== undefined && (typeof j.verze !== 'object' || j.verze === null || Array.isArray(j.verze))) return null;
    return { kid: j.kid, publicKeyHex: j.publicKeyHex.toLowerCase(), scope: j.scope, verze: j.verze as Record<string, string> | undefined };
  } catch {
    return null;
  }
}

export const zarizeniKlicRoutes: FastifyPluginAsync<{ dvere?: typeof dvereOtevrene }> = async (app: FastifyInstance, opts) => {
  const claimNonce = vytvorNonceCache(OKNO_S);
  const zbyvaRelace = vytvorStropRelaci(STROP_RELACI, OKNO_STROPU_MS);
  const jsouDvereOtevrene = opts.dvere ?? dvereOtevrene;

  // Podpis kryje tělo přesně v bajtech, jak odešlo — JSON se čte až po ověření.
  // Vestavěný parser JSON se v TOMHLE pluginu odebere (zapouzdření Fastify) a nahradí
  // parserem, který tělo nechá jako bajty.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: MAX_TELO }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/device/enrol', async (req: FastifyRequest, reply: FastifyReply) => {
    const xff = req.headers['x-forwarded-for'] as string | undefined;
    if (!(await jsouDvereOtevrene(config.knockUrl, xff))) {
      return reply.status(403).send({ error: 'dvere_zavrene', detail: 'ohlásit se jde jen ze sítě, kterou právě otevřelo zaťukání' });
    }
    const syrove = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const telo = prectiTelo(syrove);
    if (!telo) return reply.status(400).send({ error: 'vadne_telo' });
    // Důkaz, že odesílatel klíč DRŽÍ: podpis ověřený klíčem z těla (a `kid` z něj odvozený).
    const verdikt = overPodpis(req, new Uint8Array(syrove), telo.publicKeyHex, claimNonce);
    if (!verdikt.ok) return reply.status(401).send({ error: 'podpis', duvod: verdikt.reason });
    if (verdikt.kid !== telo.kid) return reply.status(400).send({ error: 'kid_nesedi' });
    const vysledek = await rpcSluzba<{ ok: boolean; stav?: string; error?: string }>('enrol_kiosk_device', {
      p_kid: telo.kid,
      p_public_key_hex: telo.publicKeyHex,
      p_scope: telo.scope,
      p_ip: req.ip,
      p_verze: telo.verze ?? null,
    });
    if (!vysledek) return reply.status(502).send({ error: 'databaze_nedostupna' });
    if (!vysledek.ok) return reply.status(422).send({ error: vysledek.error });
    return reply.send({ kid: telo.kid, stav: vysledek.stav });
  });

  app.get('/device/stav', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseDeviceRequestHeaders(req.headers as Record<string, string | string[] | undefined>);
    if (!parsed) return reply.status(401).send({ error: 'podpis', duvod: 'malformed' });
    const stav = await rpcSluzba<{ ok: boolean; stav?: string; public_key_hex?: string }>('kiosk_device_stav', { p_kid: parsed.kid });
    if (!stav) return reply.status(502).send({ error: 'databaze_nedostupna' });
    if (!stav.ok || !stav.public_key_hex) return reply.status(404).send({ error: 'nezname' });
    // Podpis klíčem z průkazu (i čekajícího): stav se nedozví nikdo, kdo klíč nedrží.
    const verdikt = overPodpis(req, new Uint8Array(0), stav.public_key_hex, claimNonce);
    if (!verdikt.ok) return reply.status(401).send({ error: 'podpis', duvod: verdikt.reason });
    return reply.send({ kid: parsed.kid, stav: stav.stav });
  });

  // ── F2-B: relace tabletu — vstup do aplikace BEZ přihlášení ──────────────────
  // Majitel 2026-09-29: „po validaci … jeho podpis resp. klepání odemyká … a následně je
  // možnost se dostat do aplikace bez přihlášení pouze k našim dodákům“.
  // Pořadí je bezpečnostní: dveře → veřejný klíč z průkazu (čtení) → PODPIS → teprve pak
  // zápis (audit vydání) a token. Kdo klíč nedrží, do DB nic nezapíše a nic nedostane.
  app.post('/device/session', async (req: FastifyRequest, reply: FastifyReply) => {
    const xff = req.headers['x-forwarded-for'] as string | undefined;
    if (!(await jsouDvereOtevrene(config.knockUrl, xff))) {
      return reply.status(403).send({ error: 'dvere_zavrene', detail: 'relaci si tablet bere jen ze sítě, kterou právě otevřelo zaťukání' });
    }
    const parsed = parseDeviceRequestHeaders(req.headers as Record<string, string | string[] | undefined>);
    if (!parsed) return reply.status(401).send({ error: 'podpis', duvod: 'malformed' });
    const stav = await rpcSluzba<{ ok: boolean; stav?: string; public_key_hex?: string }>('kiosk_device_stav', { p_kid: parsed.kid });
    if (!stav) return reply.status(502).send({ error: 'databaze_nedostupna' });
    if (!stav.ok || !stav.public_key_hex) return reply.status(404).send({ error: 'nezname' });
    const syrove = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const verdikt = overPodpis(req, new Uint8Array(syrove), stav.public_key_hex, claimNonce);
    if (!verdikt.ok) return reply.status(401).send({ error: 'podpis', duvod: verdikt.reason });
    if (!zbyvaRelace(verdikt.kid)) return reply.status(429).send({ error: 'prilis_casto' });

    const vydani = await rpcSluzba<{ ok: boolean; duvod?: string; ucet_id?: string; plati_do?: string | null }>(
      'kiosk_vydej_relaci', { p_kid: verdikt.kid });
    if (!vydani) return reply.status(502).send({ error: 'databaze_nedostupna' });
    // Čekající, odvolaný i vypršelý průkaz = 403 HNED (žádná relace „na zkoušku“).
    if (!vydani.ok || !vydani.ucet_id) return reply.status(403).send({ error: 'neschvaleno', duvod: vydani.duvod ?? 'neplatne' });

    let relace: { token: string; exp: number };
    try {
      relace = await vydejTokenZarizeni({ kid: verdikt.kid, platiDo: vydani.plati_do ?? null, ucetId: vydani.ucet_id }, config.postgrestJwtSecret);
    } catch (e) {
      if (e instanceof Error && e.message === 'missing_postgrest_jwt_secret') return reply.status(503).send({ error: 'relace_nenastavena' });
      return reply.status(403).send({ error: 'neschvaleno', duvod: 'vyprselo' });
    }
    return reply.header('Cache-Control', 'no-store').send({
      access_token: relace.token,
      expires_at: relace.exp,
      expires_in: relace.exp - Math.floor(Date.now() / 1000),
      kid: verdikt.kid,
      token_type: 'bearer',
      user: { id: vydani.ucet_id },
    });
  });
};

/** Roster zařízení pro dveře (svc-knock `SPA_OPERATORS_URL` / `SPA_OPERATORS_VERSION_URL`). */
export const knockRosterRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const token = process.env.KNOCK_ROSTER_TOKEN ?? '';

  const nacti = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!token) {
      reply.status(503).send({ error: 'roster_nenastaven' });
      return null;
    }
    if (!stejnyToken(token, req.headers['x-token'] as string | undefined)) {
      reply.status(401).send({ error: 'unauthorized' });
      return null;
    }
    const r = await rpcSluzba<{ operators: Record<string, unknown>; version: string; count: number }>('knock_roster_zarizeni', {});
    if (!r) {
      reply.status(502).send({ error: 'databaze_nedostupna' });
      return null;
    }
    return r;
  };

  app.get('/knock/roster', async (req, reply) => {
    const r = await nacti(req, reply);
    if (r) return reply.header('Cache-Control', 'no-store').send(r.operators);
    return reply;
  });

  app.get('/knock/roster/version', async (req, reply) => {
    const r = await nacti(req, reply);
    if (r) return reply.header('Cache-Control', 'no-store').send({ version: r.version, count: r.count });
    return reply;
  });
};
