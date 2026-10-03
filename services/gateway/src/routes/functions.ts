import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { clientIpFrom, parseTrusted } from '@aisha/knock-protocol';

/**
 * /functions/v1/* → Fastify microservices router
 *
 * Maps ex-edge-function paths to internal microservice endpoints.
 * Each microservice handles its own domain (Stripe, AI, etc.).
 *
 * Route table maps function name → upstream service URL.
 * Unknown functions return 404.
 */

interface ServiceRoute {
  /** Upstream base URL */
  upstream: string;
  /** Optional path rewrite */
  rewritePath?: string;
  /**
   * Strop čekání na upstream (ms). Výchozí VYCHOZI_TIMEOUT_MS platí pro volání
   * z UI; delší jen pro plánované dávky, které běží déle záměrně a samy se hlídají.
   */
  timeoutMs?: number;
}

/** Výchozí strop čekání na upstream — interaktivní volání. */
const VYCHOZI_TIMEOUT_MS = 30_000;

/** Upstream svc-mcp-knowledge — starší alias SVC_MCP_KNOWLEDGE_URL zůstává platný. */
function mcpUpstream(): string {
  const v = process.env.MCP_SERVICE_URL;
  if (v && v.trim()) return v.trim();
  return vyzadovanaAdresa('SVC_MCP_KNOWLEDGE_URL', 'svc-mcp-knowledge');
}

/**
 * Function name → microservice routing table.
 * Will be expanded as microservices are implemented.
 */
/**
 * Adresa jiné služby se NEHÁDÁ.
 *
 * ⛔ NAMĚŘENO 2026-08-19. Dřív tu stálo `?? 'http://aisha-<služba>:port'` —
 * dvojí vada: jméno CIZÍ instance (`aisha`, my jsme `riq`) a TICHÝ default.
 * Když proměnná dorazí, funguje to a nikdo nic nepozná; když nedorazí, služba
 * se mlčky připojí jinam. A na sdíleném Coolify hostiteli `aisha-keycloak`
 * NENÍ neexistující jméno — je to skutečný cizí kontejner, takže by se identita
 * tiše zaměnila místo hlasitého selhání.
 *
 * Chybějící adresa proto službu zastaví PŘI STARTU, u zdroje — ne o tři vrstvy
 * dál na záhadném 401 nebo timeoutu. Prázdný řetězec je totéž co chybějící.
 */
function vyzadovanaAdresa(klic: string, kSluzbe: string): string {
  const v = process.env[klic];
  if (v && v.trim()) return v.trim();
  throw new Error(
    `${klic} není nastavené (adresa služby ${kSluzbe}) — adresa se NEHÁDÁ.\n` +
      `  Výchozí hodnota by ukázala na kontejner JINÉ instance; na sdíleném hostiteli\n` +
      `  by to byla cizí běžící služba, tedy tichá záměna identity.\n` +
      `  Doručuje ji cold-start (scripts/coolify-sync-envs.sh) z .env.coolify.`,
  );
}

/** Upstream svc-matrix — starší alias SVC_MATRIX_URL zůstává platný. */
function matrixUpstream(): string {
  const v = process.env.MATRIX_SERVICE_URL ?? process.env.SVC_MATRIX_URL;
  if (v && v.trim()) return v.trim();
  return vyzadovanaAdresa('MATRIX_SERVICE_URL', 'svc-matrix');
}

export const ROUTE_TABLE: Record<string, ServiceRoute> = {
  // Stripe
  'stripe-webhook':              { get upstream() { return vyzadovanaAdresa('STRIPE_SERVICE_URL', 'svc-stripe'); }, rewritePath: 'webhook' },
  // Legacy aliases of create-checkout-session / customer-portal — kept as valid aliases (no in-repo caller).
  'stripe-create-checkout':      { get upstream() { return vyzadovanaAdresa('STRIPE_SERVICE_URL', 'svc-stripe'); }, rewritePath: 'checkout' },
  'stripe-customer-portal':      { get upstream() { return vyzadovanaAdresa('STRIPE_SERVICE_URL', 'svc-stripe'); }, rewritePath: 'customer-portal' },
  // Admin-triggered refund — dedicated route (see svc-stripe/src/routes/refund.ts).
  'stripe-refund':               { get upstream() { return vyzadovanaAdresa('STRIPE_SERVICE_URL', 'svc-stripe'); }, rewritePath: 'refund' },

  // AI Chat (svc exposes /chat, /evaluate, /proactive, etc. — map ai-chat → /chat)
  'ai-chat':                     { upstream: config.aiChatUrl, rewritePath: 'chat' },
  // Flowboard runtime — run a saved flow in the governed sandbox (svc-ai-chat /flowboard-execute).
  'flowboard-execute':           { upstream: config.aiChatUrl, rewritePath: 'flowboard-execute' },

  // Push notifications — role-targeted broadcast (svc-push /send-push-notification).
  // NOTE: 'send-web-push' removed — dead alias; web-push is delivered by /send with send_web:true.
  'send-push-notification':      { get upstream() { return vyzadovanaAdresa('PUSH_SERVICE_URL', 'svc-push'); } },

  // Blockchain
  'blockchain-dispatch':         { get upstream() { return vyzadovanaAdresa('BLOCKCHAIN_SERVICE_URL', 'svc-blockchain'); }, rewritePath: 'dispatch' },

  // Bank
  'fio-bank-sync':               { get upstream() { return vyzadovanaAdresa('FIO_SERVICE_URL', 'svc-fio-bank'); }, rewritePath: 'sync' },

  // Home Assistant — action-dispatch route (svc-homeassistant /homeassistant-api → ha/health | ha/sync).
  'homeassistant-api':           { get upstream() { return vyzadovanaAdresa('HA_SERVICE_URL', 'svc-homeassistant'); } },

  // GitHub
  'github-app-auth':             { get upstream() { return vyzadovanaAdresa('GITHUB_SERVICE_URL', 'svc-github-app'); }, rewritePath: 'auth/token' },

  // MCP Knowledge (svc exposes /mcp — map mcp-knowledge-server → /mcp)
  'mcp-knowledge-server':        { get upstream() { return mcpUpstream(); }, rewritePath: 'mcp' },
  'ragnarok-search':             { get upstream() { return mcpUpstream(); }, rewritePath: 'ragnarok/search' },
  'ragnarok-upload':             { get upstream() { return mcpUpstream(); }, rewritePath: 'ragnarok/upload' },
  'generate-knowledge-embeddings': { get upstream() { return mcpUpstream(); }, rewritePath: 'embeddings/knowledge' },
  // Platformní dopočet vektorů živé identity (v1) — plánovač n8n WF_EMBEDDING_V1_BACKFILL.
  // ⛔ Dávka běží záměrně minuty (max_ms z n8n 540 s, služba ho sama omezí na 600 s
  // a dokončí rozpracovaný úsek). S výchozími 30 s vracela gateway každý běh 502 —
  // naměřeno na riq 2026-09-30: 9/9 běhů n8n „error“ po 30 s, služba přitom kódovala
  // dál a zapsala ~150 vektorů. Strop = strop služby + rezerva na poslední úsek.
  'backfill-knowledge-embeddings-v1': { get upstream() { return mcpUpstream(); }, rewritePath: 'embeddings/v1-backfill', timeoutMs: 630_000 },
  'generate-memory-embeddings':  { get upstream() { return mcpUpstream(); }, rewritePath: 'embeddings/memories' },
  'generate-embeddings':         { get upstream() { return mcpUpstream(); }, rewritePath: 'embeddings/rules' },
  'translate-content':           { get upstream() { return mcpUpstream(); }, rewritePath: 'translate' },

  // AI Chat — additional routes
  'ai-context-composer':         { upstream: config.aiChatUrl, rewritePath: 'context' },
  'ai-router':                   { upstream: config.aiChatUrl, rewritePath: 'router' },
  'ai-generate':                 { upstream: config.aiChatUrl, rewritePath: 'generate' },
  'ai-story-consult':            { upstream: config.aiChatUrl, rewritePath: 'story-consult' },
  'ai-proactive':                { upstream: config.aiChatUrl, rewritePath: 'proactive' },
  'ai-task':                     { upstream: config.aiChatUrl, rewritePath: 'task' },
  'aisha-callback':              { upstream: config.aiChatUrl, rewritePath: 'callback' },
  'aisha-push':                  { get upstream() { return vyzadovanaAdresa('PUSH_SERVICE_URL', 'svc-push'); }, rewritePath: 'aisha-push' },
  'evaluate-ai-response':        { upstream: config.aiChatUrl, rewritePath: 'evaluate' },
  'list-openai-models':          { upstream: config.aiChatUrl, rewritePath: 'models/list' },
  'update-openai-key':           { upstream: config.aiChatUrl, rewritePath: 'models/openai-key' },
  'public-chat':                 { upstream: config.aiChatUrl, rewritePath: 'public-chat' },
  'discover-models':             { upstream: config.aiChatUrl, rewritePath: 'models/discover' },
  'run-benchmark':               { upstream: config.aiChatUrl, rewritePath: 'admin/benchmark' },
  'sentry-monitor':              { upstream: `http://localhost:${process.env.GATEWAY_PORT ?? '3001'}`, rewritePath: 'admin/sentry-monitor' },
  'verify-app-integrity':        { upstream: `http://localhost:${process.env.GATEWAY_PORT ?? '3001'}`, rewritePath: 'admin/verify-integrity' },

  // Stripe — additional routes
  'create-checkout-session':     { get upstream() { return vyzadovanaAdresa('STRIPE_SERVICE_URL', 'svc-stripe'); }, rewritePath: 'checkout' },
  'create-subscription-checkout': { get upstream() { return vyzadovanaAdresa('STRIPE_SERVICE_URL', 'svc-stripe'); }, rewritePath: 'subscription-checkout' },
  'customer-portal':             { get upstream() { return vyzadovanaAdresa('STRIPE_SERVICE_URL', 'svc-stripe'); }, rewritePath: 'customer-portal' },
  'check-subscription-status':   { get upstream() { return vyzadovanaAdresa('STRIPE_SERVICE_URL', 'svc-stripe'); }, rewritePath: 'check-subscription' },

  // Blockchain — additional routes
  'claim-cosmos-reward':         { get upstream() { return vyzadovanaAdresa('BLOCKCHAIN_SERVICE_URL', 'svc-blockchain'); }, rewritePath: 'claim-reward' },
  'cosmos-gov-read':             { get upstream() { return vyzadovanaAdresa('BLOCKCHAIN_SERVICE_URL', 'svc-blockchain'); }, rewritePath: 'gov' },
  'cosmos-ledger-sync':          { get upstream() { return vyzadovanaAdresa('BLOCKCHAIN_SERVICE_URL', 'svc-blockchain'); }, rewritePath: 'ledger-sync' },
  'governance-vote':             { get upstream() { return vyzadovanaAdresa('BLOCKCHAIN_SERVICE_URL', 'svc-blockchain'); }, rewritePath: 'governance/vote' },
  'record-blockchain-audit':     { get upstream() { return vyzadovanaAdresa('BLOCKCHAIN_SERVICE_URL', 'svc-blockchain'); }, rewritePath: 'audit' },

  // Push — additional routes (svc-push registers /campaigns/process + /reminders/process worker routes)
  'send-notification-campaigns': { get upstream() { return vyzadovanaAdresa('PUSH_SERVICE_URL', 'svc-push'); }, rewritePath: 'campaigns/process' },
  'send-questionnaire-reminders': { get upstream() { return vyzadovanaAdresa('PUSH_SERVICE_URL', 'svc-push'); }, rewritePath: 'questionnaire-reminders' },
  'send-reminder-notifications': { get upstream() { return vyzadovanaAdresa('PUSH_SERVICE_URL', 'svc-push'); }, rewritePath: 'reminders/process' },

  // GitHub — additional routes
  'github-repo-ops':             { get upstream() { return vyzadovanaAdresa('GITHUB_SERVICE_URL', 'svc-github-app'); }, rewritePath: 'repo-ops' },
  'github-webhook-bridge':       { get upstream() { return vyzadovanaAdresa('GITHUB_SERVICE_URL', 'svc-github-app'); }, rewritePath: 'webhook' },

  // Health AI analysis
  'analyze-health-document':     { get upstream() { return vyzadovanaAdresa('HEALTH_AI_SERVICE_URL', 'svc-health-ai'); }, rewritePath: 'analyze-document' },
  'analyze-wearable-sync':       { get upstream() { return vyzadovanaAdresa('HEALTH_AI_SERVICE_URL', 'svc-health-ai'); }, rewritePath: 'analyze-wearable-sync' },
  // AI-generated lab-test panel recommendation (svc-ai-chat /lab-recommendation).
  'ai-lab-recommendation':       { upstream: config.aiChatUrl, rewritePath: 'lab-recommendation' },

  // Health documents — signed upload/download preflight (storage-auth PHI pipeline)
  'upload-health-document-preflight': { get upstream() { return vyzadovanaAdresa('STORAGE_AUTH_URL', 'storage-auth'); }, rewritePath: 'upload-preflight' },
  // Field evidence — a photo taken AT the thing being documented (handover at the
  // tailgate, meter on a wall). Same storage-auth route; the bucket in the body
  // decides which authorization RPC guards it, so this is a name for the caller,
  // not a second pipeline.
  'upload-entity-evidence-preflight': { get upstream() { return vyzadovanaAdresa('STORAGE_AUTH_URL', 'storage-auth'); }, rewritePath: 'upload-preflight' },
  'download-health-document':    { get upstream() { return vyzadovanaAdresa('STORAGE_AUTH_URL', 'storage-auth'); }, rewritePath: 'download' },

  // LiveKit
  'create-livekit-token':        { get upstream() { return vyzadovanaAdresa('LIVEKIT_SERVICE_URL', 'svc-livekit'); }, rewritePath: 'create-token' },
  'livekit-recording':           { get upstream() { return vyzadovanaAdresa('LIVEKIT_SERVICE_URL', 'svc-livekit'); }, rewritePath: 'recording' },

  // Matrix — appservice sink (Synapse) + user-facing client operations
  'matrix-token-exchange':       { get upstream() { return matrixUpstream(); }, rewritePath: 'token-exchange' },
  'matrix-webhook':              { get upstream() { return matrixUpstream(); }, rewritePath: 'webhook' },
  'matrix-client-ops':           { get upstream() { return matrixUpstream(); }, rewritePath: 'client-ops' },

  // Communications (SMS/OTP) — svc-communications registers /send-sms-otp + /verify-sms-otp
  'send-sms-otp':                { get upstream() { return vyzadovanaAdresa('COMMS_SERVICE_URL', 'svc-communications'); }, rewritePath: 'send-sms-otp' },
  'verify-sms-otp':              { get upstream() { return vyzadovanaAdresa('COMMS_SERVICE_URL', 'svc-communications'); }, rewritePath: 'verify-sms-otp' },

  // Packeta logistics
  'packeta-api':                 { get upstream() { return vyzadovanaAdresa('PACKETA_SERVICE_URL', 'svc-packeta'); } },

  // Plugin system
  'plugin-host':                 { get upstream() { return vyzadovanaAdresa('PLUGIN_SERVICE_URL', 'svc-plugin-system'); }, rewritePath: 'execute' },
  'plugin-registry':             { get upstream() { return vyzadovanaAdresa('PLUGIN_SERVICE_URL', 'svc-plugin-system'); }, rewritePath: 'registry' },

  // Web artifact pipeline (story-driven design ingest, scrape, redesign)
  'web-artifact-parse':          { get upstream() { return vyzadovanaAdresa('WEB_ARTIFACT_SERVICE_URL', 'svc-web-artifact'); }, rewritePath: 'parse' },
  'web-artifact-seed-default':   { get upstream() { return vyzadovanaAdresa('WEB_ARTIFACT_SERVICE_URL', 'svc-web-artifact'); }, rewritePath: 'seed-default' },
  'web-artifact-health':         { get upstream() { return vyzadovanaAdresa('WEB_ARTIFACT_SERVICE_URL', 'svc-web-artifact'); }, rewritePath: 'health' },

  // Gateway-internal routes (backward compat — these are handled by /internal/* routes)
  'deployment-executor':         { upstream: `http://localhost:${process.env.GATEWAY_PORT ?? '3001'}`, rewritePath: 'internal/deployment-executor' },
  'dev-patch':                   { upstream: `http://localhost:${process.env.GATEWAY_PORT ?? '3001'}`, rewritePath: 'internal/dev-patch' },
  'auth-send-email':             { upstream: `http://localhost:${process.env.GATEWAY_PORT ?? '3001'}`, rewritePath: 'internal/auth-send-email' },

};

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const body = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(body).set(buffer);
  return body;
}

function buildUpstreamRequestBody(req: FastifyRequest): string | ArrayBuffer | undefined {
  if (['GET', 'HEAD'].includes(req.method)) return undefined;

  const ct = (req.headers['content-type'] ?? '').toLowerCase();
  const isJson = ct.includes('application/json') || ct === '';
  if (isJson) return JSON.stringify(req.body ?? {});

  if (Buffer.isBuffer(req.body)) return bufferToArrayBuffer(req.body);
  if (typeof req.body === 'string') return req.body;
  if (req.body == null) return undefined;

  return JSON.stringify(req.body);
}

/**
 * Hlavičky, které proxy předává službě.
 *
 * ⛔ NAMĚŘENO 2026-09-14: proxy předávala jen authorization, content-type
 * a x-request-id. Protokol MCP (Streamable HTTP) ale nese stav v hlavičkách —
 * `accept` (klient ohlašuje, že umí JSON i SSE), `mcp-protocol-version`
 * (vyjednaná verze, posílá se po initialize) a `mcp-session-id` (relace, pokud
 * ji server vydá). Bez nich služba nepozná, s jakou verzí protokolu mluví.
 * Jedno místo pro obě proxy cesty — dvě kopie téhož výčtu se rozejdou.
 */
export const PREDAVANE_HLAVICKY = [
  'authorization',
  'content-type',
  'x-request-id',
  'accept',
  'mcp-protocol-version',
  'mcp-session-id',
] as const;

const duveryhodneProxy = parseTrusted(config.trustedProxies);

export function hlavickyProUpstream(req: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const jmeno of PREDAVANE_HLAVICKY) {
    const hodnota = req.headers[jmeno];
    if (typeof hodnota === 'string' && hodnota !== '') headers[jmeno] = hodnota;
  }
  // ⛔ NAMĚŘENO 2026-09-16: upstreamy za /functions (svc-plugin-system a spol.)
  // mají rate-limit klíčovaný `ip:${req.ip}`, ale gateway jim adresu klienta
  // NEPŘEDÁVALA — viděly jen gateway. Všichni uživatelé tak sdíleli JEDEN kbelík
  // (plugin-system: 30/min pro celou instanci).
  //
  // Posílá se adresa, kterou gateway SPOČÍTALA (zprava přes vlastní proxy,
  // `clientIpFrom` — týž výpočet jako její vlastní rate-limit a dveře), ne
  // syrová hlavička: tu si první položku napíše návštěvník sám. Neznámý klient
  // (`null`) = hlavička se nepošle a upstream spadne na adresu gateway, jako dřív.
  const klient = clientIpFrom(req.headers['x-forwarded-for'], duveryhodneProxy);
  if (klient) headers['x-forwarded-for'] = klient;
  return headers;
}

export const functionsProxy: FastifyPluginAsync = async (app: FastifyInstance) => {

  /**
   * ALL /functions/v1/:functionName/*
   *
   * Extracts function name from URL and routes to appropriate microservice.
   */
  app.all('/:functionName', async (req: FastifyRequest, reply: FastifyReply) => {
    const { functionName } = req.params as { functionName: string };
    const route = ROUTE_TABLE[functionName];

    if (!route) {
      return reply.status(404).send({
        error: 'function_not_found',
        message: `Unknown function: ${functionName}`,
      });
    }

    // Forward the request to the microservice, preserving the query string.
    const qs = req.raw.url && req.raw.url.includes('?') ? req.raw.url.slice(req.raw.url.indexOf('?')) : '';
    const upstreamUrl = `${route.upstream}/${route.rewritePath ?? functionName}${qs}`;

    try {
      const headers = hlavickyProUpstream(req);

      const upstreamRes = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: buildUpstreamRequestBody(req),
        signal: AbortSignal.timeout(route.timeoutMs ?? VYCHOZI_TIMEOUT_MS),
      });

      // Stream response back
      const responseHeaders: Record<string, string> = {};
      upstreamRes.headers.forEach((v, k) => {
        if (!['transfer-encoding', 'connection'].includes(k.toLowerCase())) {
          responseHeaders[k] = v;
        }
      });

      const body = await upstreamRes.arrayBuffer();
      return reply
        .status(upstreamRes.status)
        .headers(responseHeaders)
        .send(Buffer.from(body));
    } catch (err) {
      req.log.error({ err, functionName, upstream: upstreamUrl }, 'Functions proxy error');
      return reply.status(502).send({
        error: 'upstream_error',
        message: `Failed to reach service for ${functionName}`,
      });
    }
  });

  /**
   * ALL /functions/v1/:functionName/*
   * Forwards arbitrary-depth sub-paths (e.g. cosmos-gov-read/cosmos/gov/v1/proposals,
   * mcp-knowledge-server/tools) to the upstream service, preserving the query string.
   */
  app.all('/:functionName/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const { functionName } = req.params as { functionName: string };
    const subpath = (req.params as Record<string, string>)['*'] ?? '';
    const route = ROUTE_TABLE[functionName];

    if (!route) {
      return reply.status(404).send({
        error: 'function_not_found',
        message: `Unknown function: ${functionName}`,
      });
    }

    const qs = req.raw.url && req.raw.url.includes('?') ? req.raw.url.slice(req.raw.url.indexOf('?')) : '';
    const upstreamBase = `${route.upstream}/${route.rewritePath ?? functionName}`;
    const upstreamUrl = subpath ? `${upstreamBase}/${subpath}${qs}` : `${upstreamBase}${qs}`;

    try {
      const headers = hlavickyProUpstream(req);

      const upstreamRes = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: buildUpstreamRequestBody(req),
        signal: AbortSignal.timeout(route.timeoutMs ?? VYCHOZI_TIMEOUT_MS),
      });

      const responseHeaders: Record<string, string> = {};
      upstreamRes.headers.forEach((v, k) => {
        if (!['transfer-encoding', 'connection'].includes(k.toLowerCase())) {
          responseHeaders[k] = v;
        }
      });

      const body = await upstreamRes.arrayBuffer();
      return reply
        .status(upstreamRes.status)
        .headers(responseHeaders)
        .send(Buffer.from(body));
    } catch (err) {
      req.log.error({ err, functionName, subpath }, 'Functions proxy error');
      return reply.status(502).send({
        error: 'upstream_error',
        message: `Failed to reach service for ${functionName}/${subpath}`,
      });
    }
  });
};
