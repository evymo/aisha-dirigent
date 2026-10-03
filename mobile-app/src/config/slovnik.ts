/**
 * Slovník instance — čím se v TÉHLE appce věci jmenují.
 *
 * ⭐ PROČ. Platforma mluví o „krocích procesu", protože obsluhuje libovolný
 * proces libovolného zákazníka. Řidič kamionu o krocích procesu nemluví: má
 * DODÁVKY. Odečtář má ODEČTY. Totéž tvrzení, jiné slovo — a to slovo je
 * vlastnost instance, ne platformy.
 *
 * ⛔ PROTO TO NENÍ V `cs.json`. Zapsat tam „Moje dodávky" znamená dostat jméno
 * jednoho zákaznického procesu do platformy, kterou používají i ostatní
 * (`instance názvy NEPATŘÍ do stack kódu`). Slovník proto žije v `version.json`
 * instance — v témž souboru jako `appSlice`, a ze stejného důvodu.
 *
 * ⛔ PŘEPISUJE, NEZAVÁDÍ. Klíč, který v základním katalogu není, je PŘEKLEP —
 * a musí být slyšet. Za běhu se to říct nedá (obrazovka se prostě nezeptá), tak
 * to měří `app.config.ts` PŘI BUILDU a build zastaví. Táž doktrína jako
 * u `appSlice`: profil nesmí jmenovat nic, co neexistuje.
 *
 * ⚠️ Sourozenec `brand.ts`: ten drží JMÉNO produktu (a interpoluje se do textů
 * jako `{{brandFull}}`), tenhle SLOVNÍK. Značka se dosazuje DOVNITŘ vět,
 * slovník mění CELÉ věty — proto dvě věci, ne jedna.
 *
 * @module
 */
import Constants from "expo-constants";

/** Plochá mapa `klíč → text` pro jeden jazyk. */
type Preklady = Record<string, string>;

/**
 * Načte se JEDNOU: `extra` se za běhu appky nemění a opakované procházení
 * neznámého objektu při každém `t()` by bylo jen práce navíc.
 *
 * Defenzivně: `version.json` píšou lidé. Cokoli, co není mapa řetězců, se tiše
 * přeskočí — o tom, že je slovník rozbitý, mluví brána při buildu, ne appka
 * v terénu.
 */
const SLOVNIK: Record<string, Preklady> = (() => {
  const raw = Constants.expoConfig?.extra?.AISHA_I18N_SLOVNIK as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, Preklady> = {};
  for (const [jazyk, mapa] of Object.entries(raw as Record<string, unknown>)) {
    if (!mapa || typeof mapa !== "object" || Array.isArray(mapa)) continue;
    const p: Preklady = {};
    for (const [k, v] of Object.entries(mapa as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() !== "") p[k] = v;
    }
    if (Object.keys(p).length > 0) out[jazyk] = p;
  }
  return out;
})();

/**
 * Co tenhle klíč znamená v TÉHLE instanci, nebo `undefined`.
 *
 * ⛔ ŽÁDNÝ PÁD NA JINÝ JAZYK. Slovník je částečný ze své podstaty — přepisuje
 * hrstku vět. Kdyby chybějící český překlep spadl na anglický, dostal by řidič
 * uprostřed české obrazovky anglickou větu; správná odpověď je „nemám" a
 * základní katalog, který je přeložený celý.
 */
export function prepis(locale: string, key: string): string | undefined {
  return SLOVNIK[locale]?.[key];
}

/** Má tenhle build vlastní slovník? Pro diagnostiku a testy. */
export function maSlovnik(): boolean {
  return Object.keys(SLOVNIK).length > 0;
}

/**
 * SLOVNÍK INSTANCE (`i18n.json` instance → `extra.AISHA_I18N_INSTANCE`): klíče, které
 * platforma NEZNÁ — názvy bloků a sekcí, popisky polí dat instance. Na rozdíl od
 * `brand.slovnik` nepřepisuje: `t()` se ho ptá AŽ když katalog platformy klíč nemá.
 * Bez něj řidič viděl na pásce „block.vyvoz.handover“ (naměřeno 2026-09-29).
 */
const INSTANCE: Record<string, Preklady> = (() => {
  const raw = Constants.expoConfig?.extra?.AISHA_I18N_INSTANCE as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, Preklady> = {};
  for (const [jazyk, mapa] of Object.entries(raw as Record<string, unknown>)) {
    if (!mapa || typeof mapa !== "object" || Array.isArray(mapa)) continue;
    const p: Preklady = {};
    for (const [k, v] of Object.entries(mapa as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() !== "") p[k] = v;
    }
    out[jazyk] = p;
  }
  return out;
})();

/** Překlad klíče, který zná jen instance (platforma ho nemá). */
export function doplnekInstance(locale: string, key: string): string | undefined {
  return INSTANCE[locale]?.[key];
}
