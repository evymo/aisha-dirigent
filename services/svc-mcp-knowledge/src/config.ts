import { requireEnv } from '@aisha/security';
const keycloakUrl = requireEnv('KEYCLOAK_URL', { service: 'svc-mcp-knowledge', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' });
const keycloakRealm = requireEnv('KEYCLOAK_REALM', { service: 'svc-mcp-knowledge', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' });

/** svc-mcp-knowledge configuration */
/**
 * Port z prostředí se STRÁŽÍ na prázdnou hodnotu: nedoručený, prázdný nebo nečíselný
 * údaj je NaN — a NaN tu není nehoda, ale signál „cíl nedoručen" (lib/av-nahravka.ts
 * pak sken prohlásí za neprovedený a nahrání odmítne). Žádná výchozí hodnota: port
 * dodává compose vedle adresy.
 */
function portZProstredi(v: string | undefined): number {
  const t = (v ?? '').trim();
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

export const config = {
  port: parseInt(process.env.PORT ?? '3017', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  /** PostgREST */
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'svc-mcp-knowledge', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),
  postgrestJwtSecret: process.env.JWT_SECRET ?? process.env.POSTGREST_JWT_SECRET ?? '',

  /** Keycloak OIDC */
  keycloakUrl,
  keycloakRealm,
  kcIssuer: process.env.KC_ISSUER ?? `${keycloakUrl}/realms/${keycloakRealm}`,
  jwksUrl: process.env.KC_JWKS_URL ?? `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/certs`,
  /**
   * Klienti realmu, jejichž tokenům `/mcp` věří.
   *
   * ⛔ ŽÁDNÝ VÝČET V KÓDU. Do 2026-10-04 tu stálo `?? 'aisha-app,aisha-dirigent-device'`
   * a compose jádra službě proměnnou nepředával — platil tedy výčet z kódu, DRUHÝ domov
   * vedle deklarace realmu. Klient instance (overlay) ani nový platformní klient se do něj
   * nedostal a přihlášení končilo 403 „Keycloak client not allowed“.
   *
   * Hodnotu skládá `aisha-env-doctor` z deklarovaných OIDC klientů (platformní realm
   * + instanční overlay) — táž, kterou dostává gateway. Když chybí, služba nenastartuje:
   * nevím-li, komu věřit, není to důvod si tipnout. Seznam bez jediného jména (např. `,`)
   * projde startem, ale nevěří nikomu (auth.ts `isAllowedClient`).
   */
  kcAllowedClients: requireEnv('KC_ALLOWED_CLIENTS', {
    service: 'svc-mcp-knowledge',
    why: 'Komu /mcp věří, je vlastnost NASAZENÍ — skládá ji env-doctor z deklarovaných OIDC klientů.',
  })
    .split(',')
    .map((client) => client.trim())
    .filter(Boolean),

  // Klíč OpenAI se tu NEČTE (2026-10-02): bere se za běhu z trezoru instance
  // (lib/credentials.ts, administrace „Poskytovatelé AI a tokeny").
  // ⛔ `embeddingModel: EMBEDDING_MODEL ?? 'text-embedding-3-small'` tu byl do 2026-09-13:
  // literální model (1536) pro sloupce vector(1024). Embedding model je vlastnost
  // korpusového PROSTORU a vybírá ho resolver (fn_resolve_embedding_model_for_space),
  // ne konfigurace služby — viz lib/embed-query-in-space.ts.

  /** Ragnarok RAG engine */
  ragnarokUrl: process.env.RAGNAROK_URL ?? 'http://ragnarok:9696',
  ragnarokApiKey: process.env.RAGNAROK_API_KEY ?? '',
  ragnarokDefaultProjectId: 'aisha',

  /** Maestro dialog management (Alquist Insight) — debug/service-role proxy.
   *  Standardní cesta z frontendu je svc-ai-chat /story-consult, ne tato MCP route. */
  maestroUrl: process.env.MAESTRO_URL ?? 'http://maestro:8020',
  maestroApiKey: process.env.MAESTRO_API_KEY ?? '',
  maestroDefaultProjectId: process.env.INSIGHT_DEFAULT_PROJECT_ID ?? 'aisha',

  /** Default language pro Insight retrieval/dialog (BCP-47 tag). Per-request
   *  override v body.lang vyhraje. AISHA defaultně preferuje češtinu pro
   *  partner_stories, anglicky odpovídá pokud user query je anglicky. */
  insightDefaultLang: process.env.INSIGHT_DEFAULT_LANG ?? 'cs-CZ',
  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist for safeFetch (comma-separated). */
  ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

  // ── Antivir: soubor nahraný do znalostní báze se skenuje PŘED předáním enginu ──
  /**
   * clamd — adresu doručuje platforma (CLAMD_HOST z identity instance, CLAMD_PORT
   * z compose). ⛔ Bez výchozí hodnoty: protokol clamd nemá autentizaci, takže
   * uhodnuté jméno by OBSAH souboru poslalo tomu, kdo na něm zrovna odpoví.
   * Nedoručený cíl = sken neproběhl = nahrání odmítnuto (lib/av-nahravka.ts).
   */
  clamdHost: process.env.CLAMD_HOST ?? '',
  clamdPort: portZProstredi(process.env.CLAMD_PORT),
  /**
   * Hlavní vypínač, týž jako u storage-auth: vypíná JEN doslovné 'false' (lokální
   * vývoj bez clamd). Cokoli jiného — i překlep — znamená skenovat.
   */
  avScanEnabled: process.env.AV_SCAN_ENABLED !== 'false',
  /**
   * V produkci vypínač NEPLATÍ jako „pusť soubor bez skenu": vypnutý sken tam nahrání
   * odmítne (lib/av-nahravka.ts). Vývojářský přepínač, kterému v produkci nic nebrání,
   * je díra, ne pohodlí (nález nezávislého čtení 2026-10-03).
   */
  produkce: process.env.NODE_ENV === 'production',
  // KONSTANTA, ne proměnná: strop skenu v synchronní cestě nahrání plyne ze stropu
  // gateway (300 s) a z časového limitu předání enginu níž (120 s), není to provozní volba.
  uploadScanBudgetMs: 60_000,

  /** AITG probe service URL (called from MCP aitg_run_test tool). */
  aitgProbesUrl: process.env.AITG_PROBES_SERVICE_URL ?? 'http://svc-aitg-probes:3041',

} as const;
