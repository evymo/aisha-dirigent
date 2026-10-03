/**
 * Klient k local-ingest — TENKÁ trubka, žádná znalost dodavatele.
 *
 * Ingest je stroj na dokumenty: přijme soubor, odvodí z něj entity (měří
 * exkluzivitu a jistotu) a vydá verify-gated balíček. Tenhle klient umí tři
 * pohyby, které k tomu stačí:
 *
 *   upload(name, bytes)  POST /api/upload?name=…   (application/octet-stream)
 *   run()                POST /api/run   {mode:"run"}
 *   export(note)         POST /api/export         → balíček do drop adresáře
 *   progress()           GET  /api/progress       → běží teď zpracování?
 *   runs()               GET  /api/runs           → historie doběhnutých běhů
 *
 * ⛔ `run` a `export` na obsazený zámek NEČEKAJÍ — ingest vrátí 409 a klient z toho
 * udělá `IngestError('busy')`. Dřív čekaly neomezeně a klientovi vypršel čas, zatímco
 * na serveru zůstalo vlákno ve frontě, které později spustilo celý běh (~9 h).
 * `busy` tedy znamená „zkus později", ne selhání.
 *
 * Odtud si ho vezme `li-driver` a přehraje do SoT. Twiny tedy vznikají VÝHRADNĚ
 * přes ingest — tenhle klient žádný twin nezapisuje a ani nemá čím.
 *
 * ⛔ HOST HEADER JE SOUČÁST KONTRAKTU. Server se brání DNS rebindingu: Host musí
 * být na allowlistu (`AISHA_INGEST_ALLOWED_HOSTS`), jinak vrátí 421 Misdirected
 * Request — i když jméno se přeloží, TCP projde a token sedí. Naměřeno 2026-08-29;
 * hlídá `ingest-allowlist-pousti-vnitrni-volajici`.
 *
 * ⛔ ORIGIN NEPOSÍLAT. Je-li hlavička přítomná a není loopback/allowlist, server
 * ji odmítne jako CSRF (403). Server-to-server volání ji přirozeně neposílá — jen
 * ji sem nikdo nesmí přidat „pro pořádek".
 */

export interface IngestClientOptions {
  /** Základ URL, např. http://<prefix>-svc-local-ingest:8765 */
  baseUrl: string;
  /** AISHA_INGEST_TOKEN — bez něj server odmítá vše (401). */
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class IngestError extends Error {
  constructor(
    public readonly kind: 'auth' | 'host' | 'transport' | 'server' | 'busy',
    message: string,
  ) {
    super(`INGEST_${kind.toUpperCase()}: ${message}`);
    this.name = 'IngestError';
  }
}

const DEFAULT_TIMEOUT = 120_000;

export interface IngestProgress {
  active: boolean;
  started_at?: string | null;
  trigger?: string | null;
}

export interface IngestRunRow {
  ts?: string;
  trigger?: string;
  errors?: number;
}

export class IngestClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: IngestClientOptions) {
    if (!opts.baseUrl) throw new IngestError('transport', 'chybí baseUrl — cíl se NEODVOZUJE');
    if (!opts.token) throw new IngestError('auth', 'chybí token — server odmítá vše');
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  private async call(path: string, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), 'X-Ingest-Token': this.token },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new IngestError('transport', e instanceof Error ? e.message : String(e));
    }
    if (res.ok) return res.json().catch(() => ({}));

    const detail = (await res.text().catch(() => '')).slice(0, 300);
    // Rozlišující chyby — každá posílá jinam, a slepit je do „ingest failed"
    // by stálo přesně ten čas, který stála 2026-08-29.
    if (res.status === 401) throw new IngestError('auth', `token odmítnut: ${detail}`);
    if (res.status === 409) throw new IngestError('busy', `ingest právě zpracovává — zkus později: ${detail}`);
    if (res.status === 421) {
      throw new IngestError(
        'host',
        `Host header není na allowlistu ingestu (421). Jméno se přeložilo a token sedí — ` +
          `chybí položka v AISHA_INGEST_ALLOWED_HOSTS. ${detail}`,
      );
    }
    throw new IngestError('server', `${res.status} ${detail}`);
  }

  /** Vloží soubor do vstupního adresáře ingestu. */
  async upload(name: string, bytes: Uint8Array): Promise<unknown> {
    if (!name || name.startsWith('.')) {
      throw new IngestError('transport', `nepřijatelné jméno souboru: '${name}'`);
    }
    return this.call(`/api/upload?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes as unknown as BodyInit,
    });
  }

  /** Spustí zpracování vstupu. */
  async run(mode: 'run' | 'dry-run' = 'run'): Promise<unknown> {
    return this.call('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
  }

  /** Vydá verify-gated balíček do drop adresáře (odkud ho bere li-driver). */
  async export(note?: string): Promise<unknown> {
    return this.call('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note ? { note } : {}),
    });
  }

  /** Probíhá teď zpracování? Čte se souběžně s během, zámek nebere. */
  async progress(): Promise<IngestProgress> {
    return (await this.call('/api/progress', { method: 'GET' })) as IngestProgress;
  }

  /** Doběhnuté běhy, nejnovější první. `ts` je čas DOBĚHNUTÍ podle hodin ingestu. */
  async runs(): Promise<{ runs?: IngestRunRow[] }> {
    return (await this.call('/api/runs', { method: 'GET' })) as { runs?: IngestRunRow[] };
  }

  /** Stav — bez pověření se nedostane ani sem, takže je to i test tokenu. */
  async health(): Promise<{ ok?: boolean; documents?: number; last_run?: string }> {
    return (await this.call('/api/health', { method: 'GET' })) as {
      ok?: boolean;
      documents?: number;
      last_run?: string;
    };
  }
}
