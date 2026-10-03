import { zeSuroveDeklarace, type StavZarizeni } from './zarizeni.js';

/**
 * Zdroj deklarace NEODPOVĚDĚL. Není to „vypnuto" ani „nic nedeklarováno" —
 * trasy vrátí 503 a srovnání úložiště počká. Kiosk v tu noc nic neinstaluje (to
 * umí); STARÁ deklarace odjinud by byla horší než žádná.
 */
export class DeklaraceNedostupna extends Error {
  constructor(duvod: string) {
    super(`deklarace zařízení je nedostupná: ${duvod}`);
    this.name = 'DeklaraceNedostupna';
  }
}

/**
 * ODKUD storage-auth bere deklaraci zařízení (Kiosk Admin, rozdávané appky).
 *
 * ⛔ JEDEN ZDROJ, VYBRANÝ VÝSLOVNĚ — žádný souběh ani „záloha". Kdyby se při
 *    nedostupnosti jednoho zdroje tiše četl druhý, kiosk by dostal STAROU
 *    deklaraci a nikdo by to nepoznal. Nedostupný zdroj = chyba, ne jiná pravda.
 *
 * Domov: databáze (`zarizeni_deklarace`), kam deklaraci DOSLOVNĚ zapisuje hák dat
 * instance při nasazení core. Do 2026-09 to byl env `ZARIZENI_HLIDAC` (derivace
 * doktorem → trezor → Coolify); trezor je ale mimo CI, takže „samo po vyžádání“
 * skončilo ručním zápisem. Přechod byl výměnou implementace tohoto rozhraní,
 * ne druhým zdrojem vedle.
 */
export interface ZdrojDeklarace {
  /** Pro log a administraci: odkud deklarace přišla. */
  readonly odkud: string;
  nacti(): Promise<StavZarizeni>;
}

/**
 * Deklarace z databáze — `zarizeni_deklarace_cteni()` přes PostgREST jako service
 * role. Zapisuje ji hák dat instance při nasazení core (doslovný `hlidac.json`).
 * NULL = instance nic nedeklarovala (vypnuto); chyba spojení/HTTP = NEDOSTUPNÁ.
 */
export function deklaraceZDb(o: { postgrestUrl: string; token: string; f?: typeof fetch; limitMs?: number }): ZdrojDeklarace {
  const f = o.f ?? fetch;
  return {
    odkud: 'databáze (zarizeni_deklarace_cteni)',
    nacti: async () => {
      if (!o.postgrestUrl || !o.token) throw new DeklaraceNedostupna('chybí POSTGREST_URL nebo POSTGREST_SERVICE_TOKEN');
      let res: Response;
      try {
        res = await f(`${o.postgrestUrl}/rpc/zarizeni_deklarace_cteni`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.token}` },
          body: '{}',
          signal: AbortSignal.timeout(o.limitMs ?? 10_000),
        });
      } catch (e) {
        throw new DeklaraceNedostupna(String((e as Error)?.message ?? e));
      }
      if (!res.ok) throw new DeklaraceNedostupna(`RPC vrátilo ${res.status}`);
      const telo = (await res.json().catch(() => undefined)) as { deklarace?: unknown } | null | undefined;
      if (telo === undefined) throw new DeklaraceNedostupna('RPC nevrátilo JSON');
      return zeSuroveDeklarace(telo === null ? null : telo.deklarace);
    },
  };
}

