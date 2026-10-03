/**
 * Obsluha žebříčku ke dveřím — cesta mezi PRAVIDLEM a SKUTKEM.
 *
 * ⛔ PROČ TENHLE SOUBOR VZNIKL. `dvereEskalace.ts` (20. 8.) zapsalo zadání
 * majitele přesně a doložilo ho testy — a pak devatenáct dní NIKDO v produkci
 * `dalsiKrokDveri()` nezavolal. Pravidlo mělo domov i konzumenta (obrazovky,
 * které nabízejí zaťukání), ale mezi nimi nevedla cesta. Zelené brány o tom
 * mlčely: pravidlo je testované, jen se neděje.
 *
 * ⭐ ZADÁNÍ (majitel, 9. 9.): *„aplikace nezjistí, jestli je schválená, jinak
 * než tím, že po zaklepání stále nemá přístup k endpointům — a pak má smysl
 * nabídnout uživateli ruční zaklepání platným kódem."* Tenhle modul je přesně
 * ta věta v kódu: NEPTÁ SE na stav, jedná podle výsledku POKUSU.
 *
 * ⭐ ROZDĚLENÍ ROLÍ (proč tři soubory, ne jeden):
 *   · `dvereEskalace.ts`  — PRAVIDLO (čistá tabulka, žádné I/O),
 *   · `obsluhaDveri.ts`   — POŘADÍ ÚKONŮ (čisté, závislosti injektované),
 *   · `knock-native.ts`   — PLATFORMA (SecureStore, quick-crypto, UDP).
 * Díky tomu jde pořadí úkonů testovat bez telefonu a bez linkování C++.
 *
 * ⛔ AUTOMATIKA NESMÍ SAMA VYROBIT SVOU VSTUPENKU. Čte se `nactiPovereni`,
 * které pověření NEZAKLÁDÁ. Kdyby se tu volalo `povereniZarizeni()` (vyrob
 * nebo přečti), měl by průkaz každý telefon hned při prvním selhání a podmínka
 * „zařízení je důvěryhodné" by neznamenala vůbec nic. Pár vzniká jen na
 * výslovný lidský úkon při zavedení zařízení.
 */
import { dalsiKrokDveri, type DuvodRucniho } from "./dvereEskalace";
import type { KnockResult } from "./knock";
import type { PovereniZarizeni } from "./poverovani-zarizeni";

export interface ObsluhaDveriDeps {
  /** Přečte průkaz zařízení. Vrací `null`, když žádný není. NIKDY nezakládá. */
  nactiPovereni: () => Promise<PovereniZarizeni | null>;
  /** Zaťuká průkazem zařízení. `sent: true` znamená „odešlo", ne „otevřeno". */
  zatukejZarizenim: (p: PovereniZarizeni) => Promise<KnockResult>;
  /** Paměť jednoho pokusu — drží ji volající, ne tenhle modul (viz `pametPokusu`). */
  pamet: PametPokusu;
}

export interface PametPokusu {
  uzZatukano: () => boolean;
  oznacZatukano: () => void;
  novyPokus: () => void;
}

/** Co má volající udělat dál. */
export type VysledekDveri =
  /** Dosažitelné — nic se neděje. */
  | { krok: "pokracuj" }
  /** Zaťukáno průkazem zařízení. Volající to má ZKUSIT ZNOVU — dveře mlčí. */
  | { krok: "zkus-znovu"; kid: string }
  /** Na řadě je člověk. `duvod` rozhoduje, co se mu napíše. */
  | { krok: "nabidni-rucni"; duvod: DuvodRucniho; diagnostika?: string };

/**
 * Paměť „už jsem v tomhle pokusu ťukal".
 *
 * ⛔ MUSÍ BÝT SDÍLENÁ MEZI OBRAZOVKAMI. Dvě obrazovky s vlastní pamětí = dvě
 * automatická zaťukání na jeden výpadek, a `SPA_MAX_INVALID` je 10 v okně 60 s
 * s cooldownem 300 s. Appka by si tak sama zavřela dveře, které otevírá.
 */
export function pametPokusu(): PametPokusu {
  let zatukano = false;
  return {
    uzZatukano: () => zatukano,
    oznacZatukano: () => { zatukano = true; },
    novyPokus: () => { zatukano = false; },
  };
}

/**
 * Jeden krok žebříčku.
 *
 * @param dosazitelne výsledek POSLEDNÍHO POKUSU o request, ne domněnka o dveřích.
 *
 * ⭐ `dosazitelne: true` paměť ČISTÍ. Až se to příště rozbije, je to nový
 * výpadek a zařízení smí zaťukat znovu — jinak by po prvním neúspěchu ťukala
 * automatika už jen do dalšího startu appky, i kdyby správce zařízení mezitím
 * schválil.
 *
 * ⛔ NEČITELNÝ PRŮKAZ POSÍLÁ ČLOVĚKA, NEPADÁ. `nactiPovereni` schválně vyhodí
 * (rozbité ≠ chybějící), ale tady jsme na cestě, jejímž smyslem je, aby se
 * uživatel dostal dovnitř. Výjimka by z rozbitého keychainu udělala cihlu —
 * a přesně tomu má žebříček bránit (viz hlavička `dvereEskalace.ts`). Chyba se
 * proto NEPOLYKÁ, jde ven jako `diagnostika`.
 */
export async function zkusDvere(
  dosazitelne: boolean,
  deps: ObsluhaDveriDeps,
): Promise<VysledekDveri> {
  if (dosazitelne) {
    deps.pamet.novyPokus();
    return { krok: "pokracuj" };
  }

  let povereni: PovereniZarizeni | null = null;
  let diagnostika: string | undefined;
  try {
    povereni = await deps.nactiPovereni();
  } catch (e) {
    diagnostika = e instanceof Error ? e.message : String(e);
  }

  const rozhodnuti = dalsiKrokDveri({
    dosazitelne: false,
    maPovereniZarizeni: povereni !== null,
    uzZatukano: deps.pamet.uzZatukano(),
  });

  if (rozhodnuti.krok === "nabidni-rucni")
    return { krok: "nabidni-rucni", duvod: rozhodnuti.duvod!, diagnostika };

  // `zatukej-sam` — a JEN JEDNOU. Značka se zvedá PŘED odesláním: kdyby se
  // zvedala až po úspěchu, dvě souběžná selhání by proklouzla obě.
  deps.pamet.oznacZatukano();
  const vysledek = await deps.zatukejZarizenim(povereni!);
  if (!vysledek.sent) {
    // Datagram neodešel (letadlový režim, DNS). To NENÍ „dveře mlčí" — tohle je
    // ten jediný rozdíl, který klient poznat může, a musí ho vyslovit.
    return { krok: "nabidni-rucni", duvod: "automatika-neprosla", diagnostika: vysledek.error };
  }
  return { krok: "zkus-znovu", kid: vysledek.kid };
}
