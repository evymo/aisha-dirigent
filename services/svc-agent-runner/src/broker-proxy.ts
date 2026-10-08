import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { safeLoggerOptions } from '@aisha/security';
import { config } from './config.js';
import { adresyRunneruMimoExecSit, pripojKExecSiti } from './backends/docker-http.js';
import { cilConnect, defaultResolveTarget, type EgressTarget, type ResolveTarget } from './egress-policy.js';

// ── Broker-proxy: jediná cesta sandboxu k brokeru ───────────────────────────
//
// ⭐ Rozhodnutí majitele 2026-10-01 (varianta C). Naměřeno na instanci: z exec sítě se
// `PLUGIN_BROKER_URL` (jméno v meshi) vůbec nepřeloží — sandbox v meshi není,
// obraz plugin-exec nemá klienta NetBird a per-run klíč NetBird padal na
// „fetch failed“. Každý běh pluginu s konektorem proto končil exit 255 a nikdo nevěděl proč.
//
// Runner v meshi JE (DNS mesh-routeru + trasa NETBIRD_PEER_CIDR). Vystaví proto na
// exec síti JEN tuhle proxy a přepošle přes mesh. Sandbox nevidí nic jiného:
//   - jen `/sandbox/*` (shim pluginu volá `${BROKER_URL}/sandbox/<endpoint>`),
//   - jen s tokenem běhu, který PRÁVĚ běží (runner ho sám vydal),
//   - jen požadavek, který přišel z exec sítě,
//   - ven jde jen `authorization` a `content-type` — žádné cizí hlavičky.
// Mesh tak zůstává jedinou cestou mezi službami; broker dál ověřuje token sám.
//
// ⛔ 2026-10-06 (majitel „síť zavřít“ = volba A; rada cb K2, T10-A): exec síť je teď
// `Internal: true` (docker-http.ts ensureExecNetwork) — bez výchozí trasy, takže tahle
// proxy je JEDINÁ cesta z běhu ven. Proto:
//   - je POVINNÁ (žádná „vypnutá proxy → běh dostane broker přímo“: z uzavřené sítě by
//     přímá adresa stejně nevedla nikam a selhání by bylo tiché),
//   - nese i výstup claude_cli_task: `CONNECT host:port` jen s tokenem běžícího běhu
//     (Proxy-Authorization), jen na hostitele z výčtu, který runner TOMU běhu povolil
//     z konfigurace (egress-policy.ts), a jen na veřejnou adresu (ochrana SSRF).
//     Běh pluginu výčet nemá → jeho CONNECT neprojde nikam.

const SANDBOX = '/sandbox/';
/** Payload běhu vydává runner SÁM (neposílá se brokeru) — viz payloadDoEnv. */
const PAYLOAD_BEHU = '/beh/payload';

/**
 * Payload do ENV kontejneru jen do téhle velikosti; větší si běh vyzvedne na
 * PAYLOAD_BEHU. Jádro Linuxu dovolí jednomu řetězci argv/env nejvýš MAX_ARG_STRLEN
 * (128 KiB včetně `PLUGIN_PAYLOAD=`) — polovina nechává rezervu.
 */
export const PAYLOAD_ENV_STROP = 64 * 1024;

interface ZaznamBehu {
  /** Payload, který se nevešel do ENV (vydá ho `/beh/payload`). */
  payloadMimoEnv: string | undefined;
  /** Kam smí běh přes CONNECT (prázdné = nikam; běh pluginu smí jen na broker). */
  egress: EgressTarget[];
  /** Id běhu pro log výstupu (známé, jakmile běh výstup dostal). */
  runId?: string;
}

/** Běhy, které právě běží: token → payload mimo ENV + povolený výstup. */
const aktivni = new Map<string, ZaznamBehu>();

export function registrujBeh(token: string, payloadMimoEnv?: string): void {
  aktivni.set(token, { payloadMimoEnv, egress: [] });
}

export function odregistrujBeh(token: string): void {
  aktivni.delete(token);
}

/**
 * Povolí běžícímu běhu výstup na hostitele z výčtu (claude_cli_task). Neregistrovaný
 * token nebo prázdný výčet = výjimka: proxy, která nic nepustí, by byla skrytá porucha
 * a výčet pro token, který neběží, by nikdo neodebral.
 */
export function povolVystupBehu(token: string, cile: EgressTarget[], runId?: string): void {
  const zaznam = aktivni.get(token);
  if (!zaznam) throw new Error('broker-proxy: výstup pro běh, který neběží (token není registrovaný)');
  if (cile.length === 0) throw new Error('broker-proxy: prázdný výčet cílů — výstup se nepovolí');
  zaznam.egress = cile.map((c) => ({ ...c }));
  if (runId) zaznam.runId = runId;
}

/** URL proxy pro `HTTPS_PROXY` běhu — token běhu jako heslo (Proxy-Authorization: Basic). */
export function proxyUrlProBeh(token: string): string {
  return `http://run:${encodeURIComponent(token)}@${config.brokerProxyAlias}:${config.brokerProxyPort}`;
}

/**
 * URL proxy pro klon, který za běh dělá RUNNER (claude_cli_task) — TOUŽ cestou jako běh sám.
 *
 * ⛔ 2026-10-07 (F3, runner na serveru): klon per běh šel z runneru rovnou na forge, mimo
 * výčet i ochranu SSRF, kterými prochází každé spojení běhu. Teď jde přes CONNECT této proxy
 * s tokenem běhu na adresu runneru v síti běhů (jinde proxy CONNECT nepřijme): forge musí být
 * ve výčtu TOHO běhu, na veřejné adrese, spojení na ověřenou IP a v logu s run_id — jedno
 * rozhodnutí pro klon, líné dotahování i push. Bez změřené adresy (zajistiCestuKBrokeru
 * neprošlo) výjimka — klon se nespustí, žádná přímá cesta „zatím“.
 */
export function proxyUrlProKlonRunneru(token: string): string {
  if (!execAdresaRunneru) throw new Error('broker-proxy: adresa runneru v síti běhů není změřená — klon běhu se nespustí');
  return `http://run:${encodeURIComponent(token)}@${execAdresaRunneru}:${config.brokerProxyPort}`;
}

/**
 * ENV s payloadem pro kontejner běhu.
 *
 * ⛔ NAMĚŘENO 2026-10-01 na instanci (první běh po broker-proxy): `exec /usr/bin/dumb-init:
 * argument list too long` — kód jednoho pluginu má 155 KB a celý jel v PLUGIN_PAYLOAD.
 * Kontejner se vůbec nespustil (exit 255); dřív to zakrývala nedosažitelnost brokeru.
 * Větší payload proto do ENV nejde: runner ho podrží a běh si ho vyzvedne přes proxy.
 * Bez proxy ho doručit neumíme — chyba nahlas, ne useknutý payload.
 */
export function payloadDoEnv(payloadJson: string): { env: string[]; mimoEnv: string | undefined } {
  if (Buffer.byteLength(payloadJson, 'utf8') <= PAYLOAD_ENV_STROP) {
    return { env: ['PLUGIN_PAYLOAD=' + payloadJson], mimoEnv: undefined };
  }
  return { env: [], mimoEnv: payloadJson };
}

/** Kam běh volá broker: VŽDY přes proxy na exec síti (proxy je povinná, viz výš). */
export function brokerUrlProBeh(): string {
  return `http://${config.brokerProxyAlias}:${config.brokerProxyPort}`;
}

/** Adresa runneru v exec síti (po posledním úspěšném připojení), jinak null. */
let execAdresaRunneru: string | null = null;
/** Adresy runneru MIMO síť běhů (kde smí API runneru); null = ještě nezměřeno. */
let adresyApi: ReadonlySet<string> | null = null;

export function adresaVExecSiti(): string | null {
  return execAdresaRunneru;
}

/**
 * Změří síť běhů (uzavřená, jinak chyba), připojení runneru pod aliasem proxy a adresy
 * runneru v ostatních sítích — před KAŽDÝM během, ne jednou za život procesu.
 * Vrací `BROKER_URL` pro běh.
 */
export async function zajistiCestuKBrokeru(): Promise<string> {
  const exec = await pripojKExecSiti(config.brokerProxyAlias);
  const ostatni = await adresyRunneruMimoExecSit();
  execAdresaRunneru = exec;
  adresyApi = new Set(ostatni.map(mistniAdresa).filter((a) => a !== exec));
  return brokerUrlProBeh();
}

/** Místní adresy uvnitř kontejneru (healthcheck sonduje 127.0.0.1). */
const SMYCKA = new Set(['127.0.0.1', '::1']);

/**
 * Smí API runneru obsloužit spojení, které přišlo na tuto MÍSTNÍ adresu?
 *
 * ⛔ 2026-10-07 (revize D6): výčet, ne zákaz. Dřív API odmítalo jen ZNÁMOU adresu
 * v síti běhů a do jejího zjištění pouštělo vše (osiřelý běh na API dosáhl). Teď:
 *   - smyčka (healthcheck) vždy,
 *   - jinak JEN adresy runneru v sítích MIMO síť běhů, změřené přes Docker,
 *   - dokud změřené nejsou (start, výpadek Dockeru) → nic mimo smyčku ('nezmereno').
 * Adresa, která přibude později (náhrada sítě běhů), ve výčtu není → odmítnuta.
 */
export function pristupKApi(localAddress: string | undefined): 'ano' | 'mimo' | 'nezmereno' {
  const a = mistniAdresa(localAddress);
  if (SMYCKA.has(a)) return 'ano';
  if (adresyApi === null) return 'nezmereno';
  return adresyApi.has(a) && a !== execAdresaRunneru ? 'ano' : 'mimo';
}

/** Adresa, na kterou požadavek DORAZIL (IPv4 v IPv6 zápisu se srovná). */
export function mistniAdresa(localAddress: string | undefined): string {
  return (localAddress ?? '').replace(/^::ffff:/, '');
}

/**
 * Cesta, kterou smí proxy předat, nebo null.
 *
 * Rozhoduje NORMALIZOVANÁ cesta — ta, kterou by uviděl broker. `/sandbox/../runs`
 * i `/sandbox/%2e%2e/runs` se normalizují na `/runs`, a ta neprojde.
 */
export function cestaProSandbox(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl, 'http://proxy.invalid');
  } catch {
    return null;
  }
  if (!u.pathname.startsWith(SANDBOX)) return null;
  let dekodovana: string;
  try {
    dekodovana = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  if (dekodovana.includes('..')) return null;
  return u.pathname + u.search;
}

/** Přesně `/beh/payload` po normalizaci (žádný dotaz, žádné obcházení přes `..`). */
export function jeCestaPayloadu(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl, 'http://proxy.invalid');
    return u.pathname === PAYLOAD_BEHU && u.search === '';
  } catch {
    return false;
  }
}

interface OdpovedBrokeru {
  status: number;
  contentType?: string;
  body: Buffer;
}

function preposli(method: string, cesta: string, autorizace: string, contentType: string | undefined, body: Buffer | undefined): Promise<OdpovedBrokeru> {
  const cil = new URL(cesta, config.pluginBrokerUrl);
  const klient = cil.protocol === 'https:' ? https : http;
  const telo = body && body.length > 0 ? body : undefined;
  return new Promise((resolve, reject) => {
    const req = klient.request(
      cil,
      {
        method,
        headers: {
          authorization: autorizace,
          ...(contentType ? { 'content-type': contentType } : {}),
          ...(telo ? { 'content-length': telo.length } : {}),
        },
        // node:http, ne globální fetch: undici má vlastní headersTimeout 300 s,
        // který strop běhu tiše přebije (naměřeno 2026-09-30 v gateway, #458).
        timeout: config.maxTimeoutMs,
      },
      (res) => {
        const kusy: Buffer[] = [];
        res.on('data', (c: Buffer) => { kusy.push(c); });
        res.on('end', () => {
          const ct = res.headers['content-type'];
          resolve({ status: res.statusCode ?? 502, contentType: typeof ct === 'string' ? ct : undefined, body: Buffer.concat(kusy) });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`broker neodpověděl do ${config.maxTimeoutMs} ms`)));
    req.on('error', reject);
    req.end(telo);
  });
}

/** Token běhu z `Proxy-Authorization: Basic base64(<cokoli>:<token>)`, jinak ''. */
export function tokenZProxyAutorizace(hlavicka: string | string[] | undefined): string {
  const h = Array.isArray(hlavicka) ? hlavicka[0] : hlavicka;
  const m = (h ?? '').match(/^Basic\s+([A-Za-z0-9+/=]+)$/);
  if (!m) return '';
  const text = Buffer.from(m[1]!, 'base64').toString('utf8');
  const i = text.indexOf(':');
  if (i < 0) return '';
  try {
    return decodeURIComponent(text.slice(i + 1));
  } catch {
    return '';
  }
}

/** Nečinnost tunelu, po které se spojení zavře (dlouhé streamy modelu se vejdou). */
const NECINNOST_TUNELU_MS = 10 * 60_000;

/**
 * `CONNECT host:port` — výstup běhu claude_cli_task. Odpověď jde rovnou do soketu
 * (Fastify CONNECT neobsluhuje); každé odmítnutí se loguje s důvodem.
 */
async function obsluzConnect(
  req: http.IncomingMessage,
  klient: net.Socket,
  head: Buffer,
  execAdresa: () => string | null,
  resolveTarget: ResolveTarget,
  log: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void },
): Promise<void> {
  klient.on('error', () => klient.destroy());
  const odmitni = (status: number, text: string, duvod: string, kontext: Record<string, unknown>, extra = ''): void => {
    log.warn({ ...kontext, status, duvod }, 'broker-proxy: výstup odmítnut');
    klient.end(`HTTP/1.1 ${status} ${text}\r\n${extra}Content-Length: 0\r\nConnection: close\r\n\r\n`);
  };
  const ip = execAdresa();
  if (!ip || mistniAdresa(klient.localAddress) !== ip) {
    return odmitni(404, 'Not Found', 'CONNECT mimo exec síť', {});
  }
  const token = tokenZProxyAutorizace(req.headers['proxy-authorization']);
  const zaznam = token ? aktivni.get(token) : undefined;
  if (!zaznam) {
    return odmitni(407, 'Proxy Authentication Required', 'výstup jen s tokenem běžícího běhu', {}, 'Proxy-Authenticate: Basic realm="aisha-run"\r\n');
  }
  const cil = cilConnect(req.url ?? '');
  if (!cil) return odmitni(400, 'Bad Request', 'nečitelný cíl CONNECT', {});
  const kontext = { run_id: zaznam.runId, host: cil.host, port: cil.port };
  if (!zaznam.egress.some((c) => c.host === cil.host && c.port === cil.port)) {
    return odmitni(403, 'Forbidden', 'cíl není ve výčtu běhu', kontext);
  }
  let adresa: string;
  try {
    adresa = await resolveTarget(cil);
  } catch (e) {
    return odmitni(403, 'Forbidden', `cíl odmítnut ochranou SSRF (${e instanceof Error ? e.message : String(e)})`, kontext);
  }
  if (klient.destroyed) return;
  let navazano = false;
  // Spojení jde na adresu ověřenou ochranou SSRF — žádný druhý překlad jména (DNS rebinding).
  const up = net.connect({ host: adresa, port: cil.port });
  up.setTimeout(NECINNOST_TUNELU_MS, () => up.destroy());
  klient.setTimeout(NECINNOST_TUNELU_MS, () => klient.destroy());
  up.once('connect', () => {
    navazano = true;
    log.info(kontext, 'broker-proxy: výstup běhu');
    klient.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) up.write(head);
    up.pipe(klient);
    klient.pipe(up);
  });
  up.on('error', (e) => {
    if (!navazano) return odmitni(502, 'Bad Gateway', `cíl nedosažitelný (${e.message})`, kontext);
    klient.destroy();
  });
  klient.on('close', () => up.destroy());
  up.on('close', () => klient.destroy());
}

/**
 * @param execAdresa adresa runneru v exec síti; požadavek, který dorazil jinam,
 *   proxy odmítne (proxy je jen pro sandbox). Null = zatím nezjištěno → odmítá vše.
 * @param volby.resolveTarget ověření cíle CONNECT (výchozí ochrana SSRF; testy dosazují vlastní).
 */
export function vytvorBrokerProxy(
  execAdresa: () => string | null,
  volby: { resolveTarget?: ResolveTarget } = {},
): FastifyInstance {
  // Logger z továrny (brána sluzby-logger-z-tovarny): serializery req/err bez dotazu a tokenů.
  const app = Fastify({ logger: safeLoggerOptions({ level: config.logLevel }), trustProxy: false, bodyLimit: config.brokerProxyBodyLimit });
  const resolveTarget = volby.resolveTarget ?? defaultResolveTarget;
  app.server.on('connect', (req: http.IncomingMessage, sock: net.Socket, head: Buffer) => {
    void obsluzConnect(req, sock, head, execAdresa, resolveTarget, app.log);
  });
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => { done(null, body); });

  app.all('/*', async (req, reply) => {
    const ip = execAdresa();
    if (!ip || mistniAdresa(req.socket.localAddress) !== ip) {
      return reply.status(404).send({ error: 'not_found' });
    }
    const autorizace = req.headers.authorization ?? '';
    const token = autorizace.startsWith('Bearer ') ? autorizace.slice(7) : '';

    // Payload běhu vydává runner sám — jen GET, jen vlastnímu běhu, jen přesná cesta.
    if (jeCestaPayloadu(req.url)) {
      if (req.method !== 'GET') return reply.status(404).send({ error: 'not_found' });
      if (!token || !aktivni.has(token)) return reply.status(401).send({ error: 'unknown_run' });
      const payload = aktivni.get(token)?.payloadMimoEnv;
      if (payload === undefined) return reply.status(404).send({ error: 'payload_in_env' });
      return reply.status(200).header('content-type', 'application/json').send(payload);
    }

    const cesta = cestaProSandbox(req.url);
    if (!cesta) return reply.status(404).send({ error: 'not_found' });

    if (!token || !aktivni.has(token)) {
      return reply.status(401).send({ error: 'unknown_run' });
    }

    try {
      const ct = req.headers['content-type'];
      const odpoved = await preposli(req.method, cesta, autorizace, typeof ct === 'string' ? ct : undefined, Buffer.isBuffer(req.body) ? req.body : undefined);
      reply.status(odpoved.status);
      if (odpoved.contentType) reply.header('content-type', odpoved.contentType);
      return reply.send(odpoved.body);
    } catch (err) {
      const zprava = err instanceof Error ? err.message : String(err);
      req.log.error({ cesta, error: zprava }, 'broker-proxy: broker nedosažen');
      return reply.status(502).send({ error: 'broker_unreachable', detail: zprava });
    }
  });

  return app;
}
