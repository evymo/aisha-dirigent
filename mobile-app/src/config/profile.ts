/**
 * Čím tenhle build JE — jediný běhový zdroj pro „která část appky je v téhle
 * appce". Sourozenec `brand.ts`: ten drží JMÉNO produktu, tenhle jeho ROZSAH.
 *
 * ⭐ PROČ TOHLE EXISTUJE. Zadání majitele (2026-08-19): *„umožnit ‚část'
 * stávající appky vydat jako exkluzivní appku pro nějaký účel — stejně tak
 * může být miniappka jen pro sběr stavů měřáků energií. Potřebujeme mít ale
 * jednotné místo pravdy, ať neudržujeme duplikovaný kód."*
 *
 * Appka řidiče (jen sekce `vyvoz`) a miniappka na odečty (jen `meridla`) jsou
 * TÝŽ KÓD nad jinými daty. Rozdíl mezi nimi je tenhle profil — několik řádků
 * v `version.json` instance — a nic jiného. Žádná větev `if (řidičská appka)`,
 * žádný druhý strom, žádný fork.
 *
 * ## Kde je které místo pravdy
 *
 * | otázka | pravda | tvar |
 * |---|---|---|
 * | co je v TÉHLE appce | `version.json` → `brand.appSlice` | DATA instance |
 * | co všechno JDE do appky dát | existující obrazovky a sekce | ODVOZENÉ |
 *
 * ⛔ Druhý řádek se schválně NIKDE nevypisuje. Ručně vedený seznam vedle
 * skutečnosti je druhá pravda, která tiše zetlí — v tomhle repu to naposledy
 * položilo `BlockRenderer` (seznam „známých block_type" vedle vlastních větví:
 * sedm typů kreslilo obsah a pod ním hlásilo „neznámý typ"). Brána si univerzum
 * proto HLEDÁ a měří jen PŘEBYTEK: profil nesmí jmenovat nic, co neexistuje.
 *
 * ## Co profil NEROZHODUJE
 *
 * ⚠️ Nároky. Co uživatel smí vidět, rozhoduje výhradně server
 * (`list_surface_sections`, `workflow_step_visible_to`). Profil je UŽŠÍ filtr
 * nad tím, co server vydal — nikdy širší. Dedikovaný build tedy nemůže nikomu
 * nic otevřít; může jen nenabídnout to, co k jeho účelu nepatří.
 *
 * @module
 */
import Constants from "expo-constants";

/**
 * Seznam z konfigurace Expa. Prázdný seznam je TÁŽ VĚC jako chybějící klíč, ne
 * třetí stav: „vydali jsme appku bez jediné sekce" není přání, je to překlep, a
 * tichý souhlas s ním by vyrobil appku s prázdnou navigací.
 */
function seznam(klic: string): readonly string[] | null {
  const raw = Constants.expoConfig?.extra?.[klic];
  if (!Array.isArray(raw)) return null;
  const items = raw.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
  return items.length > 0 ? items : null;
}

/**
 * Extranetové sekce, které tenhle build nabízí; `null` = všechny, které server
 * uživateli vydal (deštníkový build).
 */
export function appSections(): readonly string[] | null {
  return seznam("AISHA_APP_SECTIONS");
}

/**
 * Členské taby, které tenhle build nabízí; `null` = všechny (deštníkový build).
 * Prázdný seznam nelze vyjádřit záměrně — kdo taby nechce, je dedikovaný build
 * a ten je pozná podle `isDedicated()`.
 */
export function appTabs(): readonly string[] | null {
  return seznam("AISHA_APP_TABS");
}

/**
 * Je tohle appka na JEDNU věc?
 *
 * Odvozuje se z profilu, nedeklaruje se zvlášť — druhý příznak vedle seznamu by
 * šel nastavit proti sobě a někdo by pak řešil, který z nich platí.
 *
 * Důsledek pro UI: dedikovaný build nenabízí cestu „ven" (přepínač sekcí, odkaz
 * na taby). Ne proto, že by tam byla zamčená dvířka — prostě do téhle appky
 * nepatří.
 */
export function isDedicated(): boolean {
  return appSections() !== null || appTabs() !== null;
}

/**
 * Co tenhle build z vydaných sekcí nabízí — a co z profilu NESEDĚLO.
 *
 * ⛔ TOHLE UŽ JEDNOU BYLO NAPSANÉ ŠPATNĚ (a spravené v tomtéž dni): když profil
 * netrefil ani jednu vydanou sekci, funkce tiše propustila všechny. Znělo to
 * ohleduplně — „ať appka není prázdná" — ale je to přesně ten tichý rozumný
 * default, který si nevynutí pozornost: překlep `vyvozz` by vyrobil appku, co
 * vypadá hotově a ukazuje cizí sekci.
 *
 * ⭐ Univerzum sekcí se tu ODVODIT NEDÁ. Sekce jsou data instance (jiné repo,
 * `48_surface_sections.sql`, a nakonec živá DB), takže brána v repu platformy
 * je nezná — a brána, která si univerzum vymyslí, jen zdědí jeho díry. Jediné
 * poctivé měřidlo je proto BĚHOVÉ: server řekl, co vydal, a tahle funkce
 * vysloví rozdíl. Kdo ji volá, ten rozdíl musí ukázat, ne spolknout.
 *
 * Pořadí serveru se zachovává — pořadí sekcí je samo o sobě informace.
 */
export interface ProfileMatch<T> {
  /** Sekce, které tenhle build nabízí. Prázdné = profil nesedl na nic. */
  sections: readonly T[];
  /** Sekce jmenované profilem, které server NEVYDAL. Prázdné = vše sedí. */
  unmatched: readonly string[];
}

export function applyProfile<T extends { section: string }>(
  granted: readonly T[],
): ProfileMatch<T> {
  const allowed = appSections();
  if (!allowed) return { sections: granted, unmatched: [] };
  return {
    sections: granted.filter((s) => allowed.includes(s.section)),
    unmatched: allowed.filter((slug) => !granted.some((s) => s.section === slug)),
  };
}
