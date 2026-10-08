import pg from 'pg';
import { Redis } from 'ioredis';
import { request } from 'undici';
import { urlHostForLog } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { config, log, safeLog, type Budik } from './config.js';
import { acsInbound } from './acsInbound.js';
import { vytvorExecutor, vytvorPoolSluzby, type Executor } from './proaktivni/executor.js';

// Phase 12 WP 0.4 — OTel auto-instrumentation must attach before pg / ioredis
// / undici build their connection pools. Worker has no HTTP server, so no
// /metrics endpoint — Prometheus scrapes via event-worker's PG_NOTIFY traces
// emitted into Langfuse spans.
// Rollback: OTEL_SDK_DISABLED=true env (Coolify) + container restart.
bootstrapOtel({ serviceName: 'event-worker' });

// ── PG LISTEN client ──
// `let` — a pg.Client cannot reconnect after a fatal socket error; the
// reconnect loop below replaces it with a fresh instance.
let pgClient = new pg.Client({ connectionString: config.databaseUrl });

// ── Redis publisher (ws-gateway subscribes on the other end) ──
const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: null });

// ── Executor akcí po události (F3a) — vlastní pool se servisní rolí ──
// LISTEN klient výš je jen budík; akce se čtou a zapisují přes outbox ai_proactive_runs.
const executor: Executor | null = config.proactive.enabled
  ? vytvorExecutor({
      config: {
        databaseUrl: config.databaseUrl,
        worker: config.proactive.worker,
        pushUrl: config.proactive.pushUrl,
        serviceToken: config.serviceToken,
        staleSeconds: config.proactive.staleSeconds,
        maxAttempts: config.proactive.maxAttempts,
        catchupBatch: config.proactive.catchupBatch,
      },
      log: {
        info: (o, m) => log.info(o, m),
        warn: (o, m) => log.warn(o, m),
        error: (o, m) => log.error(o, m),
      },
      pool: vytvorPoolSluzby(config.databaseUrl),
    })
  : null;
const casovace: NodeJS.Timeout[] = [];

interface PgNotifyPayload {
  table?: string;
  schema?: string;
  type?: 'INSERT' | 'UPDATE' | 'DELETE';
  record?: Record<string, unknown>;
  old_record?: Record<string, unknown>;
  channel_topic?: string;
  event?: string;
  payload?: Record<string, unknown>;
}

async function handleNotification(channel: string, rawPayload: string): Promise<void> {
  // ⛔ BUDÍKY (registr v config.ts) NIKDY do Redisu/ws-gateway, webhooků ani n8n:
  // resolveRedisChannel by z nich udělal `ws:db:public.unknown` a payload by doputoval
  // do prohlížečů. Odbočí se PŘED branou ACS — budík není zpráva agenta a
  // ACS_MODE=enforce by ho zahodil jako neplatnou.
  const budik = config.budiky.find((b) => b.kanal === channel);
  if (budik) {
    await probud(budik, rawPayload);
    return;
  }

  let parsed: PgNotifyPayload;
  try {
    parsed = JSON.parse(rawPayload) as PgNotifyPayload;
  } catch {
    log.warn({ channel, rawPayload }, 'Non-JSON pg_notify payload, skipping');
    return;
  }

  // 0) ACS inbound gate (IP-4, docs/AGENT_COMMUNICATION_STANDARD.md).
  //    ACS_MODE=off (default) → immediate pass-through, zero behavioural change.
  //    enforce → invalid/unauthorized/duplicate traffic is dead-lettered here.
  const acsOutcome = await acsInbound(pgClient).handle(parsed as Record<string, unknown>);
  if (acsOutcome === 'dropped') {
    log.warn({ channel }, 'ACS enforce: message dropped by inbound gate');
    return;
  }

  // 1) Publish to Redis for ws-gateway → browser clients
  const redisChannel = resolveRedisChannel(channel, parsed);
  await redis.publish(redisChannel, rawPayload);
  log.debug({ channel, redisChannel }, 'Published to Redis');

  // 1b) storage_events → DRIVE THE AV SCAN. The redis relay above only wakes
  //     ws-gateway (browser toast); it is NOT the scanner. When an object lands
  //     in the quarantine bucket, route it to storage-auth's internal
  //     /internal/scan-object endpoint so scanAndPromote runs FAIL-CLOSED and the
  //     object is only promoted to its durable bucket once clamd reports it clean.
  if (channel === 'storage_events' && config.storageAuthUrl) {
    await routeStorageEventToScan(parsed);
  }

  // 2) Route to microservice webhooks if configured
  const tableKey = `${parsed.schema ?? 'public'}.${parsed.table ?? ''}`;
  const webhookUrl = config.webhookRoutes.get(tableKey);
  if (webhookUrl) {
    try {
      await request(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: rawPayload,
      });
      log.debug({ tableKey, webhookHost: urlHostForLog(webhookUrl) }, 'Webhook delivered');
    } catch (err) {
      // Host only: the route URL comes from env and a webhook URL may carry its
      // key in userinfo, query or path. tableKey names the route.
      log.error({ tableKey, webhookHost: urlHostForLog(webhookUrl), err }, 'Webhook delivery failed');
    }
  }

  // 3) Forward to n8n if configured
  if (config.n8nWebhookUrl && channel === 'db_changes') {
    try {
      await request(config.n8nWebhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: rawPayload,
      });
    } catch (err) {
      log.error({ err }, 'n8n webhook delivery failed');
    }
  }
}

/**
 * Obslouží budík z registru. `executor` = v procesu (akce po události); `wake` = POST
 * na `/wake` vlastníka fronty se servisním tokenem a tělem `{ kanal }` — payload NOTIFY
 * se NEpřeposílá (budík jen budí, data si vlastník čte z fronty). Chyba doručení se
 * zaloguje a nic neshodí: vlastník má záložní tik.
 */
async function probud(budik: Budik, rawPayload: string): Promise<void> {
  if (budik.cil.druh === 'executor') {
    if (executor) await executor.zpracujNotify(rawPayload);
    return;
  }
  if (!budik.cil.url) {
    log.debug({ kanal: budik.kanal }, 'budík bez adresy — přeskočeno (vlastník má záložní tik)');
    return;
  }
  const url = `${budik.cil.url.replace(/\/$/, '')}${budik.cil.cesta}`;
  try {
    const res = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.serviceToken}` },
      body: JSON.stringify({ kanal: budik.kanal }),
    });
    await res.body.dump();
    if (res.statusCode >= 300) log.error({ kanal: budik.kanal, statusCode: res.statusCode }, 'budík: /wake odmítl');
  } catch (err) {
    log.error({ kanal: budik.kanal, err }, 'budík: /wake nedoručen');
  }
}

/**
 * Route a `storage_events` NOTIFY to storage-auth's internal scan→promote endpoint.
 *
 * This is the EMITTER that drives `scanAndPromote`: a freshly-landed quarantine
 * object is POSTed to `/internal/scan-object` (service-role authenticated), which
 * streams it to clamd and promotes/blocks it fail-closed. Delivery failures are
 * logged, not thrown — the object stays quarantined (never served) and can be
 * retried; a failed relay must never crash the sole event hub.
 */
async function routeStorageEventToScan(parsed: PgNotifyPayload): Promise<void> {
  // The object descriptor may arrive under `payload` (explicit NOTIFY) or `record`
  // (row-trigger). Read defensively; the scan route validates `objectKey`.
  const body = (parsed.payload ?? parsed.record ?? {}) as Record<string, unknown>;
  const objectKey = body['objectKey'] ?? body['key'] ?? body['object_key'];
  const bucket = body['bucket'];
  const documentId = body['documentId'] ?? body['document_id'] ?? null;

  if (typeof objectKey !== 'string' || objectKey.length === 0) {
    safeLog.safeWarn('storage_events NOTIFY had no objectKey — skipping scan', { event: 'storage_events' });
    return;
  }

  const scanUrl = `${config.storageAuthUrl.replace(/\/$/, '')}/internal/scan-object`;
  try {
    const res = await request(scanUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.serviceToken}`,
      },
      body: JSON.stringify({
        ...(typeof bucket === 'string' ? { bucket } : {}),
        objectKey,
        documentId,
      }),
    });
    if (res.statusCode >= 300) {
      const detail = await res.body.text().catch(() => '');
      log.error({ statusCode: res.statusCode, detail, objectKey }, 'scan-object route rejected storage_event');
      return;
    }
    log.debug({ objectKey }, 'storage_event routed to AV scan-object');
  } catch (err) {
    log.error({ err, objectKey }, 'Failed to route storage_event to scan-object');
  }
}

function resolveRedisChannel(pgChannel: string, payload: PgNotifyPayload): string {
  if (pgChannel === 'realtime_broadcast' && payload.channel_topic) {
    return `ws:broadcast:${payload.channel_topic}`;
  }
  if (pgChannel === 'storage_events') {
    return 'ws:storage';
  }
  // db_changes → ws:db:{schema}.{table}
  return `ws:db:${payload.schema ?? 'public'}.${payload.table ?? 'unknown'}`;
}

// ── Lifecycle ──

// Bounded PG reconnect: 10 attempts, 1s doubling to a 30s cap, then fail loud.
const PG_RECONNECT_MAX_ATTEMPTS = 10;
const PG_RECONNECT_BASE_DELAY_MS = 1_000;
const PG_RECONNECT_MAX_DELAY_MS = 30_000;

let shuttingDown = false;
let reconnecting = false;

async function connectAndListen(): Promise<void> {
  await pgClient.connect();
  log.info('PostgreSQL connected');

  for (const channel of config.pgChannels) {
    await pgClient.query(`LISTEN ${channel}`);
    log.info({ channel }, 'Listening on PG channel');
  }

  pgClient.on('notification', (msg: pg.Notification) => {
    if (msg.payload) {
      handleNotification(msg.channel, msg.payload).catch((err: Error) => {
        log.error({ err, channel: msg.channel }, 'Notification handler error');
      });
    }
  });

  pgClient.on('error', (err: Error) => {
    log.error({ err }, 'PG client error — attempting reconnect');
    void reconnectPg();
  });

  pgClient.on('end', () => {
    if (!shuttingDown) {
      log.error('PG connection ended unexpectedly — attempting reconnect');
      void reconnectPg();
    }
  });
}

async function reconnectPg(): Promise<void> {
  if (shuttingDown || reconnecting) return;
  reconnecting = true;

  pgClient.removeAllListeners();
  await pgClient.end().catch(() => {});

  for (let attempt = 1; attempt <= PG_RECONNECT_MAX_ATTEMPTS; attempt++) {
    const delayMs = Math.min(
      PG_RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
      PG_RECONNECT_MAX_DELAY_MS,
    );
    log.warn(
      { attempt, maxAttempts: PG_RECONNECT_MAX_ATTEMPTS, delayMs },
      'PG reconnect scheduled',
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (shuttingDown) return;

    pgClient = new pg.Client({ connectionString: config.databaseUrl });
    try {
      await connectAndListen();
      log.info({ attempt }, 'PG reconnected — all channels re-LISTENed');
      reconnecting = false;
      return;
    } catch (err) {
      log.error({ err, attempt }, 'PG reconnect attempt failed');
      pgClient.removeAllListeners();
      await pgClient.end().catch(() => {});
    }
  }

  log.fatal({ attempts: PG_RECONNECT_MAX_ATTEMPTS }, 'PG reconnect attempts exhausted, exiting');
  process.exit(1);
}

async function start(): Promise<void> {
  log.info('Event Worker starting…');

  await redis.connect();
  log.info('Redis connected');

  try {
    await connectAndListen();
  } catch (err) {
    log.error({ err }, 'Initial PG connect failed — entering bounded reconnect');
    await reconnectPg();
  }

  if (executor) {
    const tik = (co: string, fn: () => Promise<unknown>) => () => {
      fn().catch((err: Error) => log.error({ err, co }, 'proaktivní: tik selhal'));
    };
    // Po startu hned dohnat: notify vydané, zatímco worker neběžel, se ztratila.
    tik('dohnání', () => executor.dohnat())();
    casovace.push(setInterval(tik('dohnání', () => executor.dohnat()), config.proactive.catchupMs));
    casovace.push(setInterval(tik('cron', () => executor.cronTik()), config.proactive.cronTickMs));
    log.info(
      { schopnosti: executor.schopnosti, catchupMs: config.proactive.catchupMs },
      'Executor akcí po události běží',
    );
  } else {
    log.warn('PROACTIVE_EXECUTOR=off — akce po události se nevykonávají (běhy zůstanou pending)');
  }

  log.info('Event Worker ready — listening for pg_notify events');
}

async function shutdown(): Promise<void> {
  log.info('Shutting down…');
  shuttingDown = true;
  for (const t of casovace) clearInterval(t);
  if (executor) await executor.zavri().catch(() => {});
  await pgClient.end().catch(() => {});
  redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });

start().catch((err) => {
  log.fatal({ err }, 'Failed to start Event Worker');
  process.exit(1);
});
