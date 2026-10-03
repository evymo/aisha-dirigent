/**
 * Simple i18n hook.
 * Loads translations from bundled JSON, supports cs/en.
 *
 * Brand interpolation: strings may contain {{brandFull}} (the app's product name,
 * = Constants.expoConfig.name ← version.json app.displayName) and {{brand}} (the
 * short brand token ← version.json brand.shortName via extra.AISHA_BRAND_SHORT).
 * This keeps the product name out of the i18n catalog so a white-label reskin —
 * which edits only version.json — reskins all in-app copy with no code change.
 */
import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import cs from "@/i18n/cs.json";
import en from "@/i18n/en.json";
import { BRAND_ASSISTANT, BRAND_FULL, BRAND_SHORT } from "@/config/brand";
import { doplnekInstance, prepis } from "@/config/slovnik";

interface TranslationNode { [key: string]: string | TranslationNode }
type Translations = TranslationNode;

const LOCALE_KEY = "aisha_dirigent_locale";

const locales: Record<string, Translations> = { cs: cs as Translations, en: en as Translations };

/** Interpolate the build's brand tokens into a resolved string. Cheap no-op when absent. */
export function applyBrand(value: string): string {
  if (value.indexOf("{{") === -1) return value;
  return value
    .replace(/\{\{brandFull\}\}/g, BRAND_FULL)
    .replace(/\{\{assistant\}\}/g, BRAND_ASSISTANT)
    .replace(/\{\{brand\}\}/g, BRAND_SHORT);
}

// English is the designed terminal failover locale (selectedLocale → en → key),
// not a hardcoded Czech default that would override the user's chosen language.
let currentLocale = "en";

/**
 * Kdo chce vědět, že se jazyk změnil.
 *
 * ⛔ NAMĚŘENO 2026-08-19 NA BĚŽÍCÍ APPCE: bez tohohle byla oprava volby jazyka
 * NEVIDITELNÁ. `useTranslation` si `currentLocale` okopíruje do `useState` PŘI
 * PŘIPOJENÍ a nikdo nesledoval, že se modulová hodnota později změní.
 * `initLocale()` přitom běží asynchronně (`restoreEnvironment().then(...)`),
 * tedy až PO vykreslení přihlašovací obrazovky — ta si vzala `en` a znovu se
 * nevykreslila nikdy. Test volby jazyka byl zelený a na displeji angličtina.
 *
 * ⭐ Proto se locale MĚNÍ VÝHRADNĚ přes `nastavLocale` — jediné místo, které
 * o změně řekne. Kdyby se `currentLocale` někde přiřadilo přímo, vada se vrátí
 * přesně v téhle podobě: správně spočítaná hodnota, kterou nikdo nezobrazí.
 */
const posluchaci = new Set<(l: string) => void>();

function nastavLocale(novy: string): void {
  if (novy === currentLocale) return;
  currentLocale = novy;
  for (const p of [...posluchaci]) p(novy);
}

function getNestedKey(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

export function useTranslation() {
  const [locale, setLocaleState] = useState(currentLocale);

  useEffect(() => {
    // Mezi renderem a tímhle efektem mohl jazyk dorazit — dorovnat, jinak by
    // komponenta připojená přesně v tu chvíli zůstala na staré hodnotě.
    if (currentLocale !== locale) setLocaleState(currentLocale);
    posluchaci.add(setLocaleState);
    return () => {
      posluchaci.delete(setLocaleState);
    };
    // `locale` schválně mimo závislosti: efekt se přihlašuje JEDNOU, dorovnání
    // je jen pojistka proti závodu při připojení.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      // Same {{placeholder}} syntax as the brand pass; brand runs first so
      // params cannot shadow {{brand}}/{{assistant}}.
      const interpolate = (value: string): string => {
        const branded = applyBrand(value);
        if (!params || branded.indexOf("{{") === -1) return branded;
        return branded.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
          name in params ? String(params[name]) : m,
        );
      };
      /**
       * ⭐ SLOVNÍK INSTANCE MÁ PŘEDNOST. Platforma mluví o „krocích procesu",
       * řidič o dodávkách — totéž tvrzení, jiné slovo, a to slovo je vlastnost
       * instance. Přepisuje se JEN to, co instance vyjmenovala; zbytek katalogu
       * platí beze změny (viz `config/slovnik.ts`).
       */
      const instancni = prepis(locale, key);
      if (instancni !== undefined) return interpolate(instancni);

      const translations = locales[locale] ?? locales.en;
      const value = getNestedKey(translations as Record<string, unknown>, key);
      if (value !== undefined) return interpolate(value);

      // Klíč, který zná jen instance (bloky, sekce, pole dat) — až po katalogu,
      // aby slovník instance potichu nezměnil text platformy.
      const jenInstance = doplnekInstance(locale, key);
      if (jenInstance !== undefined) return interpolate(jenInstance);

      // Fallback to English
      if (locale !== "en") {
        const enValue = getNestedKey(
          locales.en as Record<string, unknown>,
          key
        );
        if (enValue !== undefined) return interpolate(enValue);
        const enInstance = doplnekInstance("en", key);
        if (enInstance !== undefined) return interpolate(enInstance);
      }

      // Return key as last resort (makes missing translations visible)
      return key;
    },
    [locale]
  );

  const setLocale = useCallback(async (newLocale: string) => {
    nastavLocale(newLocale);
    await AsyncStorage.setItem(LOCALE_KEY, newLocale);
  }, []);

  return { t, locale, setLocale };
}

/** Load persisted locale on app start */
/**
 * Který jazyk zvolit. Čistá funkce — jde změřit bez zařízení i bez úložiště.
 *
 * Pořadí: ULOŽENÁ VOLBA → JAZYK ZAŘÍZENÍ → `en`.
 *
 * ⛔ NAMĚŘENO 2026-08-19 V SIMULÁTORU: jazyk zařízení se neptal NIKDO.
 * `initLocale` četla jen uloženou volbu, takže po čerstvé instalaci zůstalo
 * `en` — a český řidič dostal z TestFlightu anglickou aplikaci, dokud si jazyk
 * sám nepřepnul. Zařízení přitom hlásilo `cs-CZ` jako první volbu a `cs.json`
 * ten překlad měl.
 *
 * ⭐ Uložená volba má PŘEDNOST před zařízením: kdo si jazyk přepnul vědomě,
 * nesmí o něj přijít tím, že má telefon nastavený jinak.
 *
 * Značka jazyka se bere po pomlčku (`cs-CZ` → `cs`) — region nerozlišujeme.
 */
/** Kolik komponent právě poslouchá změnu jazyka. Jen pro měření. */
export function pocetPosluchacu(): number {
  return posluchaci.size;
}

export function vyberLocale(
  stored: string | null | undefined,
  jazykyZarizeni: readonly string[],
  podporovane: readonly string[],
): string {
  if (stored && podporovane.includes(stored)) return stored;
  for (const tag of jazykyZarizeni) {
    const zaklad = String(tag ?? "").split("-")[0].toLowerCase();
    if (podporovane.includes(zaklad)) return zaklad;
  }
  return "en";
}

export async function initLocale(): Promise<void> {
  let stored: string | null = null;
  try {
    stored = await AsyncStorage.getItem(LOCALE_KEY);
  } catch {
    // úložiště nedostupné — rozhodne jazyk zařízení
  }

  let jazyky: string[] = [];
  try {
    // Načítá se LÍNĚ: nativní modul se nesmí dostat do grafu testů, kde není
    // (táž past jako u `knock-native.ts` — první skutečný import shodil archiv).
    const { getLocales } = await import("expo-localization");
    jazyky = getLocales()
      .map((l) => l.languageTag ?? l.languageCode ?? "")
      .filter(Boolean);
  } catch {
    // bez nativního modulu rozhodne uložená volba, jinak `en`
  }

  nastavLocale(vyberLocale(stored, jazyky, Object.keys(locales)));
}
