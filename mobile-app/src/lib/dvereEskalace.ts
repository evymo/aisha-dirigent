/**
 * Co dělat, když se appka nemá kam připojit — žebříček ke dveřím.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-08-20): *„první, nebo v případě nemožnosti zaťukat
 * automaticky, ťuká uživatel. Pokud appka může zaťukat, tak ťuká. Pokud zaťuká
 * automatika a nemůže se pořád přihlásit, asi to je třeba dořešit — zkuste
 * zadat ruční kód, automatika nefunguje. Protože můžeme to zařízení udělat
 * neautorizovaným a nešlo by se dostat do režimu mít možnost zaťukat ručně."*
 *
 * ⛔ TA POSLEDNÍ VĚTA JE CELÝ DŮVOD, PROČ TENHLE SOUBOR EXISTUJE. Odvolání
 * pověření zařízení nesmí z telefonu udělat cihlu: ruční cesta musí zůstat
 * dosažitelná VŽDY, ne až jako odměna za úspěšné přihlášení.
 *
 * ⛔ PROČ SE NEDÁ ZEPTAT „JSOU DVEŘE ZAVŘENÉ?". Dveře MLČÍ i při úspěchu.
 * Zavřené dveře, odvolané pověření, mrtvá síť a spadlý server vypadají zvenčí
 * identicky. Jediný pozorovatelný jev je ZMĚNA: bylo to nedosažitelné, zaťukal
 * jsem, je to dosažitelné? Proto se sem nedává „stav dveří", ale výsledek
 * POKUSU.
 *
 * ⛔ NEJVÝŠ JEDNO AUTOMATICKÉ ZAŤUKÁNÍ NA POKUS. `SPA_MAX_INVALID` je 10
 * v okně 60 s a překročení znamená cooldown 300 s — smyčka, která ťuká po
 * každém neúspěchu, si tedy sama zavře dveře, které se snaží otevřít. Zákon
 * instance to říká i bez toho: appka nesmí ťukat z retry smyčky.
 *
 * @module
 */

/** Co se má stát dál. */
export type KrokDveri =
  /** Dosažitelné — nic se nedělá. */
  | "pokracuj"
  /** Zaťukat průkazem zařízení. Automaticky, ale JEN JEDNOU za pokus. */
  | "zatukej-sam"
  /** Požádat člověka o kód — a říct proč. */
  | "nabidni-rucni";

/** Proč se žádá člověk. Rozhoduje o tom, co se mu napíše. */
export type DuvodRucniho =
  /** Zařízení průkaz nemá (nikdy neměl, nebo byl odvolán). */
  | "bez-povereni"
  /** Zařízení zaťukalo a pořád to nejde — průkaz nejspíš neplatí. */
  | "automatika-neprosla";

export interface StavDveri {
  /** Dosáhli jsme na server? Výsledek POKUSU, ne domněnka o dveřích. */
  dosazitelne: boolean;
  /** Má tenhle telefon průkaz zařízení? */
  maPovereniZarizeni: boolean;
  /** Zaťukali jsme už v rámci TOHOHLE pokusu? */
  uzZatukano: boolean;
}

export interface RozhodnutiDveri {
  krok: KrokDveri;
  /** Vyplněné jen u `nabidni-rucni`. */
  duvod?: DuvodRucniho;
}

/**
 * Další krok. Čistá tabulka — rozhoduje o tom, jestli se člověk dostane dovnitř.
 *
 * ⚠️ `dosazitelne: true` vyhrává VŽDY, i bez průkazu a bez zaťukání: když to
 * jde, nemá se nic dělat. Ťukat „pro jistotu" by byl přesně ten zvyk, kvůli
 * kterému break-glass materiál přestane být break-glass.
 */
export function dalsiKrokDveri(s: StavDveri): RozhodnutiDveri {
  if (s.dosazitelne) return { krok: "pokracuj" };

  // Bez průkazu není co zkusit automaticky — rovnou člověk.
  if (!s.maPovereniZarizeni) return { krok: "nabidni-rucni", duvod: "bez-povereni" };

  // ⛔ Druhé automatické zaťukání se NEDĚLÁ. Když první neprošlo, druhé
  // nepomůže (týž průkaz, tytéž dveře) a jen přibližuje cooldown.
  if (s.uzZatukano) return { krok: "nabidni-rucni", duvod: "automatika-neprosla" };

  return { krok: "zatukej-sam" };
}
