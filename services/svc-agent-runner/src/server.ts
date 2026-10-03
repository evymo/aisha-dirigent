import Fastify from 'fastify';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { applySecurity, pluginRejection } from '@aisha/security';
import { config } from './config.js';
import { AuthError } from './auth.js';
import { runsRoutes } from './routes/runs.js';
import { wakeRoutes } from './routes/wake.js';
import { startClaudePoller } from './poller.js';
import { reconcileOrphans } from './reconcile.js';
import { assertBrokerSecretConfigured } from './broker-secret.js';

// trustProxy: false — službu volají jen naše kontejnery PŘÍMO, žádná proxy před ní
// není (změřeno 2026-09-26: v logu jen healthcheck, Prometheus a svc-plugin-system). S `true` si
// volající volil počítadlo limitu hlavičkou X-Forwarded-For (ověřeno živě na svc-money).
const app = Fastify({ logger: { level: config.logLevel }, trustProxy: false });
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

app.get('/health', async () => ({ status: 'ok', service: 'svc-agent-runner', backend: config.runnerBackend }));

await app.register(runsRoutes);
await app.register(wakeRoutes);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info('svc-agent-runner listening on :' + config.port + ' (backend: ' + config.runnerBackend + ')');
  // Reap orphaned agent containers/worktrees/rows from a previous generation
  // BEFORE arming the poller, so the live-count (and thus the concurrency cap)
  // starts accurate and leftover compute/spend is reclaimed.
  await reconcileOrphans(app.log).catch((e) => app.log.error(e, 'orphan reconcile failed'));
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
