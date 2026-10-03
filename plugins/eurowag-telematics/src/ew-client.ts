/**
 * Eurowag Telematics REST client (customer-api v1).
 *
 * Webdispečink now sits under Eurowag: the SOAP endpoint this service was built
 * against is a dead end, and the live data comes from a REST API instead. Two
 * things about its auth are unusual enough to be worth stating:
 *
 *   1. the bearer token is minted by a KEYCLOAK PASSWORD GRANT against Eurowag's
 *      own realm — not by the platform's Keycloak, and not by an API key;
 *   2. the API key is an additional QUERY parameter on every call. A request
 *      carrying a valid bearer but no api_key is rejected.
 *
 * Tokens live ~5 minutes, so they are cached and re-minted shortly before expiry
 * rather than per request (the free tier allows 2000 calls/day — spending them on
 * token minting would be careless).
 *
 * Measured 2026-09-28 against the live API (the vendor docs do not say it):
 *   · `/drivers` and `/trips` are PAGED with `limit` default 12 and a hard maximum
 *     of 29 (`limit=30` → 422 "ensure this value is less than 30"). Reading one
 *     page stored 12 of 59 drivers and at most 12 trips per vehicle per window —
 *     silently, because a short answer looks like a complete one. Both are read
 *     to the end here.
 *   · both hosts sit behind Cloudflare; the token endpoint answers a library
 *     User-Agent (`node`, `curl`, python) with a 403 challenge page. The sandbox
 *     fetch forwards the plugin's headers and adds none, so the UA is set here.
 *
 * GET-only by design: this API exposes no writes, and neither does this client.
 */
/** Injected by the plugin sandbox (SSRF-guarded); plain fetch only in tests. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface EwCredentials {
  /** Query-parameter key; per-tenant, from the secret store. */
  apiKey: string;
  username: string;
  password: string;
}

export interface EwClientOptions {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  timeoutMs: number;
  /** Re-mint this many seconds before the token actually expires. */
  refreshSkewS?: number;
  /** Sent on every call (token and API) — Cloudflare challenges library UAs. */
  userAgent?: string;
  /** Guard against a pager that never ends (vendor bug) — pages per listing. */
  maxPages?: number;
  /** SSRF-guarded fetch in production; plain fetch only in tests (same seam as WdClient). */
  fetchImpl: FetchLike;
}

/** Largest page the API accepts (measured: 30 → 422). */
export const EW_PAGE_LIMIT = 29;

/**
 * Default User-Agent: a browser string, because Cloudflare in front of
 * login.eurowag.com challenges library UAs. Overridable from the administration
 * (`userAgent`) if the vendor ever whitelists a named client.
 */
export const EW_DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

export class EwApiError extends Error {
  constructor(readonly status: number, readonly endpoint: string, body: string) {
    // A Cloudflare challenge is an HTML page; its first 200 characters say
    // nothing. Name what happened instead, so the source-status block does.
    const cloudflare = /Just a moment|cf-chl|Error 1010/i.test(body);
    super(
      cloudflare
        ? `EW_API_${status}: ${endpoint} — Cloudflare odmítl požadavek (challenge / 1010), ne Eurowag; zkontrolovat userAgent a odchozí IP`
        : `EW_API_${status}: ${endpoint} — ${body.slice(0, 200)}`,
    );
    this.name = 'EwApiError';
  }
}

interface CachedToken { token: string; expiresAtMs: number }

export class EwClient {
  private cached: CachedToken | null = null;
  /** API GETs made by this client (token mints excluded) — the daily budget counts these. */
  calls = 0;

  constructor(
    private readonly creds: EwCredentials,
    private readonly opts: EwClientOptions,
  ) {}

  /** Mints (or reuses) a bearer token. Exposed for probes; callers rarely need it. */
  async token(nowMs = Date.now()): Promise<string> {
    if (this.cached && this.cached.expiresAtMs > nowMs) return this.cached.token;

    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: this.opts.clientId,
      username: this.creds.username,
      password: this.creds.password,
    });

    const res = await this.opts.fetchImpl(this.opts.tokenUrl, {
      method: 'POST',
      headers: { ...this.uaHeader(), 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    if (!res.ok) throw new EwApiError(res.status, 'token', await res.text().catch(() => ''));

    const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof json.access_token !== 'string' || !json.access_token) {
      throw new EwApiError(res.status, 'token', 'response carried no access_token');
    }
    // A token whose lifetime we cannot read is treated as short-lived, not long-lived.
    const ttlS = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 60;
    const skew = this.opts.refreshSkewS ?? 30;
    this.cached = { token: json.access_token, expiresAtMs: nowMs + Math.max(1, ttlS - skew) * 1000 };
    return this.cached.token;
  }

  /** GET one endpoint; `api_key` is appended here so no caller can forget it. */
  async get<T = unknown>(endpoint: string, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.opts.baseUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    url.searchParams.set('api_key', this.creds.apiKey);

    const token = await this.token();
    this.calls++;
    const res = await this.opts.fetchImpl(url.toString(), {
      method: 'GET',
      headers: { ...this.uaHeader(), authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    if (!res.ok) throw new EwApiError(res.status, endpoint, await res.text().catch(() => ''));
    return (await res.json()) as T;
  }

  vehiclesStates<T = unknown>(): Promise<T> { return this.get<T>('vehicles-states'); }

  /**
   * ALL drivers. The endpoint answers `{data, limit, offset, total}` a page at a
   * time (max 29); a codebook snapshot built from one page would retire every
   * driver past it.
   */
  async drivers<T = unknown>(): Promise<T[]> {
    const all: T[] = [];
    for (let page = 0; ; page++) {
      this.pageGuard('drivers', page);
      const res = await this.get<{ data?: unknown; total?: unknown }>('drivers', {
        limit: String(EW_PAGE_LIMIT),
        offset: String(all.length),
      });
      const data = Array.isArray(res?.data) ? (res.data as T[]) : [];
      all.push(...data);
      const total = typeof res?.total === 'number' ? res.total : null;
      if (data.length === 0 || (total !== null ? all.length >= total : data.length < EW_PAGE_LIMIT)) return all;
    }
  }

  /**
   * ALL trips of one vehicle in the window. Trips are PER VEHICLE:
   * `monitored_object_id` is required and the window is `date_from`/`date_to` —
   * snake_case, and the API silently returns an empty list for the camelCase
   * spelling rather than erroring, so the names matter. `from`/`to` are
   * ISO-8601 instants. The answer is a bare array with no total, so a page
   * shorter than the limit is the last one (the API honours limit=29 exactly).
   */
  async trips<T = unknown>(monitoredObjectId: number, from: string, to: string): Promise<T[]> {
    const all: T[] = [];
    for (let page = 0; ; page++) {
      this.pageGuard('trips', page);
      const res = await this.get<unknown>('trips', {
        monitored_object_id: String(monitoredObjectId),
        date_from: from,
        date_to: to,
        limit: String(EW_PAGE_LIMIT),
        offset: String(all.length),
      });
      const data = Array.isArray(res) ? (res as T[]) : [];
      all.push(...data);
      if (data.length < EW_PAGE_LIMIT) return all;
    }
  }

  private uaHeader(): Record<string, string> {
    return { 'user-agent': this.opts.userAgent || EW_DEFAULT_USER_AGENT };
  }

  /** A pager that never ends is a vendor fault — stop loudly, do not spend the day's budget. */
  private pageGuard(endpoint: string, page: number): void {
    const max = this.opts.maxPages ?? 200;
    if (page >= max) throw new EwApiError(0, endpoint, `stránkování neskončilo po ${max} stránkách`);
  }
}

/**
 * Trip times arrive WITHOUT a zone designator ("2026-09-28T10:11:09"). Measured
 * 2026-09-28: a vehicle's last trip ends to the second at its
 * `last_change_state`, which the same API sends as "+00:00" — the times are UTC.
 * Stated explicitly so the database does not read them in its session zone.
 */
export function utcIso(raw: unknown): string | null {
  if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) return null;
  if (!/T\d{2}:\d{2}/.test(raw) || /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return raw;
  return `${raw}Z`;
}

// ── Normalisation ────────────────────────────────────────────────────────────
// Measured against 1031 real trips: three fields lie in ways that a completeness
// check cannot see, so the correction belongs here rather than in every consumer.

/** Odometer arrives in METRES; 377 261 330 is 377 thousand km, not 377 million. */
export function odometerKm(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw / 1000 : null;
}

/**
 * `totalConsumption` is populated on 100% of records and carries -1 as a sentinel
 * for "unknown". Treating presence as validity is how that -1 reaches a report.
 */
export function consumptionLiters(raw: unknown): number | null {
  return typeof raw === 'number' && raw >= 0 ? raw : null;
}

/**
 * Per-100km consumption computed over a short trip can reach physically impossible
 * values (281 l/100km observed). Anything outside a plausible band is not data.
 */
export function consumptionPer100km(raw: unknown, maxPlausible = 100): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= maxPlausible ? raw : null;
}
