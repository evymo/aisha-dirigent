/**
 * svc-lane-klient — tenký klient společné lane v projektu forku na GPU uzlu
 * (služba `svc-model` tenkého stacku, ve jmenném prostoru agenta modelového meshe).
 *
 * Dělá tři věci a nic víc:
 *   1. přijme jen peery modelového meshe (prijem.ts); jiné spojení zavře bez odpovědi;
 *   2. preflight `GET /__vb/zije` na JEDINÝ upstream (vynucovací bod) s celkovou mezí
 *      1 s. Odmítnuté spojení, černá díra po přijetí nebo cokoli jiného než 204 =
 *      LANE_NEDOSTUPNA hned, ne až timeoutem dispatch (R5a, MJ22);
 *   3. přepošle požadavek beze změny a odpověď vynucovacího bodu vrátí beze změny,
 *      včetně jeho kódů (`x-aisha-odmitl: vstup`) a hlaviček identity (R5c řeší fork);
 *      přidají se jen bezpečnostní hlavičky odpovědi (helmet, A05), tělo ani hlavičky
 *      protokolu nemění.
 *
 * Klíč: `Authorization` z dispatch jen propustí. Klient žádný klíč nemá, nepřidá ho,
 * neodebere ani nezaloguje (K1, podmínka Aishy 6).
 * Žádný druhý upstream, žádné opakování, žádný návrat na CPU, cloud ani starou adresu
 * (MN6, MJ13). Vlastní kód klienta je jediný: LANE_NEDOSTUPNA s `x-aisha-odmitl: klient`.
 */
import type { Readable } from 'node:stream';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Pool } from 'undici';
import { buildHelmetOptions, safeLoggerOptions } from '@aisha/security';
import { HLAVICKY, TRIDY, odmitnuti, type Trida } from '@aisha/accel-protokol';

/** Preflight celkem (spojení + odpověď) — R5a: spojení se vstupem nejvýš 1 s. */
export const LIMIT_PREFLIGHT_MS = 1000;
/** Navázání spojení pro přeposlání (obvykle se znovu použije spojení z preflightu). */
export const LIMIT_SPOJENI_MS = 1000;
/**
 * Mez odpovědi přeposlaného požadavku podle třídy. Stavy lane (startuje, nedostupná)
 * vynucovací bod rozhoduje z paměti v milisekundách; tahle mez kryje jen zaseknutý vstup
 * nebo engine uprostřed práce. Chybějící nebo neznámá třída dostane kratší mez dotazu
 * (vstup ji stejně odmítne jako POZADAVEK_NEPLATNY).
 */
export const LIMIT_ODPOVEDI_MS: Readonly<Record<Trida, number>> = Object.freeze({ dotaz: 60_000, davka: 600_000 });

/** Hlavičky jednoho skoku — nepropouštějí se ani tam, ani zpět. */
const JEDEN_SKOK = new Set(['host', 'connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'expect']);

type Hlavicky = Record<string, string | string[] | undefined>;

/** Hlavičky ke propuštění: vše kromě hlaviček jednoho skoku (a těch, které jmenuje `connection`). Nic nepřidává. */
export function propustHlavicky(h: Hlavicky): Record<string, string | string[]> {
  const jmenovane = String(h.connection ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const ven: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(h)) {
    const kl = k.toLowerCase();
    if (v === undefined || JEDEN_SKOK.has(kl) || jmenovane.includes(kl)) continue;
    ven[kl] = v;
  }
  return ven;
}

export interface Zavislosti {
  /** Jediný počátek vynucovacího bodu, ověřený `overUpstream`. */
  upstream: string;
  /** Smí spojení dál? V provozu měří rozhraní meshe (prijem.ts). Výchozí není — nic se neotevře omylem. */
  prijmout: (spojeni: { lokalni?: string; vzdalena?: string }) => boolean;
  /** Strukturovaný záznam — bez těl, bez klíčů, bez hlaviček požadavku. */
  zaznam?: (udalost: string, data: Record<string, unknown>) => void;
  /** Přepis mezí odpovědi (testy). */
  limity?: Partial<Record<Trida, number>>;
  ted?: () => number;
}

const jeTrida = (x: unknown): x is Trida => typeof x === 'string' && (TRIDY as readonly string[]).includes(x);

function pricina(err: unknown): string {
  const e = err as { name?: string; code?: string; cause?: { code?: string } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'cas';
  return String(e?.code ?? e?.cause?.code ?? 'spojeni').toLowerCase();
}

export function vytvorKlient(z: Zavislosti): FastifyInstance {
  // Logger z továrny (redakce Authorization i objektů volání); jen varování a chyby —
  // průchozí požadavky se nelogují, záznam lane jde přes `zaznam` bez těl a hlaviček.
  const app = Fastify({ logger: safeLoggerOptions({ level: 'warn' }) });
  // Bezpečnostní hlavičky ODPOVĚDI (A05). Tělo ani hlavičky protokolu (x-aisha-*) nemění;
  // hlavičky vynucovacího bodu se nastaví až po nich (propustHlavicky), takže vyhrávají.
  void app.register(helmet, buildHelmetOptions());
  const zaznam = z.zaznam ?? (() => {});
  const ted = z.ted ?? Date.now;
  const limity: Record<Trida, number> = { ...LIMIT_ODPOVEDI_MS, ...z.limity };
  // Pool = jediný počátek. Ani absolutní cíl požadavku nezpůsobí spojení jinam.
  const pool = new Pool(z.upstream, { connect: { timeout: LIMIT_SPOJENI_MS } });
  app.addHook('onClose', async () => {
    await pool.close();
  });

  app.server.on('connection', (s) => {
    if (z.prijmout({ lokalni: s.localAddress, vzdalena: s.remoteAddress })) return;
    zaznam('spojeni_odmitnuto', { vzdalena: s.remoteAddress ?? null });
    s.destroy();
  });

  const nedostupna = (reply: FastifyReply, error: string, proc: string, start: number) => {
    const { status, telo } = odmitnuti('LANE_NEDOSTUPNA', error);
    zaznam('odmitnuti', { duvod: 'LANE_NEDOSTUPNA', pricina: proc, ms: Math.round(ted() - start) });
    return reply.code(status).header(HLAVICKY.ODMITL, 'klient').send(telo);
  };

  async function preflight(): Promise<'OK' | string> {
    try {
      const r = await pool.request({ path: '/__vb/zije', method: 'GET', signal: AbortSignal.timeout(LIMIT_PREFLIGHT_MS) });
      await r.body.dump();
      return r.statusCode === 204 ? 'OK' : `preflight_${r.statusCode}`;
    } catch (err) {
      return pricina(err);
    }
  }

  async function preposli(req: FastifyRequest, reply: FastifyReply) {
    const start = ted();
    const pf = await preflight();
    if (pf !== 'OK') return nedostupna(reply, 'vstup do lane není dosažitelný', pf, start);

    const t = req.headers[HLAVICKY.TRIDA];
    const limit = limity[jeTrida(t) ? t : 'dotaz'];
    // Odchod dispatch = přerušit i vstup, aby účtoval skutečnou dobu (Q5).
    const ac = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) ac.abort();
    });
    try {
      const r = await pool.request({
        path: req.url,
        method: req.method as 'GET',
        headers: propustHlavicky(req.headers),
        body: req.body as Readable | undefined,
        signal: ac.signal,
        headersTimeout: limit,
        bodyTimeout: limit,
      });
      return reply
        .code(r.statusCode)
        .headers(propustHlavicky(r.headers))
        .send(r.body);
    } catch (err) {
      if (ac.signal.aborted) return reply.hijack(); // dispatch odešel; není komu odpovědět
      return nedostupna(reply, 'vstup do lane neodpověděl', pricina(err), start);
    }
  }

  // Tělo se nečte ani neověřuje: tvar posuzuje vynucovací bod. Klient jen propustí proud.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload));
  app.route({ method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], url: '/*', handler: preposli });
  app.setNotFoundHandler(preposli);
  // Chyba klienta samotného = funkce stojí, ne „500 s textem“ mimo slovník.
  app.setErrorHandler((err, _req, reply) => nedostupna(reply, 'tenký klient selhal', pricina(err), ted()));
  return app;
}
