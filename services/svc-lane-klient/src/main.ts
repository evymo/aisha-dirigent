/**
 * Start tenkého klienta lane (svc-model tenkého stacku forku na GPU uzlu).
 *
 *   LANE_KLIENT_UPSTREAM     jediný počátek vynucovacího bodu, `http://<prefix>-accel-vstup:8000`
 *   LANE_KLIENT_ROZHRANI     rozhraní modelového meshe (výchozí wt0); z něj se MĚŘÍ, kdo smí
 *   LANE_KLIENT_PORT         port pro peery meshe (výchozí 8000)
 *   LANE_KLIENT_SPRAVA_PORT  zdraví jen na 127.0.0.1 (výchozí 8081)
 *
 * Žádný klíč: klient ho nemá a nepotřebuje (K1). Vadný upstream = klient nenastartuje.
 */
import Fastify from 'fastify';
import { vytvorKlient } from './klient.js';
import { prijmout, rozsahMeshe } from './prijem.js';
import { overUpstream } from './upstream.js';

const env = process.env;
const zaznam = (udalost: string, data: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), udalost, ...data })}\n`);

const up = overUpstream(env.LANE_KLIENT_UPSTREAM);
if (!up.ok) {
  zaznam('upstream_vadny', { vada: up.vada });
  process.exit(1);
}
const rozhrani = env.LANE_KLIENT_ROZHRANI ?? 'wt0';

const klient = vytvorKlient({
  upstream: up.pocatek,
  prijmout: (s) => prijmout(s, rozsahMeshe(rozhrani)),
  zaznam,
});

// Zdraví = agent je v meshi (rozhraní změřené). Stav lane do zdraví kontejneru nepatří:
// nedostupná lane je odpověď LANE_NEDOSTUPNA, ne nezdravý klient.
const sprava = Fastify({ logger: false });
sprava.get('/__klient/zdravi', async (_req, reply) => {
  const r = rozsahMeshe(rozhrani);
  return reply.code(r ? 200 : 503).send({ mesh: r ? 'ok' : `rozhraní ${rozhrani} chybí nebo není jednoznačné` });
});

await klient.listen({ host: '0.0.0.0', port: Number(env.LANE_KLIENT_PORT ?? 8000) });
await sprava.listen({ host: '127.0.0.1', port: Number(env.LANE_KLIENT_SPRAVA_PORT ?? 8081) });
zaznam('klient_bezi', { upstream: up.pocatek, rozhrani });
