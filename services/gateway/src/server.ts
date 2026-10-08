import Fastify, { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { buildHelmetOptions, safeLoggerOptions } from '@aisha/security';
import { bootstrapOtel } from '@aisha/observability/otel';
import { registerMetricsPlugin } from '@aisha/observability/metrics';
import { config } from './config.js';
// Ze sdíleného balíčku, ne z vlastního `lib/`: týž výpočet klienta potřebuje
// brána, UDP listener i edge. Dvě implementace „kdo je klient" by znamenaly dvě
// pravdy o tom, komu se otevřelo.
import { clientIpFrom, parseTrusted } from '@aisha/knock-protocol';
import { createNamespacedRedis } from '@aisha/cache-redis/client';
import { registerDoorGuard } from './lib/door-guard.js';
import {
  corsOriginCallback,
  getCachedAllowedOriginsSync,
  resolveAllowedOrigins,
} from './auth/cors-origins.js';
import { healthRoute } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { restProxy } from './routes/rest.js';
import { storageProxy } from './routes/storage.js';
import { functionsProxy } from './routes/functions.js';
import { realtimeProxy } from './routes/realtime.js';
import { omniV1Proxy } from './routes/v1.js';
import { dirigentProxy } from './routes/dirigent.js';
import { chatProxy } from './routes/chat-proxy.js';
import { adminRoutes } from './routes/admin.js';
import { adminUsersRoute } from './routes/admin-users.js';
import { publicRoutes } from './routes/public.js';
import { deploymentExecutorRoutes } from './routes/deployment-executor.js';
import { devPatchRoutes } from './routes/dev-patch.js';
import { authEmailRoutes } from './routes/auth-email.js';
import { intranetRoutes } from './routes/intranet.js';
import { sourceRoutes } from './routes/source.js';
import { oauthMetadataRoutes } from './routes/oauth-metadata.js';
import { appConfigRoute } from './routes/app-config.js';
import { knockRosterRoutes, zarizeniKlicRoutes } from './routes/zarizeni-klic.js';
import { maMeshPodil } from './lib/mesh-podil.js';

// MUST be first executable line — OTel auto-instrumentations attach to
// http/fetch BEFORE any downstream HTTP client builds connection pools.
// Gateway is the trace ROOT: every request gets a fresh trace_id that the
// W3C `traceparent` header propagates to svc-* via @fastify/http-proxy.
// Exporter → Langfuse OTLP. Rollback: OTEL_SDK_DISABLED=true env.
bootstrapOtel({ serviceName: 'gateway' });

const app = Fastify({
  logger: safeLoggerOptions({
    level: config.logLevel,
    ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty' } } : {}),
  }),
  trustProxy: true,
  requestIdHeader: 'x-request-id',
  bodyLimit: 50 * 1024 * 1024, // 50MB — KB ingest uploads
});

// Pass-through parser pro multipart + binary content types. Gateway pouze
// proxiuje na microservices (které mají vlastní multipart parser, např.
// svc-mcp-knowledge → @fastify/multipart). Default Fastify by 415-failnul.
app.addContentTypeParser(
  ['multipart/form-data', 'application/octet-stream'],
  { parseAs: 'buffer' },
  (_req: FastifyRequest, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => done(null, body),
);

// ── Global plugins ──
// Belt-and-braces origin gate. @fastify/cors only declines to ADD CORS
// headers when origin is rejected; it doesn't terminate the request. And
// for /rest/v1/* @fastify/http-proxy with proxyPayloads:true forwards the
// raw OPTIONS preflight to PostgREST, which emits its own permissive
// `Access-Control-Allow-Origin: *` regardless of our gateway config.
//
// This hook MUST run BEFORE `app.register(cors, …)` so we win the race for
// the OPTIONS preflight: Fastify fires onRequest hooks in registration
// order, and we want to terminate disallowed-origin requests before either
// the cors plugin or the proxy plugin gets a chance.
//
// Same-origin and non-browser (no Origin header) traffic is untouched.
// Uses the SYNC accessor — earlier version `await`ed resolveAllowedOrigins()
// on every request, which caused a thundering-herd against PostgREST every
// 60 s (cache expiry) and surfaced as 500/503 storms in the browser under
// load. The sync accessor + background SWR refresh in cors-origins.ts means
// this hook has zero IO cost on the hot path.
app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
  const origin = req.headers.origin as string | undefined;
  if (!origin) return; // same-origin or non-browser: allow
  const allowed = getCachedAllowedOriginsSync();
  if (!allowed.has(origin)) {
    reply.header('Vary', 'Origin');
    return reply.code(403).type('application/json').send({
      statusCode: 403,
      error: 'Forbidden',
      message: `Origin ${origin} not in CORS allowlist`,
    });
  }
});

// OWASP A05 — security headers via @fastify/helmet (HSTS, X-Frame-Options,
// X-Content-Type-Options, Referrer-Policy, COOP/COEP/CORP, etc.). Registered
// BEFORE cors so that 4xx/5xx responses (CORS rejections, rate-limit) also
// carry the security headers. CSP is disabled at the gateway because each
// downstream service may have its own policy needs — we set CSP on the web
// service only (the only browser-facing surface).
await app.register(helmet, buildHelmetOptions({ enableContentSecurityPolicy: false }));

// CORS origins are the union of the static `ALLOWED_ORIGINS` list (from
// domains.env SoT via deploy machinery; legacy `CORS_ORIGINS` fallback) AND
// the hostnames stored in `public.branding_hostname_mapping`. See
// services/gateway/src/auth/cors-origins.ts for the SWR cache.
await app.register(cors, {
  origin: corsOriginCallback,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'X-Request-Id',
    'apikey', 'x-client-info', 'x-supabase-api-version',  // backward compat
    'Accept-Profile', 'Content-Profile',                  // PostgREST schema selectors
    'Prefer', 'Range',                                     // PostgREST behaviour + pagination
  ],
  // `Server-Timing` doplňuje Content-Range/X-Total-Count: bez expose ho skript
  // v prohlížeči nepřečte, takže by naměřený čas serveru zůstal jen v DevTools.
  exposedHeaders: ['Content-Range', 'X-Total-Count', 'Server-Timing'],
});

// ─── Měřitelnost zvenčí: Timing-Allow-Origin + Server-Timing ────────────────
// Extranet běží na jiném originu než API (extra.* → api.*), takže prohlížeč
// u cross-origin requestů NULUJE detailní timing v Resource Timing API. Změřeno
// 2026-07-30 na produkci: `responseStart - requestStart` vycházelo 0 a
// `transferSize` 0 u všech RPC — reálnou latenci nešlo z prohlížeče rozdělit na
// „čeká na server" vs „stahuje se 8,5 MB". Ani vlastní měřidlo to nezachrání:
// window.__AISHA_PERF vidí jen celkové trvání fetch. `Timing-Allow-Origin` to
// odemkne — a jen pro originy, které už prošly CORS allowlistem výše.
//
// `Server-Timing: gw;dur=<ms>` k tomu přidává, KOLIK z toho spotřeboval gateway
// (jwtVerify + revocation + mint + proxy); rozdíl proti celkovému trvání je síť
// + PostgREST + DB. Bez toho se „aplikace je pomalá" nedá rozdělit na vrstvy bez
// ssh na server — a hádání, kde se čeká, už jednou stálo den.
app.addHook('onRequest', async (req: FastifyRequest) => {
  (req as FastifyRequest & { _gwT0?: number })._gwT0 = performance.now();
});

// onSend, ne onResponse: po odeslání odpovědi už hlavičky měnit nelze.
app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload) => {
  const origin = req.headers.origin as string | undefined;
  if (origin && getCachedAllowedOriginsSync().has(origin)) {
    reply.header('Timing-Allow-Origin', origin);
  }
  const t0 = (req as FastifyRequest & { _gwT0?: number })._gwT0;
  if (typeof t0 === 'number') {
    reply.header('Server-Timing', `gw;dur=${(performance.now() - t0).toFixed(1)}`);
  }
  return payload;
});

// Custom keyGenerator that doesn't blow up when req.socket is null. Fastify's
// default `req.ip` getter dereferences `req.socket.remoteAddress` directly;
// when the upstream proxy (Coolify Caddy → gateway via internal docker net)
// produces a request whose socket is in a transient state, `req.ip` throws
// "Cannot read properties of null (reading 'remoteAddress')" and bubbles to
// a 500. Fall back to req.ip, then to a constant for safety.
//
// ⛔ OPRAVENO 2026-08-06: klient se bral jako `x-forwarded-for.split(',')[0]`,
// tedy PRVNÍ ZLEVA. Proxy k hlavičce jen připisují, takže první položku si
// návštěvník napíše sám — a rate-limit se tím obešel změnou hlavičky u každého
// dotazu (každý požadavek jiný kbelík = žádný limit). Klient se teď bere
// ZPRAVA přes seznam našich prvků; celé odůvodnění v `lib/client-ip.ts`.
const trustedProxies = parseTrusted(config.trustedProxies);

await app.register(rateLimit, {
  max: 200,
  timeWindow: '1 minute',
  keyGenerator: (req: FastifyRequest) => {
    const klient = clientIpFrom(req.headers['x-forwarded-for'], trustedProxies);
    if (klient) return klient;
    // `null` znamená „nevím" (hlavička chybí, je nečitelná, nebo jsou v ní samé
    // naše proxy). Pro rate-limit je adresa socketu použitelná náhrada; pro
    // řízení přístupu se na „nevím" musí zavřít, ne dosadit.
    try {
      return req.ip ?? req.socket?.remoteAddress ?? 'anonymous';
    } catch {
      return 'anonymous';
    }
  },
});

// ── Dveře (SPA) ─────────────────────────────────────────────────────────────
//
// `svc-knock` do mapy otevřených adres ZAPISOVAL, ale nikdo ji NEČETL — platné
// zaťukání tedy neotevřelo nic. Tohle je ten čtenář.
//
// Registruje se ZA rate-limitem a PŘED proxy na upstreamy: odmítnutá adresa se
// nemá dostat k ničemu, ale ani nemá obejít limit (jinak by se dalo dveřmi
// tlouct zadarmo). Při `doorMode: 'off'` se hook vůbec nezaregistruje.
if (config.doorMode !== 'off') {
  // Vlastní připojení, ne sdílené s odvoláváním tokenů: to je vědomě fail-OPEN
  // (db 2), dveře jsou fail-CLOSED (db 4). Jedno připojení pro obojí by svádělo
  // sjednotit i chování, a to jsou dvě různá rozhodnutí.
  let doorRedis: ReturnType<typeof createNamespacedRedis> = null;
  try {
    doorRedis = createNamespacedRedis({ connectionName: 'gateway-door', db: config.doorRedisDb });
  } catch (e) {
    // `null` = fail-closed. Hlásí se nahlas: tichá degradace by tady znamenala
    // zamčené dveře, které vypadají jako klid.
    app.log.error({ err: e }, 'dveře: mapu se nepodařilo otevřít — zavírá se na vše');
  }
  // ⛔ NAMĚŘENO 2026-09-02: seznam proxy MŮŽE dorazit a přesto nenést jediného
  // mesh peera — nasazená hodnota byla `…,127.0.0.1,100.64.0.0/10`, tedy samé
  // rozsahy plus loopback. Chůze zprava se pak zastaví na mesh skoku, dveře
  // vidí u KAŽDÉHO požadavku adresu našeho vlastního prvku a v `enforce`
  // zavírají přede všemi. Navenek to vypadá jako „nikdo správně neťuká".
  //
  // ⛔ PROČ TO NENÍ TVRDÁ STRÁŽ PŘI STARTU
  // Nejdřív jsem to napsal jako `throw` v `config.ts` a byla by to chyba téže
  // třídy jako PKI/mesh 2026-08: podmínka, která v dané fázi NEMŮŽE platit.
  // Core (a s ním gateway) se nasazuje ve VLNĚ 2, mesh warmup je až VLNA 5 —
  // discovery ve vlně 2 tedy ČEKANĚ nic nenajde, MESH_PEER_IPS zůstane prázdné
  // a seznam peera nenese. Tvrdá stráž by gateway shodila přesně tam, kde ji
  // ještě nemá co uspokojit, a vlna, která peery přináší, by se k opravě
  // nedostala. Odmítnout NASAZENÍ patří do preflightu, kde je fáze známá.
  //
  // Není to fallback: nic se nedosazuje a dveře na neznámého klienta zavírají
  // dál samy (`clientIpFrom` vrátí null).
  // `doorMode !== 'off'` se tu NEOPAKUJE: obklopující blok (ř. výš) ho už
  // zaručuje, a TypeScript typ uvnitř zúžil na `'measure' | 'enforce'`. Druhé
  // porovnání proto hlásil jako TS2367 — a build brány na něm padal, takže
  // `<fork>-core` se NENASADIL. Zbytečná podmínka není neškodná ozdoba.
  if (!maMeshPodil(trustedProxies)) {
    app.log.error(
      { trustedProxies, doorMode: config.doorMode },
      'dveře: seznam proxy nenese ANI JEDNU adresu mesh peera (samé rozsahy a loopback) — ' +
        'chůze zprava skončí na mesh skoku a dveře budou zavírat přede všemi. ' +
        'Peery vyjmenuje netbird-peer-discover a doručí aisha-redeploy jako MESH_PEER_IPS. ' +
        'Před vlnou mesh warmupu je tenhle stav ČEKANÝ.',
    );
  }
  registerDoorGuard(app, {
    forwardUrl: config.doorForwardUrl,
    mode: config.doorMode,
    onVerdict: (ev) => {
      // V měřicím režimu je tenhle záznam JEDINÝ výstup — proto `info`, ne
      // `debug`: měření, které se nikam nezapíše, není měření.
      // ⛔ Tahle zkratka měla SLEPÉ MÍSTO: povolený požadavek se nezapisoval,
      // takže úspěch (adresa dorazila A je otevřená) byl k nerozeznání od
      // „brána nic neměří". Doktor si přitom sám ťuká, takže by na to narazil
      // pokaždé. V `measure` se proto zapisuje VŠE — měření, které zamlčí
      // úspěšný případ, je měření se slepým místem právě tam, kam se dívá.
      if (ev.mode !== 'measure' && ev.action === 'pass' && ev.allowed) return;
      app.log.info({ dvere: ev }, 'dveře');
    },
    redis: doorRedis,
    trustedProxies,
    ttlSec: config.doorTtlSec,
  });
}

// Surface real errors to the deploy log AND ensure CORS headers are present
// on error responses. @fastify/cors only adds headers on the onRequest hook
// for SUCCESSFUL responses; when a route errors out, the default error handler
// produces a 500 without CORS headers — browser then interprets the error
// as a CORS rejection ("No 'Access-Control-Allow-Origin' header"), masking
// the real cause. We re-attach the request origin to the error reply so the
// browser can read the real { statusCode, error, message } payload.
app.setErrorHandler(async (err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
  req.log.error(
    {
      err: err.stack ?? err.message,
      url: req.url,
      method: req.method,
      origin: req.headers.origin,
    },
    'gateway unhandled error',
  );
  const origin = (req.headers.origin as string | undefined) ?? '';
  if (origin) {
    // Trust the @fastify/cors origin check: only echo back origins it would
    // have allowed. Sync accessor — no IO wait on the error path (avoids
    // amplifying outages: if DB is down we already have stale-but-valid
    // cached set; no point in blocking the error response on a refresh).
    const allowed = getCachedAllowedOriginsSync();
    if (allowed.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Vary', 'Origin');
    }
  }
  const statusCode = err.statusCode ?? 500;
  return reply.status(statusCode).send({
    statusCode,
    error: err.name || 'Internal Server Error',
    message: err.message,
  });
});

// ── Observability metrics endpoint (Phase 12 WP 0.4) ──
// Scoped to internal Prometheus scraper via backend-net (WP 3.4 segmentation).
// Public exposure on the edge would leak operational topology.
await registerMetricsPlugin(app, { serviceName: 'gateway' });

// ── Routes ──
await app.register(healthRoute);
await app.register(appConfigRoute);
await app.register(oauthMetadataRoutes);
await app.register(authRoutes, { prefix: '/auth/v1' });
// Průkaz tabletu v kiosku: ohlášení bez člověka a stav (2026-09-28).
await app.register(zarizeniKlicRoutes, { prefix: '/auth/v1' });
await app.register(restProxy, { prefix: '/rest/v1' });
await app.register(storageProxy, { prefix: '/storage/v1' });
await app.register(functionsProxy, { prefix: '/functions/v1' });
await app.register(realtimeProxy, { prefix: '/realtime/v1' });
// /v1/* → svc-ai-chat Omni model facade (the "AISHA as a model" public API,
// ask.<public_tld>/v1). Streaming (SSE) Bearer-passthrough proxy — PAT is
// validated by the facade, NOT re-gated here. See routes/v1.ts + AISHA_OMNI_GATEWAY.md §3.
await app.register(omniV1Proxy, { prefix: '/v1' });
// /dirigent/* → svc-ai-chat Dirigent supervisor (the CONTROL/supervisory channel,
// comms path ③). Bearer-passthrough proxy — the supervisor route authenticates the
// user JWT + validates story ownership itself, NOT re-gated here. Without this the
// dev relay hook's POST to ${AISHA_GATEWAY_URL}/dirigent/dispatch 404s. See routes/dirigent.ts.
await app.register(dirigentProxy, { prefix: '/dirigent' });
// /chat → svc-ai-chat governed chat (Bearer-passthrough; see routes/chat-proxy.ts)
await app.register(chatProxy, { prefix: '/chat' });
await app.register(adminRoutes, { prefix: '/admin' });
// Zakládání uživatelů z administrace — týž prefix, vlastní modul: admin.ts
// je sběrnice absorbovaných edge funkcí a uživatelská správa je vlastní téma.
await app.register(adminUsersRoute, { prefix: '/admin' });
await app.register(publicRoutes, { prefix: '/public' });

// Internal routes (absorbed edge functions — service-role only)
await app.register(deploymentExecutorRoutes, { prefix: '/internal' });
await app.register(devPatchRoutes, { prefix: '/internal' });
await app.register(authEmailRoutes, { prefix: '/internal' });
// Roster schválených zařízení pro dveře (svc-knock tahá s KNOCK_ROSTER_TOKEN).
await app.register(knockRosterRoutes, { prefix: '/internal' });

// Intranet routes (Appsmith user-scoped backend access), gated by the single
// INTRANET_ENABLED cold-start flag (H1 / W4-03) — the same token that gates the
// intranet app deploy in config/services.json, so the two sides move together.
if (config.intranetEnabled) {
  await app.register(intranetRoutes, { prefix: '/intranet' });
}

// Governed source-read proxy → svc-source-broker (decision C: the extranet
// cockpit reads the SOURCE system's live data through the gateway, never a raw client)
await app.register(sourceRoutes, { prefix: '/source' });

// ── Production env-contract check ──
// The gateway's public behaviour (OAuth callbacks, post-auth redirects, CORS)
// is composed dynamically from the domains SoT (config/domains.env pushed by
// cold-start / coolify-deploy-init). When those vars are missing in production
// the config silently falls back to localhost defaults and auth flows break
// quietly — surface that loudly at boot instead (mirrors the env-completeness
// hard-fail philosophy of local-compose-gen; warning not exit, so a degraded
// deploy stays diagnosable via /health).
if (process.env.NODE_ENV === 'production') {
  // Měří se ODVOZENÁ hodnota (auth/presmerovani.ts), ne přítomnost jména: adresy přihlášení
  // gateway skládá z API_DOMAIN_PUBLIC / APP_DOMAIN, výslovné PUBLIC_URL / FRONTEND_URL jsou
  // jen přepis operátora. Bez nich trasy přihlášení odpovídají 503 — nic se nepřesměruje jinam.
  const missing = [
    ['publicUrl (PUBLIC_URL / API_DOMAIN_PUBLIC)', config.publicUrl],
    ['frontendUrl (FRONTEND_URL / APP_DOMAIN)', config.frontendUrl],
    ['ALLOWED_ORIGINS', process.env.ALLOWED_ORIGINS],
  ]
    .filter(([, hodnota]) => !hodnota)
    .map(([jmeno]) => jmeno);
  if (missing.length > 0) {
    app.log.error(
      { missing },
      'ENV CONTRACT VIOLATION: production gateway started without domain SoT vars — ' +
        'auth routes answer 503, CORS falls back to localhost. ' +
        'Fix the Coolify app env (coolify-deploy-init pushes these from config/domains.env).',
    );
  }
}

// ── Start ──
try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Gateway listening on ${config.host}:${config.port}`);
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}
