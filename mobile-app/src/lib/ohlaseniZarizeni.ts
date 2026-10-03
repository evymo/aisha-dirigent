/**
 * Ohlášení průkazu zařízení backendu — poslední článek řetězu ke schválení.
 *
 * ⭐ ZADÁNÍ MAJITELE (9. 9.): *„posílat otisk správci je hovadina, ten se má
 * stát součástí zaklepání a administrátor ho dostane a může ho schválit, aniž
 * by mu uživatel aplikace musel něco posílat."* a *„pokud uživatel na začátku
 * zaklepe ručně a pak se přihlásí, tak máme tím pádem spojenou informaci
 * o tom, na koho je vázán tablet."*
 *
 * Kořen důvěry je RUČNÍ ZAKLEPÁNÍ ČLOVĚKEM. Teprve otevřenými dveřmi se dá
 * přihlásit — a přihlášení nese identitu. Otisk tedy stačí ohlásit po
 * přihlášení a dorazí správci i s tím, komu patří. Nikdo nic neopisuje.
 *
 * ⛔ OHLÁŠENÍ NIC NEPOVOLUJE. `register_knock_device` schválit NEUMÍ (viz jeho
 * hlavička v SQL) — kdyby uměla, stačilo by se přihlásit a zařízení by si
 * otevřelo dveře samo. Schválení má vlastní RPC pro správce.
 *
 * ⛔ NEÚSPĚCH NESMÍ SHODIT PŘIHLÁŠENÍ. Neohlášený otisk znamená, že se zařízení
 * neobjeví v administraci — je to CHYBĚJÍCÍ POZOROVÁNÍ, ne důvod nepustit
 * řidiče k práci. Nesmí se ale ani spolknout: vrací se jako stav, který
 * volající zaloguje. Tichý neúspěch by vypadal jako „správce mě neschválil",
 * což je úplně jiná porucha a řešila by se jinde.
 */
import type { PovereniZarizeni } from "./poverovani-zarizeni";

export interface OhlaseniZarizeniDeps {
  /** Čte průkaz. `null` = zařízení není zavedené. NIKDY nezakládá. */
  nactiPovereni: () => Promise<PovereniZarizeni | null>;
  /** Volání `register_knock_device`. Chybu VYHAZUJE, nepolyká. */
  ohlas: (v: OhlaseniVstup) => Promise<void>;
}

export interface OhlaseniVstup {
  kid: string;
  publicKeyHex: string;
  scope: string;
  /** Most k push kanálu (`mobile_sessions.device_id`). `null` = most nevznikne. */
  pushDeviceId: string | null;
}

export type VysledekOhlaseni =
  | { stav: "ohlaseno"; kid: string }
  /** Zařízení nemá průkaz — není co ohlašovat. NENÍ to chyba. */
  | { stav: "neni-co" }
  | { stav: "selhalo"; duvod: string };

/**
 * Ohlásí průkaz, pokud nějaký je.
 *
 * ⭐ VOLÁ SE OPAKOVANĚ A JE TO ZÁMĚR. RPC je upsert, takže každé přihlášení
 * osvěží `last_seen_at` i most na push. Právě z toho opakování vzniká odpověď
 * na otázku „kdo používá která zařízení" — jednorázová registrace by ukázala
 * jen ten první den.
 *
 * ⛔ MOST SMÍ CHYBĚT. Když si appka push id nevyzvedla (uživatel odmítl
 * oznámení), ohlásí se otisk bez něj: schvalovat jde pořád, jen nepůjde poslat
 * oznámení. To je pravdivější než vymyšlené id, které by ukazovalo do prázdna.
 */
export async function ohlasZarizeni(
  pushDeviceId: string | null,
  deps: OhlaseniZarizeniDeps,
): Promise<VysledekOhlaseni> {
  let povereni: PovereniZarizeni | null;
  try {
    povereni = await deps.nactiPovereni();
  } catch (e) {
    // Rozbitý průkaz se řeší na obrazovce dveří („zapomeň a zaveď znovu"),
    // ne tady. Tady se o něm jen ví.
    return { stav: "selhalo", duvod: e instanceof Error ? e.message : String(e) };
  }
  if (povereni === null) return { stav: "neni-co" };

  try {
    await deps.ohlas({
      kid: povereni.kid,
      publicKeyHex: povereni.publicKeyHex,
      scope: povereni.scope,
      pushDeviceId,
    });
  } catch (e) {
    return { stav: "selhalo", duvod: e instanceof Error ? e.message : String(e) };
  }
  return { stav: "ohlaseno", kid: povereni.kid };
}

