/**
 * svc-source-broker — configuration
 *
 * 12-factor pattern: all secrets and endpoint URLs come from environment
 * variables. Mirrors svc-github-app / svc-stripe configuration shape.
 *
 * NO DB row for source-api integration metadata. NO external secret vault.
 * Just env vars + this typed config object.
 */
import { klicZProstredi, type KlicTrezoru } from './lib/trezor-sifra.js';

export interface SourceBrokerConfig {
  /** Aisha PostgREST endpoint (for writing audience_* RPC results) */
  postgrestUrl: string;
  /** Aisha PostgREST service-role token */
  postgrestServiceToken: string;

  /** Direct Postgres connection (for FDW setup + bulk inserts) */
  postgresUrl: string;

  /** Keycloak realm config (for verifying inbound aisha-side JWTs) */
  keycloakUrl: string;
  keycloakRealm: string;
  /**
   * Klient webu INSTANCE v Keycloaku (`OIDC_APP_CLIENT_ID`). Stráž běžného uživatele
   * (`requireUser`) na něj připíná `aud` i `azp`: token jiného klienta realmu neprojde.
   * Povinný a bez výchozí hodnoty — každý fork má jiného klienta a literál by tiše
   * připnul cizího (rozhodnutí Aisha Guru 26. 9., plán PR B O2). Mrtvé
   * `KEYCLOAK_BROKER_CLIENT_ID/SECRET/AUDIENCE` (nikdo je nečetl) jsou pryč.
   */
  oidcAppClientId: string;

  /** Source-api endpoint (GraphQL — used for auth + push-back operations) */
  sourceApiUrl: string;
  /** Source-api service-user credentials — mirror source-web 3-step login */
  sourceServiceEmail: string;
  sourceServicePassword: string;

  /** Source-api postgres connection string.
   *  Use dedicated source_crm_readonly_role with GRANT EXECUTE only on
   *  source_crm_readonly.* functions — never raw table access. */
  sourcePgUrl: string;

  /** Optional auth-handshake constants some sources require (operator-supplied) */
  sourceAuthHandshakeOutgoing: string; 
  sourceAuthHandshakeIncoming: string; 

  /** JWT cache TTL — refresh proactively before source-api expiry */
  jwtCacheTtlMs: number;

  /** Webhook shared secret — source-api signs webhook payload HMAC */
  webhookHmacSecret: string;

  /** Sync schedule (cron-ish) — used by routes/sync.ts */
  syncIntervalMs: number;
  /**
   * Interval tiku údržby trezoru relací federovaného zdroje (ADR-004): úklid prošlých nonce
   * a limitů, fronta odhlášení u zdroje. 0 = vypnuto. Výchozí 5 min — opakování odhlášení
   * se odstupňuje po minutách, 24h tik synchronizace by bylo pomalé.
   */
  federationMaintenanceIntervalMs?: number;
  /**
   * Klíč trezoru relací federovaného zdroje (ADR-004). `loadConfig` ho vyžaduje VŽDY —
   * prázdný nebo špatně tvarovaný klíč zastaví start. Volitelný je jen v typu, kvůli
   * testovacím konfiguracím sestaveným ručně.
   */
  federationVaultKey?: KlicTrezoru;

  /** Service port for inbound requests from aisha gateway */
  port: number;

  /** Pino log level */
  logLevel: string;
  /** CORS allowlist (comma-separated origins env value) for applySecurity */
  corsAllowlist: string;
  /** Rate-limit toggle for applySecurity */
  rateLimitEnabled: boolean;

  /** Aisha gateway base URL. The PRIMARY (least-privilege) way to issue a
   *  member session: the broker POSTs the verified, already-provisioned email to
   *  the gateway's `/token-exchange`, and the gateway mints the HS256 PostgREST
   *  JWT. On this path the broker NEVER holds the PostgREST signing secret and
   *  can only obtain `role=authenticated` sessions for emails that already exist
   *  in aisha — it cannot forge admin/service_role or non-existent users.
   *  Prod (Coolify): `http://gateway:3001` (same network). Local: the gateway is
   *  in a different stack, reachable via the published port
   *  (`http://host.docker.internal:57421`). */
  aishaGatewayUrl: string;
  /** Shared internal key for the gateway `/token-exchange` mint primitive
   *  (gateway reads it as INTRANET_API_KEY). Empty → the broker SKIPS the
   *  gateway and uses the local-mint fallback below. Set in prod so the
   *  least-privilege gateway path is used. */
  aishaGatewayIntranetKey: string;

  /** FALLBACK (dev/local only): aisha PostgREST JWT secret (HS256). Used only
   *  when the gateway `/token-exchange` path is unavailable (no intranet key, or
   *  gateway unreachable) so the federation stays testable end-to-end locally.
   *  Same shared secret the gateway uses. Empty disables the fallback (login
   *  returns sourceToken only). In prod, prefer leaving this UNSET and routing
   *  all minting through the gateway. */
  aishaJwtSecret: string;
  /** Issued member-session TTL in seconds (default 1h, matches PGRST_JWT_EXP). */
  aishaJwtExpSec: number;
  /** PostgREST role for federated members. Always 'authenticated' — a community
   *  member is NEVER admin/staff; RLS + is_admin_or_staff() gate the rest. */
  aishaMemberRole: string;

  /** Dev escape hatch: allow unauthenticated POST /sync/run. Default false.
   *  Production deployments MUST leave this unset — `/sync/run` will refuse
   *  external callers, but the in-process scheduler bypass (calls runOnce
   *  directly, not via HTTP) continues to work.
   *  Set BROKER_DEV_ALLOW_UNAUTHED_SYNC=true only in local dev or in CI
   *  smoke tests where no Keycloak JWT is available. */
  devAllowUnauthedSync: boolean;

  /** Source-adapter plugin seam (see @aisha/audience-types SourceAdapterModule).
   *  Path to a built ESM entry file exporting `createDataSource(): IDataSource`;
   *  the plugin host dynamic-imports it at boot and registers the adapter in
   *  the SourceRegistry. Empty (default) → no plugin is loaded and every story
   *  resolves to the NullDataSource ("not configured", 501) — live source
   *  reads stay OPTIONAL exactly like a missing LLM key. The entry path is
   *  deploy-time operator configuration, not user input. */
  sourceAdapterPluginEntry?: string;
  /** Story UUID the plugin's adapter is dispatched under (config.storyId).
   *  Used when the adapter package does not hard-code its own storyId — the
   *  binding between a deployment's source story and the adapter is deployment
   *  config, not package code. Required (by the registry) for dispatch. */
  sourceAdapterStoryId?: string;
  /** MULTIPLE source-adapter plugins — the general form of the scalar pair above.
   *  One broker hosts several sources (e.g. Money delivery-notes AND invoices), or
   *  the SAME source entry bound to several stories (e.g. one Money URL, several
   *  accounting entities/agendy — each agenda is its own story + credential ref).
   *  Populated from SOURCE_ADAPTER_PLUGINS (JSON: [{"entry","storyId"}, …]); the
   *  scalar SOURCE_ADAPTER_PLUGIN_ENTRY/STORY_ID pair remains a back-compat
   *  single-entry shorthand and is used when this list is empty. */
  sourceAdapterPlugins?: Array<{ entry: string; storyId: string }>;

  /** local-ingest (li-driver) DROP LOCATION — the directory the broker ticks in
   *  PULL mode (recommended, no egress): the `ingest-out` volume surfaced
   *  read-only, or a synced object drop. Each `export/<export_id>/` bundle
   *  carries a manifest.json (cursor unit) + verify-gated *.jsonl artifacts. The
   *  driver reads the manifest, verifies sha256 + verify-result, and upserts
   *  idempotently via the li_* / KB SECURITY DEFINER RPCs. Empty (default) →
   *  the li-driver is NOT scheduled (source stays OPTIONAL exactly like a missing
   *  plugin). AISHA_EXPORT_PUSH_URL stays unset in pull mode (no egress from the
   *  ingest container). Deploy-time operator config, never user input. */
  /** API ingestu — cíl push lane. Prázdné = lane vypnutá (jako drop dir). */
  ingestApiUrl?: string;
  /** Token ingestu. Prázdný při nastavené adrese = hlasitý pád, ne přeskok. */
  ingestApiToken?: string;
  /** Adresa `svc-money`. Pověření agend drží ONO, ne broker. */
  moneyApiUrl?: string;
  moneyApiToken?: string;

  localIngestDropDir?: string;
  /** li-driver tick interval (ms). 0 (or unset) disables even when a drop dir is
   *  set. loadConfig() always populates it; optional so inline test configs and
   *  forks that predate this field still satisfy the type. */
  localIngestIntervalMs?: number;
}

/**
 * Číselná proměnná, kde PRÁZDNO znamená „nenastaveno", ne „nula".
 *
 * ⛔ `Number('')` NENÍ `NaN`, je to `0` — a `?? default` hlídá jen `undefined`,
 * ne prázdný řetězec. Klíč deklarovaný s prázdnou hodnotou (v `.env` běžný stav)
 * tak dá nulu a výchozí hodnota se nikdy nepoužije. Naměřeno 2026-09-02 na
 * `SPA_OTP_SKEW` ve `svc-knock` (PR #335); táž třída tady.
 *
 * Výslovná `'0'` ZŮSTÁVÁ nulou — nulu napsal člověk a je to úmysl.
 */
export function num(v: string | undefined, d: number): number {
  const t = (v ?? '').trim();
  if (t === '') return d;
  const n = Number(t);
  return Number.isFinite(n) ? n : d;
}

/**
 * Klíč trezoru relací: platformní tajemství jako SOURCE_WEBHOOK_HMAC_SECRET, tedy povinné
 * BEZ OHLEDU NA DRÁHU. Compose ho záměrně nevynucuje `${…:?}` (ta pojistka by ho zapekla
 * do build-time množiny), takže doručení hlídá read-back sync-envs NAŠÍ instance — a start
 * tady hlídá každou instanci, i fork bez našeho sync-envs. Hodnota se do hlášky nikdy nedá.
 */
function federationVaultKey(): KlicTrezoru {
  try {
    return klicZProstredi(process.env);
  } catch (e) {
    throw new Error(
      `${e instanceof Error ? e.message : 'FEDERATION_VAULT_KEY je neplatný'}. `
      + 'Klíč trezoru relací (ADR-004) je platformní tajemství: generate-secrets.mjs ho emituje, '
      + 'cold-start ho zapíše do .env.coolify a coolify-sync-envs.sh ho doručí aplikaci brokeru. '
      + 'Prázdný znamená selhané doručení, ne vypnutou federaci.');
  }
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

/**
 * Per-lane required env.
 *
 * The broker hosts TWO INDEPENDENT lanes and must be able to boot on either one
 * alone:
 *
 *   federation lane   — SOURCE_API_URL + SOURCE_PG_URL (an external source app)
 *   drop-replay lane  — LOCAL_INGEST_DROP_DIR (local-ingest export bundles)
 *
 * server.ts already treats them as separate failure domains ("one bad drop never
 * touches the source sync and vice-versa") and starts li-driver only when its own
 * env is set. Boot, however, used to hard-require the federation vars
 * unconditionally — so a drop-only deployment could never start, which made
 * li-driver (the ONLY writer into li_*) unreachable for every instance without an
 * external source app. That contradicted the shipped design twice over:
 * docs/planning/INGEST_POTOK_STACK_INTEGRATION_PLAN.md calls pull-via-broker the
 * RECOMMENDED transport, and source-read is otherwise fail-soft (NullDataSource →
 * 501 not_configured). Found 2026-07-20 while replaying an ingest bundle.
 *
 * A lane's env is required only while that lane is active, and activity is
 * DERIVED from the endpoint variable that names the lane — never from a separate
 * on/off flag that could drift out of step with it.
 */
function laneEnv(laneActive: boolean, name: string): string {
  return laneActive ? requiredEnv(name) : (process.env[name] ?? '');
}

/**
 * Parse SOURCE_ADAPTER_PLUGINS — a JSON array of {entry, storyId}. Tolerant:
 * malformed JSON or non-array → [] (the scalar pair then serves as fallback);
 * entries missing a string `entry` are dropped. Never throws — a bad env must not
 * crash boot, matching the fail-soft optionality of the whole source seam.
 */
function parseAdapterPlugins(raw: string | undefined): Array<{ entry: string; storyId: string }> {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is { entry: string; storyId?: string } =>
        !!e && typeof e === 'object' && typeof (e as { entry?: unknown }).entry === 'string')
      .map((e) => ({ entry: e.entry, storyId: typeof e.storyId === 'string' ? e.storyId : '' }));
  } catch {
    return [];
  }
}

export function loadConfig(): SourceBrokerConfig {
  const federationLane = !!process.env.SOURCE_API_URL?.trim();
  const dropLane = !!process.env.LOCAL_INGEST_DROP_DIR?.trim();
  // Neither lane = the service has nothing to do; say so at boot rather than
  // idling as a healthy container that silently drains nothing.
  if (!federationLane && !dropLane) {
    throw new Error(
      'svc-source-broker has no active lane: set SOURCE_API_URL (federation with an '
      + 'external source app) or LOCAL_INGEST_DROP_DIR (local-ingest drop replay).');
  }
  return {
    postgrestUrl: requiredEnv('POSTGREST_URL'),
    postgrestServiceToken: requiredEnv('POSTGREST_SERVICE_TOKEN'),
    postgresUrl: requiredEnv('POSTGRES_URL'),

    keycloakUrl: requiredEnv('KEYCLOAK_URL'),
    keycloakRealm: requiredEnv('KEYCLOAK_REALM'),
    oidcAppClientId: requiredEnv('OIDC_APP_CLIENT_ID'),

    sourceApiUrl: laneEnv(federationLane, 'SOURCE_API_URL'),
    // Service-level credentials are OPTIONAL: the federation contract issues
    // member JWTs via onboarding + sourceJwt(authHandshake) only (see
    // docs/audience/ops/SOURCE_FEDERATION.md); SourceAuthManager's
    // credential login is dormant and no deployed source implements it.
    sourceServiceEmail: process.env.SOURCE_SERVICE_EMAIL ?? '',
    sourceServicePassword: process.env.SOURCE_SERVICE_PASSWORD ?? '',
    sourcePgUrl: laneEnv(federationLane, 'SOURCE_PG_URL'),

    sourceAuthHandshakeOutgoing: process.env.SOURCE_AUTH_HANDSHAKE_OUT ?? '',
    sourceAuthHandshakeIncoming: process.env.SOURCE_AUTH_HANDSHAKE_IN ?? '',

    jwtCacheTtlMs: num(process.env.SOURCE_JWT_CACHE_TTL_MS, 3_600_000), // 1h
    // Unconditional, unlike SOURCE_API_URL / SOURCE_PG_URL above. Those are
    // OPERATOR-SUPPLIED and genuinely absent on a drop-only deployment; this one
    // is PLATFORM-GENERATED (generate-secrets.mjs always emits it), so it is
    // present whichever lane is armed. Treating it as lane-specific looked right
    // and was wrong: it turned a delivery failure — the value never reached
    // .env.coolify — into something indistinguishable from "federation is off".
    webhookHmacSecret: requiredEnv('SOURCE_WEBHOOK_HMAC_SECRET'),
    syncIntervalMs: num(process.env.SOURCE_SYNC_INTERVAL_MS, 86_400_000), // 24h
    federationMaintenanceIntervalMs: num(process.env.FEDERATION_MAINTENANCE_INTERVAL_MS, 300_000), // 5 min
    federationVaultKey: federationVaultKey(),

    port: num(process.env.PORT, 8090),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

    devAllowUnauthedSync: process.env.BROKER_DEV_ALLOW_UNAUTHED_SYNC === 'true',

    sourceAdapterPluginEntry: process.env.SOURCE_ADAPTER_PLUGIN_ENTRY ?? '',
    sourceAdapterStoryId: process.env.SOURCE_ADAPTER_STORY_ID ?? '',
    sourceAdapterPlugins: parseAdapterPlugins(process.env.SOURCE_ADAPTER_PLUGINS),

    // ── Money → ingest (push lane) ────────────────────────────────────────
    // Rozhodnutí majitele 2026-08-29: „doklady tlačí broker přes API ingestu,
    // jen v rámci stacku, meshe". Do 2026-08-31 tu ale NEBYLA ani adresa —
    // `IngestClient` i `feedDocumentsToIngest` existovaly a nikdo je nesestrojil,
    // takže vstupní cesta ingestu neměla ŽÁDNÉHO zapisovatele (`documents: 0`).
    //
    // Prázdná adresa = lane VYPNUTÁ (jako li-driver bez drop adresáře), NE
    // tichá chyba: instance bez Money nemá důvod nic hlásit. Jakmile ale adresa
    // je a token chybí, klient padne hlasitě — pověření se NEODVOZUJE.
    ingestApiUrl: process.env.INGEST_API_URL ?? '',
    ingestApiToken: process.env.INGEST_API_TOKEN ?? '',
    // svc-money drží pověření AGEND (per port) i VPN tunel; broker zná jen jeho
    // adresu. Ta hranice je záměr: klíče k účetnictví sem nepatří.
    moneyApiUrl: process.env.SVC_MONEY_URL ?? '',
    moneyApiToken: process.env.SVC_MONEY_API_TOKEN ?? '',

    // local-ingest li-driver: pull-from-drop transport. Empty → not scheduled.
    localIngestDropDir: process.env.LOCAL_INGEST_DROP_DIR ?? '',
    localIngestIntervalMs: Number(
      process.env.LOCAL_INGEST_INTERVAL_MS ?? process.env.SOURCE_SYNC_INTERVAL_MS ?? 86_400_000
    ),

    // PRIMARY mint path: gateway /token-exchange (least-privilege).
    aishaGatewayUrl: process.env.AISHA_GATEWAY_URL ?? 'http://gateway:3001',
    // Accept either AISHA_GATEWAY_INTRANET_KEY (broker-specific) or the shared
    // INTRANET_API_KEY the gateway itself reads, so prod can set one value.
    aishaGatewayIntranetKey:
      process.env.AISHA_GATEWAY_INTRANET_KEY ?? process.env.INTRANET_API_KEY ?? '',
    // FALLBACK mint path (dev/local): broker mints HS256 itself.
    aishaJwtSecret: process.env.AISHA_JWT_SECRET ?? '',
    aishaJwtExpSec: num(process.env.AISHA_JWT_EXP_SEC, 3600),
    aishaMemberRole: process.env.AISHA_MEMBER_ROLE ?? 'authenticated',
  };
}
