/**
 * svc-money — služba, přes kterou produkce sahá do účetnictví Money S5.
 *
 * PROČ SLUŽBA A NE SKRIPT
 * Money je za VPN a mluví se s ním per agenda (jeden URL, víc účetních jednotek
 * rozlišených PORTEM). Dosud to obstarával skript pouštěný rukou z notebooku —
 * což znamená, že aktualizace dat závisí na tom, jestli u toho někdo sedí, a že
 * tajemství leží v souboru na disku. Služba drží tunel, zná agendy z prostředí
 * a produkce si o data řekne HTTP dotazem.
 *
 * CO TAHLE SLUŽBA NEDĚLÁ
 * Nezapisuje do registru. Vytěžení, brány i zápis patří ingestu a li-driveru —
 * tady by vznikla druhá cesta k témuž a s ní druhá pravda. Služba data POSKYTUJE.
 *
 * Rozhraní:
 *   GET  /health            — žije služba (nezávisle na tunelu)
 *   GET  /ready             — tunel běží a agendy odpovídají (fail-closed)
 *   GET  /agendas           — které agendy zná (bez pověření)
 *   POST /probe             — sonda: vidíme na doklady? kolik polí?
 *   POST /query             — GraphQL dotaz do jedné agendy
 */
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { applySecurity, createSafeLogger, pluginRejection, safeLoggerOptions } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { AuthError, verifyToken } from './auth.js';

const { safeError } = createSafeLogger('svc-money');
import { loadConfig, configDefects, type MoneyConfig } from './config.js';
import { startTunnel, type TunnelHandle } from './lib/tunnel.js';
import { graphql, httpFetcher, probe, type MoneyTarget } from './lib/money.js';

function cil(cfg: MoneyConfig, key: string): MoneyTarget {
  const a = cfg.agendas.find((x) => x.key === key);
  if (!a) throw new Error(`neznámá agenda '${key}' — známé: ${cfg.agendas.map((x) => x.key).join(', ')}`);
  return { ...a, host: cfg.host };
}

export async function build(cfg: MoneyConfig, tunnel: TunnelHandle | null) {
  /** Otevřené výpůjčky cizích spotřebitelů — id → vrácení a strop života (cfg.vpn.leaseTtlMs). */
  const vypujcky = new Map<string, { vrat: () => void; strop: ReturnType<typeof setTimeout> }>();

  // ⛔ trustProxy: false. Službu volají přímo (broker, plánovač) — žádná proxy
  // před ní není (compose jen `expose`, broker XFF neposílá; změřeno 09-25).
  // S `true` si každý volající volil počítadlo limitu hlavičkou X-Forwarded-For
  // (ověřeno živě: XFF 198.51.100.77 = vlastní počítadlo) → limit nic nechránil.
  const app = Fastify({ logger: safeLoggerOptions({ level: cfg.logLevel }), trustProxy: false });
  await applySecurity(app, {
    service: 'svc-money',
    // Prázdný allowlist = žádný cizí původ. Tuhle službu volá produkce
    // ze serveru, ne prohlížeč — CORS by tu byl jen zbytečná plocha.
    cors: { allowlist: '' },
    rateLimit: { enabled: true, max: 60, timeWindow: 60_000 },
    skipErrorHandler: true,
  });
  await registerMetricsPlugin(app, { serviceName: 'svc-money' });

  // Zdraví a seznam agend zůstávají bez pověření: healthcheck kontejneru na ně
  // sahá dřív, než jakékoli tajemství existuje, a nic z nich se nedá vyčíst.
  // Všechno, co sahá do účetnictví, pověření vyžaduje.
  app.addHook('preHandler', async (req) => {
    if (req.method === 'GET' && ['/health', '/ready', '/agendas', '/metrics'].includes(req.url.split('?')[0])) return;
    verifyToken(req.headers.authorization);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AuthError) return reply.status(err.statusCode).send({ error: err.message });
    // Odmítnutí, které vyrobil plugin (limit dotazů 429 i s `retry-after`),
    // je odpověď volajícímu, ne porucha služby. Přepsat ho na 500 znamená, že
    // broker nepozná „zpomal" od „Money leží" — 09-24 tak stály živé dodáky.
    const odmitnuti = pluginRejection(err);
    if (odmitnuti) return reply.status(odmitnuti.statusCode).send(odmitnuti.body);
    safeError('svc-money: neošetřená chyba', err);
    return reply.status(500).send({ error: 'vnitřní chyba' });
  });

  // Žije proces. NEZÁVISÍ na tunelu — jinak by restart kontejneru při výpadku
  // VPN mazal i schopnost říct, PROČ je zle.
  app.get('/health', async () => ({ status: 'ok', agendas: cfg.agendas.length }));

  // Připravenost je jiná otázka než život: bez tunelu služba data poskytnout
  // NEUMÍ, a musí to přiznat, ne vracet prázdno.
  app.get('/ready', async (_req, reply) => {
    if (!cfg.vpn.enabled) return { status: 'ok', tunnel: 'disabled' };
    // ⛔ `idle` NENÍ porucha. Cesta do cizí sítě se nedrží otevřená, když ji
    // nikdo nepotřebuje — zavřený tunel je ZÁMĚR, ne nedostupnost. 503 se
    // vrací jen tehdy, když poslední pokus o otevření SELHAL; jinak by
    // připravenost lhala opačným směrem než dřív.
    const stav = tunnel?.state() ?? 'idle';
    if (stav === 'error') {
      reply.code(503);
      return { status: 'unavailable', tunnel: 'error', reason: tunnel?.lastError() ?? 'cesta nenaběhla' };
    }
    return { status: 'ok', tunnel: stav, leases: tunnel?.leases() ?? 0 };
  });

  /**
   * Výpůjčka cesty pro CIZÍ spotřebitele (adaptér v brokeru, plánovač).
   *
   * Infrastruktura a datová komunikace jsou dvě různé věci: kdo potřebuje data,
   * si řekne o cestu; kdo cestu drží, o rozvrhu nic neví. Bez toho by tunel
   * musel být trvale otevřený kvůli spotřebiteli, který se ptá jednou za hodinu.
   */
  app.post('/lease', async (_req, reply) => {
    if (!cfg.vpn.enabled) return { status: 'ok', tunnel: 'disabled', leaseId: null };
    try {
      const vrat = await tunnel!.lease();
      // Náhodné id: dřívější `čas-(size+1)` se při stálém počtu nevrácených výpůjček
      // v téže milisekundě opakovalo a druhý zápis by první výpůjčku přepsal = další únik.
      const id = randomUUID();
      const strop = setTimeout(() => {
        if (!vypujcky.delete(id)) return;
        vrat();
        app.log.warn({ leaseId: id, leaseTtlMs: cfg.vpn.leaseTtlMs, leases: tunnel?.leases() ?? 0 },
          'výpůjčka cesty vypršela nevrácená — spotřebitel skončil dřív, než ji vrátil');
      }, cfg.vpn.leaseTtlMs);
      strop.unref?.();
      vypujcky.set(id, { vrat, strop });
      return {
        status: 'ok', tunnel: tunnel!.state(), leaseId: id, leases: tunnel!.leases(),
        expiresInMs: cfg.vpn.leaseTtlMs,
      };
    } catch (e) {
      reply.code(502);
      return { status: 'error', reason: e instanceof Error ? e.message : String(e) };
    }
  });

  app.delete<{ Params: { id: string } }>('/lease/:id', async (req, reply) => {
    const v = vypujcky.get(req.params.id);
    if (!v) { reply.code(404); return { status: 'error', reason: 'neznámá nebo už vypršelá výpůjčka' }; }
    vypujcky.delete(req.params.id);
    clearTimeout(v.strop);
    v.vrat();
    return { status: 'ok', leases: tunnel?.leases() ?? 0 };
  });

  // Pověření se NEVRACÍ — jen to, co je potřeba k volbě agendy.
  app.get('/agendas', async () => ({
    agendas: cfg.agendas.map((a) => ({ key: a.key, label: a.label, port: a.port })),
  }));

  app.post<{ Body: { agenda?: string; entity?: string; fields?: string } }>(
    '/probe', async (req, reply) => {
      const { agenda, entity = 'IssuedInvoices', fields = 'ID CisloDokladu' } = req.body ?? {};
      if (!agenda) { reply.code(400); return { error: 'chybí agenda' }; }
      // Dotaz si cestu vypůjčí sám a zase ji vrátí — volající o tunelu neví.
      let vrat: (() => void) | null = null;
      try {
        if (cfg.vpn.enabled && tunnel) vrat = await tunnel.lease();
        return await probe(cil(cfg, agenda), entity, fields);
      } catch (e) {
        reply.code(502);
        return { error: e instanceof Error ? e.message : String(e) };
      } finally {
        vrat?.();
      }
    });

  app.post<{ Body: { agenda?: string; query?: string } }>('/query', async (req, reply) => {
    const { agenda, query } = req.body ?? {};
    if (!agenda || !query) { reply.code(400); return { error: 'chybí agenda nebo query' }; }
    let vrat: (() => void) | null = null;
    try {
      if (cfg.vpn.enabled && tunnel) vrat = await tunnel.lease();
      const r = await graphql(cil(cfg, agenda), query, httpFetcher, cfg.requestTimeoutMs);
      // Chyby se vracejí VEDLE dat, ne místo nich: GraphQL umí vrátit obojí a
      // chyba na jednom poli vynuluje celý doklad. Volající to musí poznat.
      return r;
    } catch (e) {
      reply.code(502);
      return { error: e instanceof Error ? e.message : String(e) };
    } finally {
      vrat?.();
    }
  });

  app.addHook('onClose', async () => {
    for (const v of vypujcky.values()) clearTimeout(v.strop);
    vypujcky.clear();
  });

  return app;
}

async function main(): Promise<void> {
  // OTel se musí připojit DŘÍV, než kterýkoli modul sáhne na síť — jinak by
  // první volání zůstala nezměřená a v grafech by chyběl zrovna start.
  bootstrapOtel({ serviceName: 'svc-money' });
  const vady = configDefects();
  if (vady.length > 0) {
    // Fail-closed: služba s polovinou konfigurace by se tvářila, že funguje,
    // a selhala až při prvním dotazu produkce.
    safeError('svc-money NESTARTUJE', new Error(vady.join('; ')));
    process.exit(1);
  }
  const cfg = loadConfig();
  // ⛔ `startTunnel` už NEPŘIPOJUJE. Cesta se otevře až na první výpůjčku a
  // po nečinnosti se zavře. Spojení do cizí sítě je zdroj, ne vlastnost procesu:
  // dřív bylo otevřené od bootu do SIGTERM, tedy i hodiny bez jediného dotazu.
  const tunnel = cfg.vpn.enabled
    ? startTunnel({
        profileB64: cfg.vpn.profileB64,
        authUser: cfg.vpn.authUser,
        authPass: cfg.vpn.authPass,
        keyPassphrase: cfg.vpn.keyPassphrase,
        connectRetryMax: cfg.vpn.connectRetryMax,
        idleMs: cfg.vpn.idleMs,
      })
    : null;

  const app = await build(cfg, tunnel);
  const zavri = () => { tunnel?.stop(); app.close().finally(() => process.exit(0)); };
  process.on('SIGTERM', zavri);
  process.on('SIGINT', zavri);

  await app.listen({ port: cfg.port, host: '0.0.0.0' });
}

// Spustit jen jako program, ne při importu z testu.
if (process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')) {
  main().catch((e) => { safeError('svc-money: pád při startu', e); process.exit(1); });
}
