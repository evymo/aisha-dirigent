/**
 * svc-ai-chat — AI chat, story consultation, evaluation, and orchestration service.
 *
 * OWASP hardening: `applySecurity(app, ...)` from @aisha/security wires
 * helmet + CORS allowlist + global rate-limit + safe error handler in a single
 * call. Per-route overrides use `routeRateLimit('expensive' | 'mutation' | ...)`.
 * See docs/security/OWASP_ORCHESTRATOR.md for the runbook.
 *
 * Observability (Phase 12 WP 0.1): `bootstrapOtel({ serviceName })` is the
 * FIRST executable statement after static imports. OTel auto-instrumentations
 * use shimmer hot-patches that attach to modules already loaded, so the order
 * works for ESM. Exporter routes to Langfuse OTLP (sole traces backend per
 * Phase 12 §-1.12 R1). Rollback: set OTEL_SDK_DISABLED=true env in Coolify
 * and restart.
 */
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { applySecurity, safeLoggerOptions } from '@aisha/security';
import { config } from './config.js';
import { chatRoutes } from './routes/chat.js';
import { orchestrationRoutes } from './routes/orchestration.js';
import { storyConsultRoutes } from './routes/story-consult.js';
import { proactiveRoutes } from './routes/proactive.js';
import { taskRoutes } from './routes/task.js';
import { evaluateRoutes } from './routes/evaluate.js';
import { publicChatRoutes } from './routes/public-chat.js';
import { callbackRoutes } from './routes/callback.js';
import { flowboardN8nCallbackRoutes } from './routes/flowboard-n8n-callback.js';
import { modelsRoutes } from './routes/models.js';
import { benchmarkRoutes } from './routes/benchmark.js';
import { reflectRoutes } from './routes/reflect.js';
import { openclawBridgeRoutes } from './routes/openclaw-bridge.js';
import { generateRoutes } from './routes/generate.js';
import { dirigentSupervisorRoutes } from './routes/dirigent-supervisor.js';
import { v1ChatRoutes } from './routes/v1-chat.js';
import { flowboardRunRoutes } from './routes/flowboard-run.js';
import { labRecommendationRoutes } from './routes/lab-recommendation.js';
import { discoverModels, repeatAfterCompletion, DISCOVERY_INTERVAL_MS } from './lib/modelDiscovery.js';
import { selfTestModels } from './lib/modelSelfTest.js';
import { selfRegisterRuntimes } from './reflection/runtime/selfRegister.js';
import { rpcService } from './postgrest.js';
import { credentials, POVERENI_Z_PROSTREDI } from './lib/credentials.js';
import { getRegistry, setProviderKeySource } from '@aisha/llm-dispatch';

// MUST be first executable line — OTel auto-instrumentations attach to
// http/fetch/pg before Fastify or any provider client builds connection pools.
bootstrapOtel({ serviceName: 'svc-ai-chat' });

// Klíče poskytovatelů pro dispatch (OpenAI, Gemini, Anthropic, xAI) bere backend V OKAMŽIKU
// VOLÁNÍ přes čtečku pověření (trezor instance, přechodně env s varováním) — dřív je
// @aisha/llm-dispatch četl z process.env při sestavení backendu a klíč nastavený
// v administraci forku chat ani reflexe nikdy nepoužily. Musí předcházet první registr.
setProviderKeySource((envVar) => credentials.get(envVar));

const app = Fastify({ logger: safeLoggerOptions({ level: config.logLevel }), trustProxy: true });

await applySecurity(app, {
  service: 'svc-ai-chat',
  cors: { allowlist: config.corsAllowlist },
  rateLimit: { enabled: config.rateLimitEnabled, max: 100, timeWindow: 60_000 },
});

await registerMetricsPlugin(app, { serviceName: 'svc-ai-chat' });

app.get('/health', async () => ({ status: 'ok', service: 'svc-ai-chat' }));

await app.register(chatRoutes);
await app.register(orchestrationRoutes);
await app.register(storyConsultRoutes);
await app.register(proactiveRoutes);
await app.register(taskRoutes);
await app.register(evaluateRoutes);
await app.register(flowboardRunRoutes);
await app.register(labRecommendationRoutes);
await app.register(publicChatRoutes);
await app.register(callbackRoutes);
await app.register(flowboardN8nCallbackRoutes);
await app.register(modelsRoutes);
await app.register(benchmarkRoutes);
await app.register(reflectRoutes);
await app.register(openclawBridgeRoutes);
await app.register(generateRoutes);
await app.register(dirigentSupervisorRoutes);
// Omni /v1 ingress (OpenAI + Anthropic facade) — inherits applySecurity CORS + global rate-limit.
await app.register(v1ChatRoutes);

await app.listen({ host: '0.0.0.0', port: config.port });
app.log.info(`svc-ai-chat listening on :${config.port}`);

// Pověření z prostředí → trezor instance (jen kde trezor nic nemá; hodnotu z administrace
// nepřepíše). Selhání jednotlivých jmen hlásí čtečka nahlas sama; obsluhu neblokuje.
// Po přesunu se registr backendů srovná s pověřeními (klíč jen v administraci backend
// přidá, klíč nikde ho odebere) — znovu v každém průchodu discovery níž.
const srovnejBackendy = async (): Promise<void> => {
  const r = await getRegistry().reconcileCredentialBackends();
  if (r.added.length > 0 || r.removed.length > 0) {
    app.log.info({ added: r.added, removed: r.removed }, '[llm-dispatch] backendy srovnány s pověřeními instance');
  }
};
const startPovereni = credentials
  .migrateEnvCredentials(POVERENI_Z_PROSTREDI)
  .catch((e: unknown) => app.log.error({ err: e instanceof Error ? e.message : String(e) }, 'přesun pověření z prostředí selhal'))
  .then(srovnejBackendy)
  .catch((e: unknown) => app.log.error({ err: e instanceof Error ? e.message : String(e) }, 'srovnání backendů s pověřeními selhalo'));

// Auto-discover models from the CONFIGURED backends on boot — "by available keys
// AISHA discovers which models exist; nothing known in advance". Soft-fail: a
// discovery error never blocks serving. Discovered models land in ai_model_registry
// (eval_status='pending'), usable immediately, capabilities refined by self-test.
// discover → self-test: scan keys for models, then smoke-test the newly-pending ones
// so they advance pending → tested/rejected (the resolver then ranks/excludes them).
const discoveryCycle = async (phase: 'boot' | 'periodic'): Promise<void> => {
  // Klíč nastavený/smazaný v administraci mezi průchody → backend přidat/odebrat dřív, než se hledají modely.
  if (phase === 'boot') await startPovereni;
  else await srovnejBackendy().catch((e: unknown) => app.log.error({ err: e instanceof Error ? e.message : String(e) }, 'srovnání backendů s pověřeními selhalo'));
  const r = await discoverModels((fn, params) => rpcService(fn, params));
  app.log.info(
    {
      phase,
      discovered: r.discovered,
      perProvider: r.perProvider,
      markedUnavailable: r.markedUnavailable,
      availabilityUnmeasured: r.availabilityUnmeasured,
      measuredEmbeddingDimensions: r.measuredEmbeddingDimensions,
      errors: r.errors.length,
    },
    '[model-discovery] scan complete',
  );
  const s = await selfTestModels((fn, params) => rpcService(fn, params));
  app.log.info({ phase, tested: s.tested, passed: s.passed, failed: s.failed }, '[model-self-test] pass complete');
};
void discoveryCycle('boot').catch((e: unknown) => app.log.warn({ err: String(e) }, '[model-discovery/self-test] boot failed'));
// Opakovaně — model nasazený PO startu (svc-model ve vlně 7) nebo vrácený po výpadku
// se jinak k resolveru nedostane. Viz DISCOVERY_INTERVAL_MS.
repeatAfterCompletion(
  () => discoveryCycle('periodic'),
  DISCOVERY_INTERVAL_MS,
  (e: unknown) => app.log.warn({ err: String(e) }, '[model-discovery/self-test] periodic pass failed'),
);

// Runtime self-registration (E3) — reconcile in-process RuntimeAdapter liveness
// into ai_runtime_registry so fn_resolve_runtime / fn_admit_clow can derive the
// runtimes whose adapters actually ship here. hermes self-enables (DB-side, always
// available); openclaw / workbench enable iff configured. The enabled set is
// DERIVED from real adapter state, never an allow-list. Soft-fail: a registry
// write error never blocks serving.
void selfRegisterRuntimes((fn, params) => rpcService(fn, params))
  .then((r) => app.log.info({ enabled: r.enabled, disabled: r.disabled }, '[runtime-self-register] boot reconcile complete'))
  .catch((e: unknown) => app.log.warn({ err: String(e) }, '[runtime-self-register] boot failed'));
