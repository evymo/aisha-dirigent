import { requireEnv } from '@aisha/security';
import { odvodPresmerovani } from './auth/presmerovani.js';

/** Adresy přihlášení a allowlist přesměrování — pravidla v auth/presmerovani.ts. Jména se čtou
 *  VÝSLOVNĚ (`process.env.X`), ne předáním celého prostředí: brána gateway-env-v-compose hledá
 *  čtení podle jména — bez toho by neviděla, že tyhle klíče musí doručit compose. */
const presmerovani = odvodPresmerovani({
  NODE_ENV: process.env.NODE_ENV,
  PUBLIC_URL: process.env.PUBLIC_URL,
  FRONTEND_URL: process.env.FRONTEND_URL,
  ALLOWED_REDIRECT_URIS: process.env.ALLOWED_REDIRECT_URIS,
  API_DOMAIN_PUBLIC: process.env.API_DOMAIN_PUBLIC,
  APP_DOMAIN: process.env.APP_DOMAIN,
});
/**
 * Environment configuration with typed defaults.
 * All config comes from environment variables — no hardcoded secrets.
 */
/**
 * Adresa vnitřní služby — POVINNÁ, nedosazuje se.
 *
 * ⛔ NAMĚŘENO 2026-08-19. Tady stálo `?? 'http://postgrest:3000'` a
 * `?? 'http://keycloak:8080'` — OBECNÁ jména bez prefixu instance. Na sdíleném
 * hostiteli běží víc instancí vedle sebe, takže takové jméno buď nerozliší nic,
 * nebo (hůř) trefí kontejner CIZÍ instance. Produkce má správně
 * `http://<prefix>-keycloak:80`, takže fallback nikdy nevystřelil — a právě
 * proto by se na něj přišlo až ve chvíli, kdy proměnná jednou chybět bude.
 *
 * Realm ani client id se sem NEPŘIDÁVAJÍ: `aisha` a `aisha-app` jsou platformní
 * identifikátory sdílené napříč instancemi (ověřeno v SoT RIQ), ne adresy.
 */
function vyzadovanaAdresa(klic: string, kSluzbe: string): string {
  const v = process.env[klic];
  if (v && v.trim()) return v.trim();
  throw new Error(
    `${klic} není nastavené (adresa služby ${kSluzbe}) — adresa se NEHÁDÁ: ` +
      `obecné jméno bez prefixu instance na sdíleném hostiteli trefí cizí instanci, nebo nic.`,
  );
}

export const config = {
  /** Gateway HTTP port */
  port: parseInt(process.env.GATEWAY_PORT ?? '3001', 10),

  /** Gateway host */
  host: process.env.GATEWAY_HOST ?? '0.0.0.0',

  /** Log level */
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',

  // ── Upstream services ──

  /** PostgREST URL (internal) */
  postgrestUrl: vyzadovanaAdresa('POSTGREST_URL', 'postgrest'),

  /** Keycloak base URL (internal) */
  keycloakUrl: vyzadovanaAdresa('KEYCLOAK_URL', 'keycloak'),

  /**
   * Vnější zdrojová aplikace (federace) — VOLITELNÝ upstream.
   *
   * ⛔ TÁŽ ADRESA UŽ V REPU BYLA. První verze tohohle kódu zavedla vlastní
   * `<FORK>_API_URL`, přestože `SOURCE_API_URL` existuje a je nastavená:
   * `svc-source-broker` na ni volá `${sourceApiUrl}/graphql/` a
   * `coolify-story-init.sh` podle ní vůbec rozhoduje, jestli se federační
   * služba nasadí. Dva zapisovatelé jedné pravdy — přesně to, co se jinde
   * v tomhle repu opravuje. Proměnná se proto NEZAKLÁDÁ, sdílí se.
   *
   * ⛔ NENÍ TO `vyzadovanaAdresa`, a to schválně. Federace je opt-in: obecná
   * AISHA instance žádnou zdrojovou aplikaci nemá a brána jí kvůli tomu nesmí
   * odmítnout nastartovat. Zároveň se adresa NEHÁDÁ — bez proměnné je hodnota
   * `null` a routa to řekne nahlas (503 s důvodem).
   *
   * Nenastaveno = schopnost chybí. To je jiný stav než „nastaveno špatně".
   */
  sourceApiUrl: process.env.SOURCE_API_URL?.trim() || null,

  /** Keycloak realm */
  keycloakRealm: requireEnv('KEYCLOAK_REALM', { service: 'gateway', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' }),

  /** Keycloak issuer expected in browser/device-code tokens.
   *  `||` (not `??`) so an EMPTY env value (e.g. the e2e compose forwarding an
   *  unset KC_ISSUER as "") falls back to the internal default instead of
   *  producing `new URL('')` → gateway crash-loop. */
  kcIssuer:
    process.env.KC_ISSUER?.trim() ||
    `${vyzadovanaAdresa('KEYCLOAK_URL', 'keycloak')}/realms/${requireEnv('KEYCLOAK_REALM', { service: 'gateway', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' })}`,

  /** Keycloak JWKS endpoint used for gateway-side JWT verification (empty-safe). */
  kcJwksUrl:
    process.env.KC_JWKS_URL?.trim() ||
    `${vyzadovanaAdresa('KEYCLOAK_URL', 'keycloak')}/realms/${requireEnv('KEYCLOAK_REALM', { service: 'gateway', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' })}/protocol/openid-connect/certs`,

  /**
   * OIDC clients accepted before minting PostgREST JWTs.
   *
   * ⛔ ŽÁDNÝ VÝČET V KÓDU. Do 2026-09-01 tu stálo
   * `?? 'aisha-app,aisha-dirigent-device'` — dosazený literál, který HÁDAL
   * fakt o světě: kdo se v téhle instanci smí ověřovat. Naměřeno 2026-09-01:
   * nasazená instance deklaruje tři vlastní klienty a na seznamu
   * nebyl ANI JEDEN, zatímco tam byli dva platformní, které ta instance nemá.
   * Projevilo by se to jako `keycloak_client_not_allowed` — „přihlášení
   * nefunguje" bez souvislosti s příčinou.
   *
   * Hodnotu skládá `aisha-env-doctor` z DEKLARACÍ klientů (platformní realm
   * + instanční overlay), takže pokrývá každou implementaci sama. Když chybí,
   * nevíme komu věřit — a to je důvod nenastartovat, ne důvod si tipnout.
   */
  kcAllowedClients: requireEnv('KC_ALLOWED_CLIENTS', {
    service: 'gateway',
    why: 'Komu brána věří, je vlastnost NASAZENÍ — skládá ji env-doctor z deklarovaných OIDC klientů.',
  }).split(',').map((v) => v.trim()).filter(Boolean),

  /**
   * OIDC client(s) accepted SPECIFICALLY on the /intranet/* endpoints (S2 R2) —
   * the appsmith intranet oauth2-proxy client (<OIDC_CLIENT_PREFIX>appsmith-intranet-proxy).
   * Deliberately NARROWER than kcAllowedClients: a token minted for the SPA or a
   * device client must NOT be accepted here. Empty by default → fail-loud (the
   * intranet endpoints reject every token until the operator wires this env),
   * honouring least-privilege. Accepts KC_INTRANET_ALLOWED_CLIENTS (canonical,
   * comma-separated) or the singular INTRANET_OIDC_CLIENT alias.
   */
  kcIntranetAllowedClients: (process.env.KC_INTRANET_ALLOWED_CLIENTS ?? process.env.INTRANET_OIDC_CLIENT ?? '').split(',').map((v) => v.trim()).filter(Boolean),

  /**
   * Single cold-start switch for the whole intranet (Appsmith "Story Intra")
   * surface (H1 / W4-03). The SAME `INTRANET_ENABLED` token gates BOTH this
   * gateway's `/intranet` route registration AND the intranet app deploy
   * (config/services.json), so the intranet cannot be half-deployed (app up but
   * gateway route ungated, or vice versa). Default off — an operator opts in.
   */
  intranetEnabled: process.env.INTRANET_ENABLED === 'true',

  /** HS256 secret used by PostgREST for DB/RPC authorization */
  postgrestJwtSecret: process.env.JWT_SECRET ?? '',

  /** Storage Auth service URL */
  storageAuthUrl: process.env.STORAGE_AUTH_URL ?? 'http://storage-auth:3005',

  /**
   * svc-ai-chat URL — the AISHA Omni /v1 model facade (server.ts v1ChatRoutes:
   * /v1/messages, /v1/chat/completions, /v1/models). Reached at /v1/* via the
   * streaming omni proxy (routes/v1.ts) AND per-function via functions.ts.
   * ⛔ 2026-08-24: `?? 'http://svc-ai-chat:3011'` odsud zmizelo. To jméno
   * nenese prefix instance a NAVÍC schovávalo, že proměnná se do gateway
   * nikdy nedoručovala — naměřeno: `AI_CHAT_SERVICE_URL` v kontejneru CHYBĚLA
   * a `svc-ai-chat:3011` se odtud ani nepřeložilo (stack byl mimo provoz od
   * 12:16 předchozího dne). Dosazení tedy nebylo záloha, ale MASKA výpadku.
   * Compose jádra teď adresu skládá z identity instance.
   */
  aiChatUrl: vyzadovanaAdresa('AI_CHAT_SERVICE_URL', 'svc-ai-chat'),

  /** Redis WS Gateway URL */
  wsGatewayUrl: process.env.WS_GATEWAY_URL ?? 'http://ws-gateway:3002',

  /** Event Worker URL */
  eventWorkerUrl: process.env.EVENT_WORKER_URL ?? 'http://event-worker:3003',

  // ── Auth ──

  /** Keycloak OIDC discovery endpoint */
  get oidcDiscoveryUrl(): string {
    return `${this.keycloakUrl}/realms/${this.keycloakRealm}/.well-known/openid-configuration`;
  },

  /** Keycloak token endpoint */
  get oidcTokenUrl(): string {
    return `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/token`;
  },

  /** Keycloak auth endpoint */
  get oidcAuthUrl(): string {
    return `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/auth`;
  },

  /** OIDC client ID for the gateway callback proxy */
  oidcClientId: process.env.OIDC_CLIENT_ID ?? 'aisha-app',

  /** OIDC client secret */
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET ?? '',

  /** Public URL of the gateway (callback redirect_uri). Odvozená z API_DOMAIN_PUBLIC; v produkci bez
   *  vývojářského výchozího — prázdná = trasy přihlášení odpoví 503 (auth/presmerovani.ts). */
  publicUrl: presmerovani.publicUrl,

  /** Frontend URL (post-auth redirects). Odvozená z APP_DOMAIN; v produkci bez vývojářského výchozího. */
  frontendUrl: presmerovani.frontendUrl,

  /** Allowed redirect URIs after auth (prevents open redirect). ALLOWED_REDIRECT_URIS, jinak jen origin
   *  frontendu. Tokeny jdou k cíli — žádné vývojářské ani cizí přesměrovače (auth/presmerovani.ts). */
  allowedRedirectUris: presmerovani.allowedRedirectUris,

  // ── CORS ──

  /** Allowed origins for CORS.
   *  Single source of truth: ALLOWED_ORIGINS from config/domains.env (via
   *  cold-start + coolify-deploy-init.sh). All variables are loaded dynamically
   *  from the topology SoT. Legacy fallback to CORS_ORIGINS for old deploys.
   */
  corsOrigins: (
    process.env.ALLOWED_ORIGINS ||
    process.env.CORS_ORIGINS ||
    // Only safe localhost defaults here. The real public origins (web.aisha etc.)
    // come dynamically via ALLOWED_ORIGINS from the domains SoT / deploy scripts.
    'http://localhost:5173,http://localhost:8100'
  ).split(','),

  // ── Kdo je klient ──

  /**
   * Adresy NAŠICH prvků v cestě (Coolify proxy, edge, pfSense) — přesné adresy
   * nebo IPv4 CIDR, oddělené čárkou.
   *
   * Klient se z `x-forwarded-for` bere ZPRAVA a tyhle položky se přeskakují;
   * podrobné odůvodnění je v `lib/client-ip.ts`. Kontejnery dostávají adresu
   * z docker sítě a ta se mění při přenasazení, proto se počítá s CIDR —
   * seznam po jedné adrese by tiše zastaral.
   *
   * Výchozí hodnota kryje jen privátní rozsahy docker sítí. Není to domněnka
   * o topologii: cokoli z veřejného internetu se tak považuje za klienta, což
   * je ten přísnější z obou omylů. Pro řízení přístupu (dveře) se prázdný
   * seznam odmítá úplně — viz `lib/client-ip.ts`.
   */
  trustedProxies: (process.env.GATEWAY_TRUSTED_PROXIES ?? '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.1')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),

  // ── Dveře (SPA) ───────────────────────────────────────────────────────────
  //
  // ⭐ VÝCHOZÍ STAV JE `off` A MUSÍ JÍM ZŮSTAT. Instance, která dveře nemá, je
  // nesmí dostat tím, že se nasadí novější obraz — zapnuly by se všude a každé
  // nasazení by se samo zamklo. Zapíná se výslovně, touž cestou jako `svc-knock`
  // (`COMPOSE_PROFILES=knock` + instanční proměnné), ne změnou kódu.
  //
  // ⭐ POŘADÍ ZAVÁDĚNÍ: `measure` → teprve pak `enforce`. Klientská adresa se
  // odvozuje z `x-forwarded-for` ZPRAVA přes `GATEWAY_TRUSTED_PROXIES`; špatně
  // nastavený seznam by zavřel dveře před správnými lidmi a vypadalo by to jako
  // porucha sítě. Měřicí režim to ukáže dřív, než začne cokoli zavírat.
  doorMode: (process.env.SPA_DOOR_MODE ?? 'off') as 'off' | 'measure' | 'enforce',

  /**
   * Kam odejde prohlížeč od zavřených dveří. Instanční hodnota z administrace,
   * ne konstanta — je to adresa TÉHLE instance, ne vlastnost platformy.
   *
   * Týká se JEN prohlížeče. API klient dostane jednoznačný 403, protože podle
   * něj pozná „jsem zamčený" a teprve v tom stavu smí nabídnout zaťukání.
   */
  doorForwardUrl: process.env.SPA_DOOR_FORWARD_URL ?? '',

  /** Databáze mapy dveří — musí souhlasit se `SPA_REDIS_DB` u `svc-knock`. */
  doorRedisDb: parseInt(process.env.SPA_REDIS_DB ?? '4', 10),

  /** Jak dlouho otvor platí. Souhlasí se `SPA_PINHOLE_TTL` u `svc-knock`. */
  doorTtlSec: parseInt(process.env.SPA_PINHOLE_TTL ?? '120', 10),
  /**
   * Kam se hlásí prodloužení/zavření nájmu adresy. TÝŽ `svc-knock`, který mapu
   * PÍŠE při zaťukání a dává verdikt dveřím — jeden vlastník mapy.
   * Prázdno = nájem se neprodlužuje (dveře jedou jen na zaťukání); nikoho to
   * nezamkne, jen se vrátí staré chování.
   */
  knockUrl: process.env.KNOCK_UPSTREAM ?? '',
} as const;

/**
 * ⛔ Pro DVEŘE se seznam našich prvků NEHÁDÁ.
 *
 * Výchozí hodnota výš je vývojářské pohodlí: zná docker sítě, o mesh skoku
 * neví. To je pro proxy a rate-limit snesitelné, pro řízení přístupu ne —
 * naměřeno 2026-08-31, že se poslední mesh skok tváří jako klient a dveře
 * pak u KAŽDÉHO požadavku z internetu vidí cizí adresu (`verdikt: closed`).
 * V `enforce` by se instance zamkla i před tím, kdo správně zaťukal.
 *
 * Stráž je vázaná na `doorMode`, ne na import: instance bez dveří (výchozí
 * `off`) se tím nespustí jinak a testy se na načtení modulu nerozsypou.
 */
if (config.doorMode !== 'off' && !(process.env.GATEWAY_TRUSTED_PROXIES ?? '').trim()) {
  throw new Error(
    'GATEWAY_TRUSTED_PROXIES není doručené, ale dveře jsou zapnuté ' +
      `(SPA_DOOR_MODE=${config.doorMode}). Seznam se pro řízení přístupu nehádá — ` +
      'kódový default nezná mesh skok a zavřel by dveře před správnými lidmi. ' +
      'Hodnotu odvozuje scripts/lib/derive-subnets.mjs a doručuje coolify-sync-envs.',
  );
}

