/**
 * Start tenkého klienta lane (svc-model tenkého stacku forku na GPU uzlu).
 *
 *   LANE_KLIENT_UPSTREAM     jediný počátek vynucovacího bodu, `http://<IPv4 vstupu na síti lane>:<port>`;
 *                            adresa musí ležet v podsíti změřeného rozhraní lane (naSitiLane)
 *   LANE_KLIENT_ROZHRANI     rozhraní modelového meshe (wt0); z něj se MĚŘÍ, kdo smí
 *   LANE_KLIENT_PORT         port pro peery meshe — týž jako port modelu v meshi (MODEL_MESH_PORT)
 *   LANE_KLIENT_SPRAVA_PORT  zdraví a metriky jen na 127.0.0.1
 *
 * Všechny čtyři deklaruje compose. Chybějící nebo vadná hodnota = klient nenastartuje
 * (žádné výchozí hodnoty nad prostředím; `Number('')` by z prázdného portu udělal 0).
 * Žádný klíč: klient ho nemá a nepotřebuje (K1). Vadný upstream = klient nenastartuje.
 *
 * Metriky (`/metrics`) visí jen na SPRÁVĚ (127.0.0.1), ne na portu pro peery meshe. Export
 * OTel vypíná compose výslovně (`OTEL_SDK_DISABLED`): lane je `--internal` a jmenný prostor
 * agenta nemá cestu ke kolektoru — otevřená položka: zapnout, až bude kolektor dosažitelný.
 */
import Fastify from 'fastify';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { safeLoggerOptions } from '@aisha/security';
import { vytvorKlient } from './klient.js';
import { prijmout, rozsahMeshe } from './prijem.js';
import { naSitiLane, overUpstream } from './upstream.js';

bootstrapOtel({ serviceName: 'svc-lane-klient' });

const env = process.env;
const zaznam = (udalost: string, data: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), udalost, ...data })}\n`);

function stop(udalost: string, vada: string): never {
  zaznam(udalost, { vada });
  process.exit(1);
}
function povinne(k: string): string {
  const v = (env[k] ?? '').trim();
  return v || stop('konfigurace_vadna', `${k} chybí — deklaruje ho compose tenkého stacku`);
}
function port(k: string): number {
  const v = povinne(k);
  const n = Number(v);
  return /^\d+$/.test(v) && n >= 1 && n <= 65535 ? n : stop('konfigurace_vadna', `${k}=${v} není port 1–65535`);
}

const up = overUpstream(env.LANE_KLIENT_UPSTREAM);
if (!up.ok) stop('upstream_vadny', up.vada);
const rozhrani = povinne('LANE_KLIENT_ROZHRANI');
const portPeeru = port('LANE_KLIENT_PORT');
const portSpravy = port('LANE_KLIENT_SPRAVA_PORT');
const lane = naSitiLane(up.pocatek, rozhrani);
if (!lane.ok) stop('upstream_mimo_lane', lane.vada);

const klient = vytvorKlient({
  upstream: up.pocatek,
  prijmout: (s) => prijmout(s, rozsahMeshe(rozhrani)),
  zaznam,
});

// Zdraví = agent je v meshi (rozhraní změřené). Stav lane do zdraví kontejneru nepatří:
// nedostupná lane je odpověď LANE_NEDOSTUPNA, ne nezdravý klient.
const sprava = Fastify({ logger: safeLoggerOptions({ level: 'warn' }) });
await registerMetricsPlugin(sprava, { serviceName: 'svc-lane-klient' });
sprava.get('/__klient/zdravi', async (_req, reply) => {
  const r = rozsahMeshe(rozhrani);
  return reply.code(r ? 200 : 503).send({ mesh: r ? 'ok' : `rozhraní ${rozhrani} chybí nebo není jednoznačné` });
});

await klient.listen({ host: '0.0.0.0', port: portPeeru });
await sprava.listen({ host: '127.0.0.1', port: portSpravy });
zaznam('klient_bezi', { upstream: up.pocatek, rozhrani, lane: lane.rozhrani });
