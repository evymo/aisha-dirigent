import { hostname } from 'node:os';
import pino from 'pino';
import { createSafeLogger, safeLoggerOptions } from '@aisha/security';

const log = pino(safeLoggerOptions({ level: process.env['LOG_LEVEL'] ?? 'info' }));
/**
 * OWASP A09 — redacted logger for any path that touches PG NOTIFY payloads.
 * Use this alongside `log` (pino) when the payload may contain user-supplied
 * data; safeLog strips PII / tokens before stdout.
 */
const safeLog = createSafeLogger('event-worker');

/**
 * REGISTR BUDÍKŮ (Aisha Guru 2026-09-28: jeden obecný registr, ne speciální cesty).
 *
 * Budík je kanál NOTIFY, který jen BUDÍ vlastníka fronty („podívej se do fronty“) —
 * data si vlastník čte sám z tabulky. Proto budík:
 *   · se v handleNotification odbočí ÚPLNĚ NA ZAČÁTKU — nikdy do Redisu/ws-gateway
 *     (payload by doputoval do prohlížečů), do webhooků tabulek ani přes bránu ACS
 *     (enforce by budík zahodil jako neplatnou zprávu);
 *   · druh `executor` = obslouží ho proces sám (akce po události, F3a);
 *   · druh `wake`     = POST `<url><cesta>` se servisním tokenem a tělem `{ kanal }` —
 *     payload NOTIFY se dál NEposílá. Prázdná URL = přeskočit (vlastník má záložní tik).
 * Dohánění ztracených budíků je věc VLASTNÍKA fronty, ne registru.
 * Každá proměnná adresy musí být v compose event-workeru (brána proaktivni-executor-kontrakt).
 */
export type CilBudiku =
  | { druh: 'executor' }
  | { druh: 'wake'; url: string; cesta: string };
export interface Budik {
  kanal: string;
  cil: CilBudiku;
}

const budiky: readonly Budik[] = [
  // Akce po události (F3a): dispečer ai_proactive_trigger_definitions zapíše běh do
  // outboxu ai_proactive_runs a tímhle budí executor v tomto procesu.
  { kanal: 'ai_proactive_dispatch', cil: { druh: 'executor' } },
];

export const config = {
  /** PostgreSQL connection for LISTEN channels */
  databaseUrl: process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@db:5432/postgres',

  /** Redis for pub/sub → ws-gateway */
  redisUrl: process.env['REDIS_URL'] ?? 'redis://redis:6379',

  /** PG NOTIFY channels to listen on */
  pgChannels: [
    'db_changes',            // generic row changes (INSERT/UPDATE/DELETE via trigger)
    'realtime_broadcast',    // broadcast events (chat, presence)
    'storage_events',        // upload/delete completed
    'agent_run_queued',      // claude_cli_task became claimable → wake svc-agent-runner
    'playwright_run_queued', // e2e run became claimable → wake svc-playwright-runner
    // + kanály z registru budíků (výš) — LISTEN automaticky, obsluha mimo Redis/ACS.
    ...budiky.map((b) => b.kanal),
  ],

  /** Registr budíků — viz komentář u `budiky`. */
  budiky,

  /** Microservice webhook targets — event routing table (payload.table keyed) */
  webhookRoutes: new Map<string, string>([
    // schema.table → microservice URL for async processing
    ['public.profiles', process.env['WEBHOOK_PROFILES'] ?? ''],
    ['public.activities', process.env['WEBHOOK_ACTIVITIES'] ?? ''],
    ['public.evaluations', process.env['WEBHOOK_EVALUATIONS'] ?? ''],
    // Wake-on-event: route the queued-run NOTIFY to each runner's /wake endpoint.
    // Empty env → route skipped (the runner's safety-net poll still drains the queue).
    ['public.agent_runs', process.env['WEBHOOK_AGENT_RUNNER'] ?? ''],
    ['public.playwright_runs', process.env['WEBHOOK_PLAYWRIGHT_RUNNER'] ?? ''],
  ]),

  /** n8n webhook URL for workflow triggers */
  n8nWebhookUrl: process.env['N8N_WEBHOOK_URL'] ?? '',

  /**
   * storage-auth base URL. When set, a `storage_events` NOTIFY is routed to
   * storage-auth's internal `/internal/scan-object` route so the AV scan→promote
   * pipeline runs when an object lands. Empty → route skipped (no scanner wired;
   * the object stays quarantined and unserved, consistent with fail-closed).
   */
  storageAuthUrl: process.env['STORAGE_AUTH_URL'] ?? '',
  /**
   * Service-role token presented to storage-auth's internal scan route
   * (verifyServiceRole). Same POSTGREST_SERVICE_TOKEN the platform shares for
   * service-role calls. Empty → the scan route rejects with 401 (fail-closed).
   */
  serviceToken: process.env['POSTGREST_SERVICE_TOKEN'] ?? '',

  /**
   * Executor akcí po události (F3a). Zapnutý, protože o tom, CO se děje, rozhodují
   * DATA instance: bez pravidla s kanálem executoru (extranet | push | email) nezabere
   * nic. `PROACTIVE_EXECUTOR=off` je vypínač pro výjimečný stav, ne konfigurace.
   */
  proactive: {
    enabled: (process.env['PROACTIVE_EXECUTOR'] ?? '').trim().toLowerCase() !== 'off',
    /** Jméno workeru do metadat běhu (kdo zabral) — kontejner, ne tajemství. */
    // Jméno kontejneru z jádra (v Dockeru = hostname kontejneru), ne z env kontraktu:
    // HOSTNAME dosazuje runtime, compose ho nedoručuje a prázdná deklarace by ho přebila.
    worker: hostname().trim() || 'event-worker',
    /** svc-push (katalog: internal_endpoints → PUSH_SERVICE_URL). Prázdné = kanál push `no_transport`. */
    pushUrl: (process.env['PUSH_SERVICE_URL'] ?? '').trim(),
    catchupMs: celeCislo('PROACTIVE_CATCHUP_MS', 60_000, 5_000, 3_600_000),
    cronTickMs: celeCislo('PROACTIVE_CRON_TICK_MS', 60_000, 10_000, 3_600_000),
    staleSeconds: celeCislo('PROACTIVE_STALE_SECONDS', 600, 30, 86_400),
    maxAttempts: celeCislo('PROACTIVE_MAX_ATTEMPTS', 5, 1, 50),
    catchupBatch: celeCislo('PROACTIVE_CATCHUP_BATCH', 20, 1, 200),
  },
} as const;

/**
 * Celé číslo z prostředí se STRÁŽÍ: prázdná hodnota (Coolify posílá `KEY=`) i nesmysl
 * padnou na výchozí, mimo rozsah se ořízne. Holé `parseInt(env ?? '…')` by z prázdné
 * hodnoty udělalo NaN a setInterval(NaN) = tik každou milisekundu.
 */
function celeCislo(klic: string, vychozi: number, min: number, max: number): number {
  const surove = (process.env[klic] ?? '').trim();
  if (surove === '') return vychozi;
  const n = Number(surove);
  if (!Number.isInteger(n)) return vychozi;
  return Math.min(Math.max(n, min), max);
}

export { log, safeLog };
