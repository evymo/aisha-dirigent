/**
 * AVP portal REST klient (Kupson AVP — výdejní stojany PHM).
 *
 * Base URL:  instance portálu (`https://<instance>.avp-portal.cz`, z konfigurace zdroje)
 * Endpointy: /api/signin  a  /api/{database}/{resource}
 *
 * POZOR na `database` v cestě: je to jméno instance (subdoména), NE hodnota
 * `ownership` ze signin odpovědi — cesta s `ownership` vrací 403 (ověřeno naživo
 * 2026-08-18). Chybné jméno databáze nevrací 404, ale 403 s reason phrase
 * "Forbidden: Database is disabled" a PRÁZDNÝM tělem — a to i bez tokenu,
 * protože se databáze resolvuje dřív než autorizace. 403 tedy neznamená
 * „chybí právo", ale skoro vždy „špatné jméno databáze".
 */

export interface AvpCredentials {
  username: string;
  password: string;
}

export interface AvpSession {
  token: string;
  /** Vlastnictví ze signin odpovědi — jen informativní, do URL NEPATŘÍ. */
  ownership: string;
  userId: number;
}

/**
 * Omezující podmínky společné všem endpointům.
 *
 * `filters` se serializují jako `$jmeno=hodnota`. Podporovaná je jedna hodnota
 * nebo rozsah `A...B` (i s otevřeným koncem, `2026-08-01T00:00:00Z...`).
 * Výčet hodnot NEEXISTUJE: `$tankId=1,5` i opakovaný parametr vrátí prázdný
 * seznam, `1|5` a `1;5` shodí server na HTTP 500 (ověřeno naživo). Více hodnot
 * = více dotazů.
 */
export interface AvpQuery {
  filters?: Record<string, string | number | boolean>;
  /** "SQL JOIN" na odkazovanou položku, max. jedna tečka: `vehicle.name`. */
  with?: readonly string[];
  /** Atributy v odpovědi; položky z `with` se přidají implicitně. */
  only?: readonly string[];
  /** Atribut pro řazení, sestupně s prefixem `-`. */
  sort?: string;
  limit?: number;
  /** Posun ve výsledku. `skip` server ignoruje, `page` je něco jiného. */
  offset?: number;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface AvpClientOptions {
  baseUrl: string;
  /** Jméno instance v cestě (subdoména portálu), ne `ownership` ze signin. */
  database: string;
  timeoutMs: number;
  /** V produkci SSRF-guarded fetch, plain fetch jen v testech/skriptech. */
  fetchImpl: FetchLike;
}

export class AvpApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    // UPPERCASE prefix → případný toPublicError vrátí 4xx bez detailů
    super(`AVP_API_ERROR: ${status} ${detail}`);
    this.name = 'AvpApiError';
    this.status = status;
    this.detail = detail;
  }
}

export interface AvpClient {
  signIn(credentials: AvpCredentials): Promise<AvpSession>;
  /** Jedna stránka výsledku. Bez `limit` vrací server CELOU tabulku. */
  list<T>(session: AvpSession, resource: string, query?: AvpQuery): Promise<T[]>;
  /** Stránkuje přes `offset` při `sort=id`, dokud stránka není neúplná. */
  listAll<T>(session: AvpSession, resource: string, query?: AvpQuery, pageSize?: number): Promise<T[]>;
}

export function buildQueryString(query: AvpQuery = {}): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query.filters ?? {})) {
    params.set(`$${name}`, String(value));
  }
  if (query.with?.length) params.set('with', query.with.join(','));
  if (query.only?.length) params.set('only', query.only.join(','));
  if (query.sort) params.set('sort', query.sort);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));

  // Server chce `...` v rozsazích nezakódované; URLSearchParams tečky nemění,
  // ale `$` v názvu ano — proto se vrací zpět.
  return params.toString().replace(/%24/g, '$');
}

/**
 * Odpovědi chodí s UTF-8 BOM (U+FEFF) — `res.json()` na nich spadne, proto se
 * parsuje z textu ručně.
 *
 * Neznámá cesta se navíc NEvrací jako 404: SPA fallback odpoví HTTP 200 a
 * HTML stránkou portálu. Bez téhle kontroly by se překlep v názvu resource
 * projevil až jako záhadná parse chyba.
 */
function parseJsonBody(text: string, resource: string): unknown {
  const body = text.replace(/^\uFEFF/, '');
  if (body.trimStart().startsWith('<')) {
    throw new AvpApiError(200, `resource '${resource}' returned HTML (SPA fallback — neznámý endpoint?)`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new AvpApiError(200, `resource '${resource}' returned non-JSON body`);
  }
}

export function createAvpClient(options: AvpClientOptions): AvpClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  async function request(path: string, init: RequestInit, resource: string): Promise<unknown> {
    const res = await options.fetchImpl(`${baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    if (!res.ok) {
      // Tělo bývá prázdné, informace je v reason phrase (statusText).
      const detail = res.statusText || (await res.text()).slice(0, 200) || 'no detail';
      throw new AvpApiError(res.status, detail);
    }
    return parseJsonBody(await res.text(), resource);
  }

  async function list<T>(session: AvpSession, resource: string, query: AvpQuery = {}): Promise<T[]> {
    const queryString = buildQueryString(query);
    const data = await request(
      `/api/${options.database}/${resource}${queryString ? `?${queryString}` : ''}`,
      { method: 'GET', headers: { Authorization: `Bearer ${session.token}`, Accept: 'application/json' } },
      resource,
    );
    if (!Array.isArray(data)) {
      throw new AvpApiError(200, `resource '${resource}' returned ${typeof data}, expected array`);
    }
    return data as T[];
  }

  return {
    async signIn(credentials) {
      const data = await request(
        '/api/signin',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(credentials),
        },
        'signin',
      );
      const payload = data as { token?: unknown; user?: { ownership?: unknown; id?: unknown } };
      if (typeof payload.token !== 'string' || !payload.token) {
        throw new AvpApiError(200, 'signin response missing token');
      }
      return {
        token: payload.token,
        ownership: String(payload.user?.ownership ?? ''),
        userId: Number(payload.user?.id ?? 0),
      };
    },

    list,

    async listAll<T>(session: AvpSession, resource: string, query: AvpQuery = {}, pageSize = 2000): Promise<T[]> {
      // `sort=id` je jediné deterministické řazení: podle `time` se záznamy se
      // shodným časem prohazují a stránkování by je ztrácelo/duplikovalo.
      const sort = query.sort ?? 'id';
      const collected: T[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const page = await list<T>(session, resource, { ...query, sort, limit: pageSize, offset });
        collected.push(...page);
        if (page.length < pageSize) return collected;
      }
    },
  };
}
