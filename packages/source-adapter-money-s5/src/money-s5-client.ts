/**
 * Low-level client for the Money (Seyfor) **S5 API** module.
 *
 * Two facts make this NOT a stock GraphQL client (verified against a live
 * instance — see docs/MONEY_S5_API.md):
 *   1. Auth is OAuth2 `client_credentials` with `scope=S5Api` at `/connect/token`
 *      (password grant is disabled). The Bearer token is required on `/graphql`.
 *   2. `/graphql` returns a NON-standard envelope — `{ Data, Status, RowCount,
 *      Message }` — not `{ data, errors }`. So `graphql-request` (which reads
 *      `data`/`errors`) would misparse it; we parse the envelope by hand.
 *
 * `fetchImpl` is injected so the broker can pass its SSRF-guarded fetch (and unit
 * tests a stub) — this module never reaches the network on its own.
 */

export interface MoneyCredentials {
  clientId: string;
  clientSecret: string;
}

export interface MoneyClientOptions {
  /** Money API base URL, e.g. http://host:81 (no trailing slash needed). */
  baseUrl: string;
  credentials: MoneyCredentials;
  /** OAuth scope — the only valid API scope on S5 is `S5Api`. */
  scope?: string;
  /** Injected fetch (broker SSRF-guarded fetch in prod; stub in tests). */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class MoneyApiError extends Error {
  constructor(
    public readonly kind: 'auth' | 'graphql' | 'transport',
    message: string,
  ) {
    super(`MONEY_S5_${kind.toUpperCase()}: ${message}`);
    this.name = 'MoneyApiError';
  }
}

/** The S5 GraphQL envelope (capital-D `Data`, not standard `data`/`errors`). */
interface S5Envelope<T> {
  Data?: T;
  data?: T;
  Status?: number;
  Message?: string;
  StackTrace?: string;
  RowCount?: number;
  PageCount?: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

const DEFAULT_SCOPE = 'S5Api';
const DEFAULT_TIMEOUT = 30_000;
const TOKEN_SKEW_MS = 60_000;

export class MoneyS5Client {
  private readonly baseUrl: string;
  private readonly credentials: MoneyCredentials;
  private readonly scope: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(opts: MoneyClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.credentials = opts.credentials;
    this.scope = opts.scope ?? DEFAULT_SCOPE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  /** OAuth2 client_credentials token, cached until expiry minus skew. */
  async getToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.token;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      scope: this.scope,
    });

    const res = await this.call(`${this.baseUrl}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new MoneyApiError('auth', `token request failed (${res.status}) ${detail}`.trim());
    }
    const json = (await res.json()) as TokenResponse;
    if (!json.access_token) throw new MoneyApiError('auth', 'token response missing access_token');
    const ttl = (typeof json.expires_in === 'number' ? json.expires_in : 300) * 1000;
    this.cached = { token: json.access_token, expiresAt: Date.now() + ttl - TOKEN_SKEW_MS };
    return this.cached.token;
  }

  /**
   * Run a GraphQL query and return the inner `Data` object. Retries once on 401
   * with a fresh token (a token can be revoked before its declared expiry).
   */
  async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const run = async (token: string): Promise<Response> =>
      this.call(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query, variables: variables ?? {} }),
      });

    let res = await run(await this.getToken());
    if (res.status === 401) {
      this.cached = null;
      res = await run(await this.getToken());
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new MoneyApiError('graphql', `HTTP ${res.status} ${detail}`.trim());
    }

    const env = (await res.json()) as S5Envelope<T>;
    // Success is Status===1; anything else carries Message/StackTrace, not `errors`.
    if (env.Status !== undefined && env.Status !== 1) {
      throw new MoneyApiError('graphql', `Status ${env.Status}: ${env.Message ?? 'unknown'}`);
    }
    if (env.Message) throw new MoneyApiError('graphql', env.Message);
    const data = env.Data ?? env.data;
    if (data === undefined) throw new MoneyApiError('graphql', 'envelope missing Data');
    return data;
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: ctrl.signal });
    } catch (err) {
      throw new MoneyApiError('transport', err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}
