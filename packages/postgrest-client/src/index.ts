/**
 * @aisha/postgrest-client — the ONE PostgREST RPC call contract shared by every
 * AISHA orchestrator service.
 *
 * Why this package exists (SVC-01 / remediation block D11):
 *   Every service used to carry its own `src/postgrest.ts` that re-implemented the
 *   same job — POST `${POSTGREST_URL}/rpc/<fn>` with a service/user bearer token,
 *   a timeout, and error handling. The 18 copies had DRIFTED into 10 distinct
 *   implementations (5s vs 30s vs no timeout, `Accept`/`Prefer` present or not,
 *   `T` vs `T | null` returns, a budget signal in one place only). A DRY /
 *   single-source-of-truth violation and a latent security surface: any fix to the
 *   auth header, timeout, or error handling had to be applied N times and was
 *   guaranteed to be missed somewhere.
 *
 * This module is that single implementation. Each service's `postgrest.ts` is now
 * a THIN factory-and-re-export shim over these builders, so the request/auth/abort/
 * error logic lives exactly once. The two INTENTIONAL per-service differences are
 * preserved as options, not forks:
 *   - timeout: `timeoutMs` (svc-webdispecink needs 30s for batch upserts; most use
 *     5s; a few use none).
 *   - nullable result on a non-JSON 2xx body: `createNullable*Rpc` (svc-ai-chat).
 *
 * Funkce `RETURNS void`: PostgREST odpoví 204 No Content bez těla a VŠECHNY RPC
 * buildery (striktní i nullable) vrátí `null` — úspěch bez hodnoty. Volání typuj
 * `rpcService<VoidRpcResult>('fn', …)` (alias `null`). Do 0.1.2 striktní buildery
 * na 204 házely SyntaxError až po zápisu (viz HTTP_NO_CONTENT níž). 200 s prázdným
 * tělem dál hází — to je vada serveru, ne void.
 *
 * Config is read from the SAME environment every service already resolved it from
 * (POSTGREST_URL / POSTGREST_SERVICE_TOKEN / JWT_SECRET|POSTGREST_JWT_SECRET), at
 * call time, so behaviour is identical to the per-service `config` objects.
 */
import { SignJWT, type JWTPayload } from 'jose';

// ── Config (read at call time from the canonical env — same as every service's config.ts) ──

// ⛔ ŽÁDNÝ FALLBACK (majitel, 2026-08-24). Tenhle soubor je SPOLEČNÝ DOMOV pro
// všechny služby, takže dosazení tady se násobí do celé platformy.
//
// `?? 'http://postgrest:3000'` navíc dosazovalo jméno BEZ PREFIXU INSTANCE. Na
// sdílené síti `coolify` je takové jméno nárokovatelné i cizím nájemníkem a
// Docker DNS mezi kandidáty STŘÍDÁ (naměřeno 2026-08-10 na aliasu `pki-db`,
// který se rozřešil na dvě adresy). Adresa se ODVOZUJE, nedosazuje.
//
// `?? ''` u tajemství je horší, než vypadá: prázdný token vyrobí hlavičku
// `Authorization: Bearer ` — tedy požadavek, který PostgREST odmítne až za
// RLS, o tři kroky dál a bez souvislosti s příčinou.
function vyzadovane(jmeno: string, hodnota: string | undefined, procIsToPotreba: string): string {
  if (hodnota && hodnota.length > 0) return hodnota;
  throw new Error(
    `${jmeno} není nastavená — odmítám dosadit. ${procIsToPotreba} ` +
      'Hodnotu vydává generate-secrets/derivace a doručuje coolify-sync-envs.',
  );
}

/** PostgREST base URL. Mirrors `config.postgrestUrl` in every service. */
export function postgrestUrl(): string {
  return vyzadovane(
    'POSTGREST_URL',
    process.env.POSTGREST_URL,
    'Dosazené `postgrest:3000` není naše adresa — nenese prefix instance.',
  );
}

/** service_role bearer token. Mirrors `config.postgrestServiceToken`. */
export function serviceToken(): string {
  return vyzadovane(
    'POSTGREST_SERVICE_TOKEN',
    process.env.POSTGREST_SERVICE_TOKEN,
    'Prázdný token znamená nepřihlášené volání, ne volání bez oprávnění.',
  );
}

/**
 * HS256 secret used to mint short-lived user-scoped PostgREST JWTs.
 * Mirrors `config.postgrestJwtSecret`.
 *
 * Stráž je TADY, ne u volajícího: dřív ji nesl jen `mintPostgrestJwt`, takže ji
 * každý další volající musel zopakovat — a kdo by zapomněl, podepsal by prázdným
 * klíčem. Hláška zůstává doslova (`postgrest_jwt_secret_not_configured`), protože
 * na ni gateway mapuje 503.
 */
export function jwtSecret(): string {
  const s = process.env.JWT_SECRET ?? process.env.POSTGREST_JWT_SECRET;
  if (!s) throw new Error('postgrest_jwt_secret_not_configured');
  return s;
}

// ── Error ──

/**
 * Thrown when PostgREST returns a non-2xx status. Carries the HTTP status and the
 * (best-effort parsed) response body so callers can branch on it.
 */
export class PostgRESTError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'PostgRESTError';
    this.status = status;
    this.body = body;
  }
}

// ── Per-call and per-client options ──

/**
 * Per-call abort options: an optional caller budget signal + an optional timeout
 * override. When both a client timeout and a caller signal are present, the request
 * aborts when EITHER fires.
 */
export interface RpcOpts {
  /** Caller-supplied budget signal (e.g. an aggregate dispatch deadline). */
  signal?: AbortSignal;
  /** Timeout override in ms for this call. Wins over the client's default. */
  timeoutMs?: number;
}

/** Fixed behaviour of a built RPC function — the parts that differed between services. */
export interface ClientOptions {
  /** Default per-call timeout in ms. `undefined` ⇒ no client-side timeout. */
  timeoutMs?: number;
  /** Send `Accept: application/json` (default `true`). */
  accept?: boolean;
  /** Send `Prefer: return=representation` (default `false`). A no-op for `/rpc/` calls; kept for parity. */
  preferRepresentation?: boolean;
}

// ── Abort signal: manual combine of (caller budget ∪ timeout), no AbortSignal.any dependency ──

function buildSignal(
  clientTimeoutMs: number | undefined,
  opts?: RpcOpts,
): { signal: AbortSignal | undefined; cleanup: () => void } {
  const timeoutMs = opts?.timeoutMs ?? clientTimeoutMs;
  const caller = opts?.signal;
  if (timeoutMs === undefined && !caller) {
    return { signal: undefined, cleanup: () => {} };
  }
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (caller) {
    if (caller.aborted) ctrl.abort();
    else caller.addEventListener('abort', onAbort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs !== undefined) timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return {
    signal: ctrl.signal,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      if (caller) caller.removeEventListener('abort', onAbort);
    },
  };
}

function buildHeaders(token: string, o: ClientOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (o.accept ?? true) headers.Accept = 'application/json';
  if (o.preferRepresentation ?? false) headers.Prefer = 'return=representation';
  return headers;
}

/**
 * Perform the POST to `/rpc/<fn>`, throwing `PostgRESTError` on a non-2xx status.
 * Returns the OK response plus a `cleanup` the caller MUST invoke after reading the
 * body (so the abort timer/listener is cleared once the request settles).
 */
async function send(
  token: string,
  fn: string,
  params: Record<string, unknown>,
  o: ClientOptions,
  opts: RpcOpts | undefined,
): Promise<{ res: Response; cleanup: () => void }> {
  const { signal, cleanup } = buildSignal(o.timeoutMs, opts);
  let res: Response;
  try {
    res = await fetch(`${postgrestUrl()}/rpc/${fn}`, {
      method: 'POST',
      headers: buildHeaders(token, o),
      body: JSON.stringify(params),
      signal,
    });
  } catch (err) {
    cleanup();
    throw err;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    cleanup();
    throw new PostgRESTError(
      `PostgREST rpc/${fn} failed (${res.status}): ${detail.slice(0, 300)}`,
      res.status,
      detail,
    );
  }
  return { res, cleanup };
}

// ⛔ NAMĚŘENO (fork 2026-09-29, services/svc-agent-runner db.unit.test.ts): funkce
// `RETURNS void` odpoví 204 No Content BEZ TĚLA. `strictRpc` volal na každé 2xx
// `res.json()` → SyntaxError AŽ PO ZÁPISU v databázi; volající hlásil chybu u zápisu,
// který proběhl (svc-health-ai z ní dělal 429 a falešný audit u KAŽDÉ analýzy).
// PROČ podle STAVU, ne podle Content-Type: undici u 204 hlavičku klidně předá
// (naměřeno v void-204.http.test.ts) a tělo 204 z definice HTTP nemá.
// 200 s prázdným tělem ZŮSTÁVÁ výjimkou — to je vada serveru, ne void.
const HTTP_NO_CONTENT = 204;

async function strictRpc<T>(
  token: string,
  fn: string,
  params: Record<string, unknown>,
  o: ClientOptions,
  opts?: RpcOpts,
): Promise<T> {
  const { res, cleanup } = await send(token, fn, params, o, opts);
  try {
    // void RPC → null; typuj takové volání `<VoidRpcResult>` (viz ServiceRpc).
    if (res.status === HTTP_NO_CONTENT) return null as T;
    return (await res.json()) as T;
  } finally {
    cleanup();
  }
}

async function nullableRpc<T>(
  token: string,
  fn: string,
  params: Record<string, unknown>,
  o: ClientOptions,
  opts?: RpcOpts,
): Promise<T | null> {
  const { res, cleanup } = await send(token, fn, params, o, opts);
  try {
    // Táž vada jako ve strictRpc: 204 s `Content-Type: application/json` padal na res.json().
    if (res.status === HTTP_NO_CONTENT) return null;
    const ct = res.headers.get('Content-Type') ?? '';
    if (ct.includes('application/json')) return (await res.json()) as T;
    return null;
  } finally {
    cleanup();
  }
}

// ── Factory function types (generic-preserving, so callers keep `rpcService<Row>(...)`) ──

/**
 * Výsledek RPC funkce `RETURNS void` (204 No Content). Typuj taková volání
 * `rpcService<VoidRpcResult>('fn', …)` — runtime hodnota je vždy `null`.
 */
export type VoidRpcResult = null;

/**
 * Service-role RPC. Resolves the parsed JSON body of a 2xx; `null` for 204 No
 * Content (a `RETURNS void` function — type it `<VoidRpcResult>`); throws
 * `SyntaxError` on a 2xx other than 204 whose body is not JSON (incl. empty) and
 * `PostgRESTError` on a non-2xx.
 */
export type ServiceRpc = <T = unknown>(
  fn: string,
  params?: Record<string, unknown>,
  opts?: RpcOpts,
) => Promise<T>;

/** User-scoped RPC — same result contract as {@link ServiceRpc} (204 → `null`). */
export type UserRpc = <T = unknown>(
  fn: string,
  params: Record<string, unknown>,
  jwt: string,
  opts?: RpcOpts,
) => Promise<T>;

export type NullableServiceRpc = <T = unknown>(
  fn: string,
  params?: Record<string, unknown>,
  opts?: RpcOpts,
) => Promise<T | null>;

export type NullableUserRpc = <T = unknown>(
  fn: string,
  params: Record<string, unknown>,
  jwt: string,
  opts?: RpcOpts,
) => Promise<T | null>;

export type UserClaimsRpc = <T = unknown>(
  fn: string,
  params: Record<string, unknown>,
  claims: JWTPayload,
) => Promise<T>;

// ── Builders ──

/**
 * Service-role RPC that throws on a non-2xx and parses the JSON body of every
 * other 2xx; 204 No Content (`RETURNS void`) resolves `null`.
 */
export function createServiceRpc(o: ClientOptions = {}): ServiceRpc {
  return <T = unknown>(fn: string, params: Record<string, unknown> = {}, opts?: RpcOpts) =>
    strictRpc<T>(serviceToken(), fn, params, o, opts);
}

/**
 * User-scoped RPC (forwards a caller-supplied JWT) that throws on a non-2xx;
 * 204 No Content (`RETURNS void`) resolves `null`.
 */
export function createUserRpc(o: ClientOptions = {}): UserRpc {
  return <T = unknown>(fn: string, params: Record<string, unknown>, jwt: string, opts?: RpcOpts) =>
    strictRpc<T>(jwt, fn, params, o, opts);
}

/** Service-role RPC that returns `null` on 204 or when a 2xx response has a non-JSON body. */
export function createNullableServiceRpc(o: ClientOptions = {}): NullableServiceRpc {
  return <T = unknown>(fn: string, params: Record<string, unknown> = {}, opts?: RpcOpts) =>
    nullableRpc<T>(serviceToken(), fn, params, o, opts);
}

/** User-scoped RPC that returns `null` on 204 or when a 2xx response has a non-JSON body. */
export function createNullableUserRpc(o: ClientOptions = {}): NullableUserRpc {
  return <T = unknown>(fn: string, params: Record<string, unknown>, jwt: string, opts?: RpcOpts) =>
    nullableRpc<T>(jwt, fn, params, o, opts);
}

// ── Keycloak-claims → minted PostgREST JWT → user RPC ──

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function claimString(payload: JWTPayload, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Map a verified Keycloak token payload onto the claim shape PostgREST expects
 * (role=authenticated + roles union from realm_access, sub/email carried through).
 * Keycloak maps `sub` to `auth.users.id` via the `db_uid` user attribute.
 */
export function buildPostgrestClaims(payload: JWTPayload): JWTPayload {
  const record = payload as Record<string, unknown>;
  const realmAccess = record.realm_access as { roles?: unknown } | undefined;
  const roles = [
    ...new Set([...asStringArray(record.roles), ...asStringArray(realmAccess?.roles)]),
  ];

  return {
    ...payload,
    role: 'authenticated',
    sub: payload.sub,
    email: claimString(payload, 'email') ?? claimString(payload, 'preferred_username'),
    roles,
    keycloak_iss: payload.iss,
    keycloak_azp: claimString(payload, 'azp'),
  };
}

const textEncoder = new TextEncoder();

/** Mint a short-lived (15 min) HS256 PostgREST JWT from verified Keycloak claims. */
export async function mintPostgrestJwt(payload: JWTPayload): Promise<string> {
  // Stráž je v `jwtSecret()` — tady by byla druhá kopie téhož pravidla.
  const secret = jwtSecret();
  const claims = buildPostgrestClaims(payload);
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: 'HS256', typ: 'JWT' });
  if (!claims.iat) jwt.setIssuedAt();
  if (!claims.exp) jwt.setExpirationTime('15m');
  return jwt.sign(textEncoder.encode(secret));
}

/**
 * Build a user RPC that mints a PostgREST JWT from verified Keycloak claims and
 * calls as that user (respects RLS + SECURITY DEFINER `auth.uid()` binding).
 */
export function createUserClaimsRpc(o: ClientOptions = {}): UserClaimsRpc {
  const rpcUser = createUserRpc(o);
  return async <T = unknown>(fn: string, params: Record<string, unknown>, claims: JWTPayload) => {
    const jwt = await mintPostgrestJwt(claims);
    return rpcUser<T>(fn, params, jwt);
  };
}

// ── Table helpers (lenient JSON parse; used by the svc-ai-chat reflection runtime) ──

/**
 * Service-role RPC with a LENIENT body parse: returns the parsed JSON when the body
 * is JSON, the raw text otherwise, and `null` for an empty body. Throws
 * `PostgRESTError` (with the parsed body attached) on a non-2xx. This is the
 * variant the reflection graph nodes consume.
 */
export async function rpc<T = unknown>(
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${postgrestUrl()}/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceToken()}`,
      Accept: 'application/json',
    },
    body: JSON.stringify(args),
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (parseError) {
    // Non-JSON response body (e.g. an HTML error page from a proxy) — keep the
    // raw text so the PostgRESTError below still surfaces the payload.
    console.warn(`[postgrest] RPC ${fn} returned non-JSON body:`, (parseError as Error).message);
    body = text;
  }

  if (!res.ok) {
    throw new PostgRESTError(`RPC ${fn} failed with HTTP ${res.status}`, res.status, body);
  }
  return body as T;
}

/** Service-role PATCH of a table row (`return=minimal`), matching on equality filters. */
export async function updateRow(
  table: string,
  match: Record<string, string>,
  patch: Record<string, unknown>,
): Promise<void> {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(match)) {
    query.append(k, `eq.${v}`);
  }
  const res = await fetch(`${postgrestUrl()}/${table}?${query.toString()}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceToken()}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new PostgRESTError(`PATCH ${table} failed with HTTP ${res.status}`, res.status, text);
  }
}

/** Service-role INSERT of a table row (`return=representation`), returning the created row. */
export async function insertRow(
  table: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${postgrestUrl()}/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceToken()}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new PostgRESTError(`INSERT ${table} failed with HTTP ${res.status}`, res.status, text);
  }
  const arr = (await res.json()) as Record<string, unknown>[];
  return arr[0] ?? {};
}
