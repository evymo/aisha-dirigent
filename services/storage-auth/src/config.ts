import { requireEnv } from '@aisha/security';
/**
 * Číslo z prostředí se stráží na PRÁZDNO, ne jen na `undefined`.
 *
 * ⛔ `Number(process.env.X ?? 200)` vypadá správně a není: `??` chytí jen
 * `undefined`/`null`. Coolify ale prázdné hodnoty zapisuje běžně, a `Number("")`
 * je 0 — strop by tiše spadl na nulu a KAŽDÉ nahrání by skončilo na 413. Vada by
 * vypadala jako „nahrávání nefunguje", ne jako „chybí proměnná".
 *
 * Týž tvar jako v svc-knock a svc-source-broker (hlídá brána
 * `cislo-z-prostredi-ma-straz`).
 */
function num(v: string | undefined, d: number): number {
  const t = (v ?? '').trim();
  if (t === '') return d;
  const n = Number(t);
  return Number.isFinite(n) ? n : d;
}

export const config = {
  port: parseInt(process.env.STORAGE_AUTH_PORT ?? '3005', 10),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',

  // ── MinIO ──
  minioEndpoint: process.env.MINIO_ENDPOINT ?? 'http://minio:9000',
  minioAccessKey: process.env.MINIO_ACCESS_KEY ?? '',
  minioSecretKey: process.env.MINIO_SECRET_KEY ?? '',
  minioRegion: process.env.MINIO_REGION ?? 'us-east-1',

  // ── PostgREST (for RLS-checked RPCs) ──
  postgrestUrl: requireEnv('POSTGREST_URL', { service: 'storage-auth', why: 'Dosazené `postgrest:3000` nenese prefix instance.' }),
  /**
   * Service-role JWT. Two uses: (1) the Bearer token storage-auth presents TO PostgREST
   * when calling a service_role RPC (e.g. record_document_av_scan_audited from the scan
   * worker); (2) the token internal callers (the MinIO event webhook) must present to
   * storage-auth — see verifyServiceRole(). Empty in dev/local without a service token.
   */
  postgrestServiceToken: (process.env.POSTGREST_SERVICE_TOKEN ?? ''),

  // ── Keycloak JWT verification ──
  keycloakUrl: requireEnv('KEYCLOAK_URL', { service: 'storage-auth', why: 'Dosazené `keycloak:8080` nenese prefix instance ani správný port.' }),
  keycloakRealm: requireEnv('KEYCLOAK_REALM', { service: 'storage-auth', why: 'Realm je deklarovaná konstanta, ne výchozí hodnota.' }),

  get jwksUrl(): string {
    return `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/certs`;
  },

  // ── imgproxy (for public bucket image transforms) ──
  imgproxyUrl: process.env.IMGPROXY_URL ?? 'http://imgproxy:8080',
  /**
   * Podpis cest imgproxy (2026-09-24). Instance má klíč i sůl z generate-secrets
   * (jádrový compose je vyžaduje `:?`), takže `/insecure/` imgproxy odmítá. Bez nich
   * doručení výřezu/převodu odpoví 501 — nic se nedosazuje. Prázdno = „nenastaveno",
   * ne výchozí hodnota.
   */
  imgproxyKey: process.env.IMGPROXY_KEY ?? '',
  imgproxySalt: process.env.IMGPROXY_SALT ?? '',

  // ── Signed URL TTLs ──
  uploadUrlTtlSeconds: parseInt(process.env.UPLOAD_URL_TTL ?? '7200', 10),    // 2 hours
  downloadUrlTtlSeconds: parseInt(process.env.DOWNLOAD_URL_TTL ?? '300', 10), // 5 minutes

  // ── Nahrání přes API (lib/nahravaci-token.ts, routes/nahrani.ts) ──
  /**
   * Veřejná adresa storage NA API (`https://<API_DOMAIN_PUBLIC>/storage/v1`),
   * odvozená derive-domains. Preflight podle ní vydá `uploadUrl`, na kterou
   * klient mimo mesh opravdu dosáhne. Prázdná = presigned URL MinIA — funguje
   * jen tam, kde je MINIO_ENDPOINT z klienta dosažitelný (lokální vývoj).
   */
  storagePublicUrl: (process.env.STORAGE_PUBLIC_URL ?? '').replace(/\/+$/, ''),
  /** HMAC tajemství nahrávacích tokenů (generate-secrets). */
  uploadTokenSecret: process.env.STORAGE_UPLOAD_TOKEN_SECRET ?? '',

  // ── Schopnost „zařízení“ (lib/zarizeni.ts, routes/zarizeni.ts) — volitelná ──
  // Deklaraci čte z databáze přes PostgREST (`postgrestUrl` + `postgrestServiceToken`
  // výš, lib/zdroj-deklarace.ts), ne z prostředí.
  /**
   * Kde v OBRAZU leží balíček hlídače (build secret). Prázdné = instance ho
   * nedodává a úložiště se nesrovnává — ne že by se měl někde hledat.
   */
  /** Bucket pro APK hlídače; storage-auth ho založí při prvním nahrání (minio-init ne — ARG_MAX). */
  zarizeniBucket: 'zarizeni',
  /** Hlídač má desítky kB; strop chrání bucket před omylem nahraným čímkoli jiným. */
  // ⛔ 20 MB stačilo na hlídače (desítky kB), NE na appku: build řidiče má 86 MB
  //    a nahrání by skončilo na 413 — tedy na stropu, který nikdo nedeklaroval.
  //    Fakt o světě (jak velké balíčky instance rozdává) patří do prostředí.
  maxApkMb: num(process.env.MAX_APK_MB, 200),
  /**
   * Doplnění balíčků z deklarovaného `zdroj` (lib/doplneni-baliku.ts). Token JEN
   * pro čtení balíčků registru; přikládá se výhradně na původ `ZARIZENI_ZDROJ_PUVOD`
   * (lib/registr-zdroj.ts). Prázdný token = stahuje se bez něj (veřejný zdroj),
   * a když ho zdroj vyžaduje, doplnění selže NAHLAS — nehádá se jinde.
   */
  zarizeniZdrojToken: process.env.ZARIZENI_ZDROJ_TOKEN ?? '',
  zarizeniZdrojPuvod: (process.env.ZARIZENI_ZDROJ_PUVOD ?? '').replace(/\/+$/, ''),

  // ── Public buckets (no auth required for read) ──
  publicBuckets: new Set([
    'hero-images',
    'product-images',
    'page-assets',
    'archive-scans',
    'email-assets',
    'email-templates',
  ]),

  // ── Private buckets (server-mediated access only) ──
  privateBuckets: new Set([
    'health-documents',
    'wearable-analysis',
    // Field evidence: photos taken AT the thing being documented — a handover
    // at the tailgate, a meter on a wall. One bucket, because the acquisition
    // is identical; what differs is which entity the photo is registered
    // AGAINST, and that is the RPC's business, not the bucket's.
    'entity-evidence',
  ]),

  /**
   * Which authorization RPC guards each private bucket.
   *
   * ⚠️ This map exists because the preflight route used to call
   * `create_health_document_preflight_audited` for EVERY private bucket — the
   * name of one domain's RPC was standing in for "the authorization step". That
   * works exactly as long as there is one private bucket with rows to write, and
   * silently writes a health-document row (or fails) for any other. A second
   * bucket makes the bug real, so the mapping becomes data.
   *
   * A bucket without an entry is refused rather than defaulted: guessing which
   * RPC may authorize an upload is precisely the guess that must not be made.
   */
  privateBucketRpc: new Map<string, string>([
    ['health-documents', 'create_health_document_preflight_audited'],
    // Kept pointing at the health RPC because that is what it resolves to TODAY
    // (every private bucket did). Whether wearable analyses belong in the health
    // document registry is a question for that domain, not something to change
    // silently while fixing the dispatch.
    ['wearable-analysis', 'create_health_document_preflight_audited'],
    ['entity-evidence', 'create_entity_evidence_preflight_audited'],
  ]),

  // ── AV quarantine bucket ──
  /**
   * Landing bucket for every pre-signed upload. The client's PUT targets this bucket;
   * a clean object is server-side copied to its durable bucket and the quarantine copy
   * deleted. Infected/error objects are deleted from here and never reach a durable
   * bucket. The intended durable bucket is encoded as the first key segment:
   * `<durableBucket>/<userId>/<uuid>_<name>`.
   *
   * ⛔ DO 2026-09-21 TENHLE POPIS NEPLATIL. `upload-preflight` podepisoval PUT rovnou
   * do cílového bucketu, takže karanténa nebyla „landing bucket for every upload", ale
   * prázdný bucket, do kterého nikdy nic nedopadlo — a `scanAndPromote` v provozu nikdy
   * neběžel. Naměřeno na instanci: 0 objektů ve všech uploadových bucketech, žádná
   * notifikace na karanténě, event-worker bez `STORAGE_AUTH_URL` — a `clamd` přitom
   * běžel a odpovídal PONG. Deklarace se tedy nesrovnala se skutečností slovy, ale
   * kódem; co ten sken SPOUSTÍ, hlídá brána `nahravka-se-opravdu-oskenuje`.
   */
  uploadsQuarantineBucket: process.env.UPLOADS_QUARANTINE_BUCKET ?? 'uploads-quarantine',

  // ── CORS ──
  // Single source of truth: ALLOWED_ORIGINS from config/domains.env (pushed by
  // coolify-deploy-init). Legacy fallback to CORS_ORIGINS for old deploys.
  // Only safe localhost defaults here (same contract as gateway config) — never
  // a hardcoded public hostname; real origins always come from the domains SoT.
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS ||
    process.env.CORS_ORIGINS ||
    'http://localhost:5173,http://localhost:8100'
  ).split(','),

  // ── Upload limits ──
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB ?? '50', 10),
  allowedMimeTypes: new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    // Fotky z iPhonu (2026-09-24): ukládají se jak přišly, prohlížeči je doručí
    // imgproxy převedené (routes/public-proxy.ts) — bez převodu v prohlížeči.
    'image/heic',
    'image/heif',
    'application/dicom',
    'text/plain',
    'text/csv',
  ]),
  // ── OWASP hardening (@aisha/security) ──
  /** OWASP A05 — CORS allowlist (comma-separated origins). */
  corsAllowlist: process.env.CORS_ALLOWLIST ?? '',
  /** OWASP A10 — outbound host allowlist for safeFetch (comma-separated). */
  ssrfHostAllowlist: process.env.SSRF_HOST_ALLOWLIST ?? '',
  /** OWASP A04 — disable rate limiting in tests/local dev. */
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',

  // ── ClamAV flow-through scanner (docker-compose.coolify-clamav.yml) ──
  /** clamd host — the network alias the shared AV sidecar exposes. */
  clamdHost: process.env.CLAMD_HOST ?? 'clamd',
  /** clamd INSTREAM TCP port. */
  clamdPort: parseInt(process.env.CLAMD_PORT ?? '3310', 10),
  /**
   * Per-scan wall-clock budget (ms). Exceeding it is FAIL-CLOSED — the object is
   * treated as blocked, never promoted/vectorized. Generous because first-byte
   * latency includes clamd's in-memory signature match on large archives.
   */
  clamdTimeoutMs: parseInt(process.env.CLAMD_TIMEOUT_MS ?? '120000', 10),
  /**
   * Master AV switch. Default ON — production MUST scan. Setting 'false' is a
   * fail-OPEN escape hatch for local dev without a clamd sidecar; guard its use.
   * (Unreachable clamd while enabled is fail-CLOSED, not skipped — see av-scan.ts.)
   */
  avScanEnabled: process.env.AV_SCAN_ENABLED !== 'false',

  /**
   * Strop skenu v SYNCHRONNÍ cestě (konec PUTu `/nahrani`, `/upload-complete`).
   *
   * Kratší než `clamdTimeoutMs` (120 s, interní sken) ZÁMĚRNĚ: na cestě klient → edge
   * → gateway → storage-auth je tvrdý strop gateway `@fastify/http-proxy`/undici
   * 300 s (headersTimeout i bodyTimeout, bez vlastního nastavení — změřeno v kódu
   * 2026-09-23, RIQ Driver). Rozhodovat má storage-auth (502 fail-closed), ne proxy
   * useknutím uprostřed. U fotky jednotek MB je sken jednotky sekund.
   */
  //
  // KONSTANTA, ne proměnná prostředí: hodnota je odvozená z architektury (strop gateway),
  // ne provozní volba. Env s tichým výchozím by byl další fallback nad env — a ten repo
  // nepřidává (ráčna `zadny-fallback-nad-identitou`). Změní-li se strop gateway, mění se
  // tady, v kódu, s důvodem v commitu.
  uploadScanBudgetMs: 60_000,

} as const;
