/**
 * Klient k Money S5 — OAuth token + GraphQL dotaz, per agenda.
 *
 * Agenda = port. Jeden Money URL obsluhuje víc účetních jednotek a rozlišuje je
 * PORTEM, ne cestou. Proto se pověření i token drží per agenda a nikdy se
 * nesdílí — token z jedné agendy do druhé nepatří a záměna by mísila data
 * dvou firem.
 */
import { request as httpRequest } from 'node:http';

export interface MoneyTarget {
  key: string;
  label: string;
  host: string;
  port: number;
  clientId: string;
  clientSecret: string;
}

/** Vrstva, přes kterou se skutečně mluví ven — testy si podstrčí vlastní. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Výchozí vrstva: `node:http`, NE globální `fetch`.
 *
 * ⛔ NAMĚŘENO 2026-09-15 v produkci instance: agendy na portech 87 a 95 hlásily
 * `fetch failed`, přestože TCP spojení vedlo a `node:http` z téhož kontejneru dostal
 * token i faktury (3 327 a 36). Node `fetch` (undici) implementuje WHATWG Fetch a jeho
 * seznam „bad ports" — 87 i 95 v něm jsou — spojení vůbec neotevře a hlásí jen
 * `fetch failed` (příčina `bad port` je až v `cause`). Money přitom agendy rozlišuje
 * PORTEM, takže každá agenda na „špatném" portu byla pro svc-money neviditelná.
 * Skript, který faktury stáhl 07-30, byl v Pythonu — ten žádný takový seznam nemá.
 */
export const httpFetcher: Fetcher = (url, init = {}) =>
  new Promise<Response>((resolve, reject) => {
    const u = new URL(url);
    const body = init.body === undefined || init.body === null ? undefined : String(init.body);
    const headers: Record<string, string> = {};
    new Headers(init.headers ?? {}).forEach((v, k) => { headers[k] = v; });
    if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));
    const req = httpRequest(
      { host: u.hostname, port: u.port || 80, path: `${u.pathname}${u.search}`, method: init.method ?? 'GET', headers },
      (res) => {
        const casti: Buffer[] = [];
        res.on('data', (c: Buffer) => casti.push(c));
        res.on('error', reject);
        res.on('end', () => {
          const text = Buffer.concat(casti).toString('utf8');
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: async () => text,
            json: async () => JSON.parse(text) as unknown,
          } as Response);
        });
      },
    );
    const signal = init.signal;
    if (signal) {
      if (signal.aborted) { req.destroy(); reject(signal.reason ?? new Error('aborted')); return; }
      signal.addEventListener('abort', () => req.destroy(signal.reason instanceof Error ? signal.reason : new Error('aborted')), { once: true });
    }
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function base(t: MoneyTarget): string {
  return `http://${t.host}:${t.port}`;
}

/**
 * OAuth `client_credentials`, scope `S5Api`.
 *
 * Chyby jsou tu ROZLIŠUJÍCÍ (`invalid client_id` × `invalid client credentials`),
 * na rozdíl od jiných konektorů — takže se vyplatí je propustit ven celé,
 * ne je slepit do „auth failed".
 */
export async function getToken(
  t: MoneyTarget,
  fetchImpl: Fetcher = httpFetcher,
  timeoutMs = 30_000
): Promise<string> {
  const cached = tokenCache.get(t.key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetchImpl(`${base(t)}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: t.clientId,
      client_secret: t.clientSecret,
      scope: 'S5Api',
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Money ${t.key} token → ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error(`Money ${t.key}: odpověď bez access_token`);
  tokenCache.set(t.key, {
    token: data.access_token,
    // Bez `expires_in` se kešuje krátce místo hádání hodiny.
    expiresAt: Date.now() + (data.expires_in ? data.expires_in * 1000 : 300_000),
  });
  return data.access_token;
}

export interface GraphQLResult {
  data: Record<string, unknown> | null;
  errors: string[];
}

/**
 * GraphQL dotaz.
 *
 * ⛔ GraphQL umí vrátit DATA I CHYBY zároveň a chyba na JEDNOM poli vynuluje
 * CELÝ doklad, ne jen to pole. Proto se chyby vracejí vždy vedle dat — volající
 * musí mít možnost poznat, že „přišlo 500 dokladů" znamená 500 prázdných.
 * Doloženo: dotaz na neznámé `CisloObjednavky` shodil celé doklady a uzavřelo
 * se z toho, že objednávka v Money neexistuje.
 */
export async function graphql(
  t: MoneyTarget,
  query: string,
  fetchImpl: Fetcher = httpFetcher,
  timeoutMs = 60_000
): Promise<GraphQLResult> {
  const token = await getToken(t, fetchImpl, timeoutMs);
  const res = await fetchImpl(`${base(t)}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Money ${t.key} graphql → ${res.status} ${detail.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    Data?: Record<string, unknown>;
    data?: Record<string, unknown>;
    Errors?: unknown[];
    errors?: unknown[];
    Message?: string;
  };
  const rawErrors = (body.Errors ?? body.errors ?? []) as unknown[];
  const errors = rawErrors.map((e) =>
    typeof e === 'string' ? e : String((e as { message?: string })?.message ?? JSON.stringify(e))
  );
  if (body.Message && errors.length === 0) errors.push(String(body.Message));
  return { data: body.Data ?? body.data ?? null, errors };
}

/**
 * Sonda dostupnosti agendy — token + jeden doklad.
 *
 * Vrací i POČET VYPLNĚNÝCH POLÍ, protože „doklad přišel" ještě neznamená
 * „vidíme na něj". Money umí vrátit doklad, kde je čitelné jen `ID`, protože
 * uživatel nemá práva na pole — a to je jiná porucha než chybějící spojení,
 * i když navenek vypadá stejně (prázdná tabulka).
 */
export async function probe(
  t: MoneyTarget,
  entity: string,
  fields: string,
  fetchImpl: Fetcher = httpFetcher
): Promise<{ ok: boolean; rowCount: number | null; filledFields: number; errors: string[] }> {
  const r = await graphql(t, `{ ${entity}(From:0, Count:1) { ${fields} } }`, fetchImpl);
  const uzel = r.data?.[entity] ?? null;

  // ⛔ NAMĚŘENO 2026-08-28: Money vrací kolekci JAKO HOLÉ POLE
  //   { "IssuedDeliveryNotes": [ {ID, CisloDokladu, …} ] }
  // — žádná obálka `Items`. Sonda ji přesto hledala, nenašla, a hlásila
  // `ok:false` s PRÁZDNÝM seznamem chyb. Falešně negativní odpověď: spojení,
  // token i dotaz byly v pořádku a dodací listy chodily.
  // Stálo to hodiny hledání vady VPN a pověření, které žádnou neměly.
  // Oba adaptéry (`invoices.ts`, `index.ts`) čtou pole správně — mýlila se
  // JEN tahle sonda, tedy právě to, čím se stav měří.
  // ⭐ Sonda, která odpoví „ne" na fungující cestu, je horší než žádná:
  // posílá hledat poruchu tam, kde není.
  const blok = (Array.isArray(uzel) ? null : uzel) as Record<string, unknown> | null;
  const rows = (
    Array.isArray(uzel) ? uzel : (blok?.Items ?? blok?.items ?? null)
  ) as Record<string, unknown>[] | null;
  const rowCount = typeof blok?.RowCount === 'number'
    ? (blok.RowCount as number)
    : (Array.isArray(uzel) ? uzel.length : null);
  const first = rows?.[0] ?? null;
  const vyplnene = (o: Record<string, unknown>) =>
    Object.entries(o).filter(([, v]) => v !== null && v !== '' && v !== undefined);
  const filledFields = first ? vyplnene(first).length : 0;
  // ⭐ `ID` se NEPOČÍTÁ do rozhodnutí „vidíme na doklad".
  // Money vrací identifikátor i tam, kde uživatel nemá práva na obsah — doklad
  // pak přijde s vyplněným `ID` a všude jinde null. Kdyby stačilo „aspoň jedno
  // pole", sonda by hlásila zeleno na dokladu, ze kterého se nedá nic vyčíst.
  // Naměřeno 2026-07-25: `User 'aishamn' does not have read permission to
  // IssuedInvoices.{CisloDokladu,DatumVystaveni,Firma}` — čitelné bylo JEN ID.
  const obsahovych = first
    ? vyplnene(first).filter(([k]) => k.toLowerCase() !== 'id').length
    : 0;
  return {
    ok: r.errors.length === 0 && obsahovych > 0,
    rowCount,
    filledFields,
    errors: r.errors,
  };
}

/** Jen pro testy — keš tokenů je modulová. */
export function _resetTokenCache(): void {
  tokenCache.clear();
}
