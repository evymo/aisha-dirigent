import Fastify from 'fastify';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { applySecurity, pluginRejection, safeLoggerOptions } from '@aisha/security';
import { config } from './config.js';
import { AuthError } from './auth.js';
import { runsRoutes } from './routes/runs.js';
import { wakeRoutes } from './routes/wake.js';
import { startClaudePoller } from './poller.js';
import { reconcileOrphans } from './reconcile.js';
import { assertBrokerSecretConfigured } from './broker-secret.js';
import { adresaVExecSiti, pristupKApi, vytvorBrokerProxy, zajistiCestuKBrokeru } from './broker-proxy.js';
import { credentials, POVERENI_Z_PROSTREDI } from './credentials.js';

// trustProxy: false — službu volají jen naše kontejnery PŘÍMO, žádná proxy před ní
// není (změřeno 2026-09-26: v logu jen healthcheck, Prometheus a svc-plugin-system). S `true` si
// volající volil počítadlo limitu hlavičkou X-Forwarded-For (ověřeno živě na svc-money).
const app = Fastify({ logger: safeLoggerOptions({ level: config.logLevel }), trustProxy: false });
assertBrokerSecretConfigured();

await applySecurity(app, {
  service: 'svc-agent-runner',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 60, timeWindow: 60_000 },
  skipErrorHandler: true,
});

app.setErrorHandler((error: FastifyError | AuthError, _req: FastifyRequest, reply: FastifyReply) => {
  if (error instanceof AuthError) return reply.status(error.statusCode).send({ error: error.message });
  // 4xx z pluginu (limit 429, validace 400) je odpověď volajícímu, ne porucha.
  const odmitnuti = pluginRejection(error);
  if (odmitnuti) return reply.status(odmitnuti.statusCode).send(odmitnuti.body);
  app.log.error(error);
  return reply.status(500).send({ error: 'Internal server error' });
});

// ⛔ API runneru (spouští kontejnery přes docker.sock) se sandboxu NEUKAZUJE. Od
// broker-proxy je runner i v exec síti; co tam dorazí na tenhle port, odmítne se
// dřív, než se vůbec ověřuje token. Sandbox smí jen na proxy.
// 2026-10-07 (revize D6): VÝČET povolených místních adres, ne zákaz jedné —
// dokud runner své sítě nezměří, API mimo smyčku neobslouží nic (fail-closed).
app.addHook('onRequest', async (req, reply) => {
  const pristup = pristupKApi(req.socket.localAddress);
  if (pristup === 'nezmereno') return reply.status(503).send({ error: 'runner_site_nezmereny' });
  if (pristup === 'mimo') return reply.status(404).send({ error: 'not_found' });
});

app.get('/health', async () => ({ status: 'ok', service: 'svc-agent-runner', backend: config.runnerBackend }));

await app.register(runsRoutes);
await app.register(wakeRoutes);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info('svc-agent-runner listening on :' + config.port + ' (backend: ' + config.runnerBackend + ')');
  // ⛔ Broker-proxy je POVINNÁ (2026-10-06, volba A): síť běhů je uzavřená a proxy je
  // jediná cesta z ní ven — k brokeru i (pro claude_cli_task) přes CONNECT. Neotevřený
  // port je proto chyba startu, ne varování.
  const proxy = vytvorBrokerProxy(adresaVExecSiti);
  await proxy.listen({ port: config.brokerProxyPort, host: '0.0.0.0' });
  // Síť běhů + připojení runneru se měří i u KAŽDÉHO běhu; tady jen aby stav byl vidět
  // hned po startu a API runneru odmítalo síť běhů dřív, než v ní cokoli poběží.
  // Neúspěch se zkouší znovu, dokud neprojde — do té doby API mimo smyčku zavřené a běhy
  // se nespustí (každý běh měří znovu). Žádné „pokračuj bez měření“.
  const zmerSite = async (): Promise<boolean> =>
    zajistiCestuKBrokeru()
      .then((brokerUrl) => {
        app.log.info({ alias: config.brokerProxyAlias, port: config.brokerProxyPort, sit: config.dockerExecNetwork, adresa: adresaVExecSiti(), brokerUrl, broker: config.pluginBrokerUrl }, 'broker-proxy běží, síť běhů uzavřená');
        return true;
      })
      .catch((e: unknown) => {
        app.log.error({ error: e instanceof Error ? e.message : String(e), sit: config.dockerExecNetwork }, 'síť běhů / připojení broker-proxy neprošlo — API mimo smyčku zavřené, běhy se nespustí; zkusím znovu za 30 s');
        return false;
      });
  if (!(await zmerSite())) {
    const opakovani = setInterval(() => {
      void zmerSite().then((ok) => { if (ok) clearInterval(opakovani); });
    }, 30_000);
    opakovani.unref();
  }
  // Reap orphaned agent containers/worktrees/rows from a previous generation
  // BEFORE arming the poller, so the live-count (and thus the concurrency cap)
  // starts accurate and leftover compute/spend is reclaimed.
  await reconcileOrphans(app.log).catch((e) => app.log.error(e, 'orphan reconcile failed'));
  // Pověření z prostředí → trezor instance (jen kde trezor nic nemá; hodnotu
  // z administrace nepřepíše). Selhání jednotlivých jmen hlásí čtečka nahlas sama.
  await credentials
    .migrateEnvCredentials(POVERENI_Z_PROSTREDI)
    .catch((e: unknown) => app.log.error({ error: e instanceof Error ? e.message : String(e) }, 'přesun pověření z prostředí selhal'));
  // cli:claude-cli adapter_health is owned EXCLUSIVELY by the dedicated service-
  // reachability probe (WF_RUNTIME_HEALTH_PROBE → record_runtime_health_result),
  // never written from a process's own config-presence (a one-directional boot write
  // would leave a dead/poll-disabled runner stuck 'healthy' and admit CLI runs into a
  // drain that never drains). The seed 'unknown' is already admissible
  // (fn_runtime_available accepts healthy|unknown), so no self-register is needed.
  // Producer→executor link: pick up claude_cli_task rows queued via fn_spawn.
  startClaudePoller(app.log);
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
