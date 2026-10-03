/**
 * PRŮVODCE TABLETU — kde tablet je na cestě „zavedení → schválení → dveře → relace"
 * a co udělá SÁM (majitel 29. 9.: „nezjednodušuj, dotáhni to k dokonalosti, ať to
 * můžeme nasadit na tablety a dát je řidičům").
 *
 * Tablet v kabině nikdo neobsluhuje. Dřív měl tři ruční tlačítka (Zaklepat, Ohlásit
 * znovu, Zkusit znovu) a každé z nich byl krok, na který se čekalo, až si ho někdo
 * všimne. Teď dělá člověk JEDINOU věc — technik zadá kód dveří — a všechno ostatní
 * tablet dotáhne sám: ohlásí se, hlídá schválení, po schválení si otevře dveře
 * vlastním průkazem a vezme si relaci.
 *
 * ⭐ ČISTÉ PRAVIDLO. Obrazovka i test měří totéž rozhodnutí; síť, klíč a čas přicházejí
 *    jako stav, ne jako volání.
 *
 * ⛔ O PRŮKAZU ROZHODUJE BRÁNA, NE KLIENT. Průvodce jen čte, co brána řekla
 *    (`/device/stav`, `/device/session`) — nikdy nic nedomýšlí a nic nezakládá sám:
 *    klíč vzniká jen po zaťukání technika (lidský úkon).
 */
import type { VysledekRelace } from "./relaceTabletu";
import type { VysledekTabletu } from "./ohlaseniTabletu";

/** Co víme o klíči v úložišti tabletu. */
export type StavKlice = "nevim" | "nema" | "ma" | "vadny";

export type KrokTabletu =
  /** Ještě nevíme — čte se úložiště a brána. */
  | { krok: "nacitam" }
  /**
   * Potřebuje TECHNIKA: klíč není, nebo ho brána nezná (smazaný / ohlášení se nepovedlo).
   * Jediná ruční věc celé cesty — kód dveří.
   */
  | { krok: "zavedeni"; proc: "bez-klice" | "nezname" }
  /** Ohlášený, čeká na správce. Tablet se ptá sám. */
  | { krok: "ceka"; kid: string }
  /** Schválený — otevírá si dveře vlastním průkazem a bere si relaci. */
  | { krok: "pripojuji" }
  | { krok: "odvolano" }
  /** Průkaz platí jen do `plati_do` — správce ho musí obnovit (není to odvolání ani porucha). */
  | { krok: "vyprselo" }
  /** Klíč v úložišti je nečitelný — řeší servis (zapomenout a zavést znovu). */
  | { krok: "vadny-klic" }
  /** Spojení nejde, ale o průkazu to nic neříká — zkouší se dál. */
  | { krok: "porucha"; duvod: string }
  | { krok: "hotovo" };

export interface VstupPruvodce {
  klic: StavKlice;
  /** Poslední odpověď `/device/stav` (null = ještě se neptal). */
  prukaz: VysledekTabletu | null;
  /** Poslední pokus o relaci (null = ještě nebyl). */
  relace: VysledekRelace | null;
}

export function krokTabletu(v: VstupPruvodce): KrokTabletu {
  if (v.klic === "nevim") return { krok: "nacitam" };
  if (v.klic === "vadny") return { krok: "vadny-klic" };
  if (v.klic === "nema") return { krok: "zavedeni", proc: "bez-klice" };

  // Relace je nejsilnější důkaz: brána klíč zná, průkaz platí a dveře jsou otevřené.
  if (v.relace?.stav === "ok") return { krok: "hotovo" };

  // Výslovné odvolání platí, ať ho řekla kterákoli cesta.
  if (v.prukaz?.stav === "odvolano") return { krok: "odvolano" };
  if (v.relace?.stav === "neschvaleno" && v.relace.duvod === "odvolano") return { krok: "odvolano" };
  if (v.relace?.stav === "neschvaleno" && (v.relace.duvod === "vyprselo" || v.relace.duvod === "neplatne")) {
    return { krok: "vyprselo" };
  }

  if (v.prukaz?.stav === "nezname" || v.relace?.stav === "nezname") return { krok: "zavedeni", proc: "nezname" };
  if (v.prukaz?.stav === "ceka") return { krok: "ceka", kid: v.prukaz.kid };
  if (v.prukaz?.stav === "schvaleno") return { krok: "pripojuji" };

  // Stav průkazu zatím nevíme: rozhodne relace, jinak se čeká na první odpověď.
  if (v.relace?.stav === "neschvaleno" && v.relace.duvod === "ceka") return { krok: "nacitam" };
  if (v.prukaz?.stav === "selhalo") return { krok: "porucha", duvod: v.prukaz.duvod };
  if (v.relace?.stav === "selhalo") return { krok: "porucha", duvod: v.relace.duvod };
  return { krok: "nacitam" };
}

/** Kdy se tablet zeptá znovu SÁM (ms). `null` = čeká na člověka. */
export const INTERVAL_CEKA_MS = 30_000;
export const INTERVAL_ODVOLANO_MS = 5 * 60_000;
/** Připojování po schválení: roster dveří se na straně svc-knock obnovuje s odstupem. */
const PRIPOJUJI_MS = [5_000, 15_000, 30_000, 60_000];
const PORUCHA_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000];

/**
 * Za jak dlouho další samostatný pokus. `pokus` = kolikátý neúspěch v řadě (0 = první).
 * Odstup roste, ale má strop — tablet na LTE mění adresu a to, že teď neprošlo,
 * neříká, že neprojde za minutu.
 */
export function dalsiPokusZa(k: KrokTabletu, pokus: number): number | null {
  const i = Math.max(0, Math.trunc(pokus));
  switch (k.krok) {
    case "ceka":
      return INTERVAL_CEKA_MS;
    case "pripojuji":
      return PRIPOJUJI_MS[Math.min(i, PRIPOJUJI_MS.length - 1)];
    case "porucha":
      return PORUCHA_MS[Math.min(i, PORUCHA_MS.length - 1)];
    case "odvolano":
    case "vyprselo":
      // Správce to může napravit — tablet se po čase zeptá sám, ať ho nikdo nemusí restartovat.
      return INTERVAL_ODVOLANO_MS;
    case "nacitam":
      return PRIPOJUJI_MS[0];
    default:
      // zavedeni, vadny-klic: čeká se na člověka; hotovo: relaci drží zdroj sám.
      return null;
  }
}

/** Výsledek zavedení technikem — co mu obrazovka řekne. */
export type VysledekZavedeni =
  | { vysledek: "ohlaseno"; prukaz: VysledekTabletu }
  /** Rámec neodešel (síť, konfigurace) — technik to vidí hned. */
  | { vysledek: "neodeslano"; duvod: string }
  /**
   * Zaťukáno, ale brána dveře za otevřené nemá. Dveře mlčí vždy, takže se nedá
   * rozlišit špatný kód od ztraceného rámce — řekne se obojí.
   */
  | { vysledek: "dvere-zavrene" }
  | { vysledek: "chyba"; duvod: string };

export interface ZavedeniDeps {
  zatukejKodem: (kod: string) => Promise<{ sent: boolean; error?: string }>;
  pockej: (ms: number) => Promise<void>;
  maKlic: () => Promise<boolean>;
  zalozKlic: () => Promise<void>;
  ohlas: () => Promise<VysledekTabletu>;
}

/** Jak dlouho se po zaťukání čeká, než dveře stihnou otevřít (jako u samo-klepání). */
export const PO_ZATUKANI_MS = 1_500;

/**
 * JEDEN úkon technika: kód → zaťukat → (klíč) → ohlásit. Klíč se zakládá AŽ PO
 * odeslaném zaťukání — průkaz vzniká jen lidským úkonem u dveří, ne při startu appky.
 * Ohlášení zkusí dvakrát: rámec UDP se po LTE může ztratit, druhý pokus je levný.
 */
export async function zavedTablet(kod: string, deps: ZavedeniDeps): Promise<VysledekZavedeni> {
  try {
    const tuk = await deps.zatukejKodem(kod);
    if (!tuk.sent) return { vysledek: "neodeslano", duvod: tuk.error ?? "?" };
    await deps.pockej(PO_ZATUKANI_MS);
    if (!(await deps.maKlic())) await deps.zalozKlic();
    let prukaz = await deps.ohlas();
    if (prukaz.stav === "dvere-zavrene") {
      await deps.pockej(PO_ZATUKANI_MS * 2);
      prukaz = await deps.ohlas();
    }
    if (prukaz.stav === "dvere-zavrene") return { vysledek: "dvere-zavrene" };
    return { vysledek: "ohlaseno", prukaz };
  } catch (e) {
    return { vysledek: "chyba", duvod: e instanceof Error ? e.message : String(e) };
  }
}
