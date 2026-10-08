/**
 * Start vynucovacího bodu na uzlu (proces; aplikaci staví vytvorVstup ve vstup.ts).
 *
 *   ACCEL_VB_DEKLARACE    cesta k uzel.json ve svazku (zapisuje one-shot accel-deklarace)
 *   ACCEL_VB_PORT         port pro nájemce (výchozí 8000; jen IPv4, adresy vstupů z deklarace)
 *   ACCEL_VB_SPRAVA_PORT  zdraví a měření jen na 127.0.0.1 (výchozí 8081)
 *   ACCEL_JADRO_KLIC      interní klíč operátora VB → engine (nájemci ho nikdy nedostanou)
 *   ACCEL_VB_CLENSTVI     cesta ke clenstvi.json (zapisuje hlídač členství sítí; bez něj nikoho)
 *
 * Bez deklarace VB běží, ale odpovídá DEKLARACE_NECITELNA (stav je vidět, nic není otevřené).
 *
 * Metriky (`/metrics`) visí jen na SPRÁVĚ (127.0.0.1), ne na portu pro nájemce. Export OTel vypíná
 * compose výslovně (`OTEL_SDK_DISABLED`): sítě lane i jádra jsou `internal`, cesta ke kolektoru
 * z uzlu není (stejně jako u klienta lane).
 */
import Fastify from 'fastify';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { safeLoggerOptions } from '@aisha/security';
import { Clenstvi, rozhodniClenstvi } from './clenstvi.js';
import { Deklarace } from './deklarace.js';
import { Adaptery, diskSvazku } from './adaptery.js';
import { vytvorMotorAdapteru, vytvorSondy, vytvorUpstream } from './enginy.js';
import { Kvoty, knihaVPameti } from './kvoty.js';
import { Pripravenost } from './pripravenost.js';
import { vytvorVstup } from './vstup.js';
import { odchylkySite } from './sit.js';

bootstrapOtel({ serviceName: 'svc-accel-vstup' });
const env = process.env;
const zaznam = (udalost: string, data: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), udalost, ...data })}\n`);

// Klíč jádra plní warmup z trezoru operátora a compose ho nese holý (tajemství bez `:?`): prázdný
// klíč tady odmítnout nahlas, jinak by VB běžel a enginy by mu vracely 401 (vypadá jako výpadek lane).
if (!(env.ACCEL_JADRO_KLIC ?? '').trim()) {
  zaznam('konfigurace_vadna', { vada: 'ACCEL_JADRO_KLIC chybí — compose ho plní z ACCEL_JADRO_API_KEY (tajemství vrstvy, generuje env-doktor)' });
  process.exit(1);
}

const deklarace = new Deklarace(env.ACCEL_VB_DEKLARACE ?? '/deklarace/uzel.json', zaznam);
deklarace.sleduj();
const clenstvi = new Clenstvi(env.ACCEL_VB_CLENSTVI ?? '/clenstvi/clenstvi.json', () => deklarace.otiskObsahu(), zaznam);
clenstvi.sleduj();

let sit = odchylkySite();
if (sit.length > 0) zaznam('sit_neodpovida', { odchylky: sit });
setInterval(() => {
  const nove = odchylkySite();
  if (nove.join('|') !== sit.join('|')) zaznam(nove.length ? 'sit_neodpovida' : 'sit_v_poradku', { odchylky: nove });
  sit = nove;
}, 5000).unref();

const pripravenost = new Pripravenost(vytvorSondy({ klicJadra: env.ACCEL_JADRO_KLIC }), zaznam);
setInterval(() => {
  const t = deklarace.tabulka();
  if (!('necitelna' in t)) void pripravenost.krok(t.enginy.values());
}, 1000).unref();

// Adaptéry nájemců za běhu (adaptery.ts): dorovnání nad PŘIPRAVENÝM chatovým enginem, jedno naráz.
const adaptery = new Adaptery(vytvorMotorAdapteru(env.ACCEL_JADRO_KLIC), diskSvazku, zaznam);
let dorovnava = false;
setInterval(() => {
  const t = deklarace.tabulka();
  if (dorovnava || 'necitelna' in t) return;
  dorovnava = true;
  void (async () => {
    for (const e of t.enginy.values()) {
      if (e.druh !== 'generate') continue;
      if (pripravenost.stav(e.id) !== 'PRIPRAVEN') {
        adaptery.zapomen(e.id);
        continue;
      }
      await adaptery.dorovnej(e).catch((err) => zaznam('adaptery_chyba', { engine: e.id, pricina: String((err as Error)?.message ?? err).slice(0, 120) }));
    }
  })().finally(() => (dorovnava = false));
}, 5000).unref();

const kvoty = new Kvoty(knihaVPameti());
const vstup = vytvorVstup({
  tabulka: () => deklarace.tabulka(),
  pripravenost,
  clenstvi: () => clenstvi.stav(),
  kvoty,
  upstream: vytvorUpstream(env.ACCEL_JADRO_KLIC),
  zaznam,
  sitOk: () => sit.length === 0,
  adaptery,
});

// Správa: jen loopback, jen stav (bez nájemců, bez klíčů).
const sprava = Fastify({ logger: safeLoggerOptions({ level: 'warn' }) });
await registerMetricsPlugin(sprava, { serviceName: 'svc-accel-vstup' });
sprava.get('/__vb/zdravi', async (_req, reply) => {
  const t = deklarace.tabulka();
  const enginy = 'necitelna' in t ? {} : Object.fromEntries([...t.enginy.keys()].map((id) => [id, pripravenost.stav(id)]));
  const c = rozhodniClenstvi(clenstvi.stav(), null, Date.now());
  const ok = sit.length === 0 && !('necitelna' in t) && c === null;
  return reply.code(ok ? 200 : 503).send({ deklarace: 'necitelna' in t ? t.necitelna : 'ok', sit: sit.length ? sit : 'ok', clenstvi: c ? c.error : 'ok', enginy });
});

await vstup.listen({ host: '0.0.0.0', port: Number(env.ACCEL_VB_PORT ?? 8000) });
await sprava.listen({ host: '127.0.0.1', port: Number(env.ACCEL_VB_SPRAVA_PORT ?? 8081) });
zaznam('vstup_bezi', { port: Number(env.ACCEL_VB_PORT ?? 8000) });
