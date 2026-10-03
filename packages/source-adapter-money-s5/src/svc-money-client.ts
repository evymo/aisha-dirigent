/**
 * Klient, který na Money NECHODÍ SÁM — půjčuje si cestu u `svc-money`.
 *
 * ⭐ JEDEN TUNEL, JEDEN VLASTNÍK (rozhodnutí majitele 2026-08-27).
 * Infrastruktura a datová komunikace jsou dvě různé věci: kdo chce data, řekne
 * si o cestu; kdo cestu drží, o rozvrhu nic neví. `svc-money` má `NET_ADMIN`,
 * `/dev/net/tun` a VPN profil; broker má první dvě věci taky, ale profil
 * nedostává — a je to tak správně.
 *
 * ⛔ PROČ NE DRUHÝ TUNEL: naměřeno 2026-08-27, protistrana nesnese souběžná
 * sezení téhož účtu. Když jeden klient odejde náhle, server jeho sezení chvíli
 * drží a další pokus dostane `Connection reset`. Dva tunely na jeden účet by
 * z toho udělaly trvalý stav.
 *
 * Tvar odpovědi Money se NEPŘEKLÁDÁ: `svc-money /query` vrací obálku, jakou
 * dostal (`{ Data, Status, RowCount, Message }`), takže mapování výš zůstává
 * beze změny a existuje jen JEDNOU.
 */

export interface SvcMoneyClientOptions {
  /** Základ `svc-money`, např. `http://<prefix>-svc-money:3016`. */
  baseUrl: string;
  /** Pověření k `svc-money` (NE k Money). */
  apiToken: string;
  /** Klíč agendy, pod kterým `svc-money` zná cíl a jeho pověření. */
  agenda: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class SvcMoneyError extends Error {
  constructor(readonly status: number, message: string) {
    super(`SVC_MONEY: ${message}`);
    this.name = 'SvcMoneyError';
  }
}

export class SvcMoneyClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: SvcMoneyClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    if (!opts.baseUrl) throw new Error('SVC_MONEY: chybí baseUrl');
    if (!opts.apiToken) throw new Error('SVC_MONEY: chybí apiToken — služba odmítá vše');
    if (!opts.agenda) throw new Error('SVC_MONEY: chybí agenda — cíl se NEODVOZUJE');
  }

  /**
   * Token k Money si drží `svc-money`; ven ho nevydává a nemá proč.
   *
   * Metoda tu je kvůli tvarové shodě s `MoneyS5Client` (společné rozhraní),
   * ale volat ji je vada v návrhu volajícího — proto selže nahlas místo aby
   * vrátila prázdno.
   */
  async getToken(): Promise<string> {
    throw new Error(
      'SVC_MONEY: token k Money drží svc-money a ven ho nevydává — ' +
        'dotazy posílej přes graphql(), ne přes vlastní autorizaci',
    );
  }

  /** Pošle dotaz přes `svc-money`; ten si sám vypůjčí cestu a zase ji vrátí. */
  async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const ovladac = new AbortController();
    const casovac = setTimeout(() => ovladac.abort(), this.opts.timeoutMs ?? 90_000);
    try {
      const odpoved = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/+$/, '')}/query`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.opts.apiToken}`,
        },
        body: JSON.stringify({ agenda: this.opts.agenda, query, variables }),
        signal: ovladac.signal,
      });
      const text = await odpoved.text();
      if (!odpoved.ok) {
        // Chyba se PŘEDÁVÁ celá. `svc-money` do ní dává důvod (např. že tunel
        // nenaběhl); uříznout ji tady by z diagnózy udělalo hádanku.
        throw new SvcMoneyError(odpoved.status, text.slice(0, 400) || `HTTP ${odpoved.status}`);
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new SvcMoneyError(odpoved.status, `odpověď není JSON: ${text.slice(0, 200)}`);
      }
    } finally {
      clearTimeout(casovac);
    }
  }
}
