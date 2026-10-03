/**
 * LanguageSwitcherBlock — volba jazyka JAKO BLOK PLÁTNA, ne platformní chrome.
 *
 * ⛔ PROČ NE STÁVAJÍCÍ `LanguageSwitcher` (naměřeno 2026-09-01).
 * Ten je stavěný z platformních dílů (`Button variant="ghost"`, shadcn
 * `DropdownMenu`) a v modré liště webu by vypadal jako cizí prvek — týž rozpor,
 * kvůli kterému vznikl `article-detail`. Navíc si nese natvrdo zapsaný seznam
 * `fallbackLanguages = [en, cs]` pro případ nedostupné DB: na veřejném webu by
 * to návštěvníkovi TVRDILO, že existují dva jazyky, i když jich instance
 * nabízí osm. Nepravda o cizí věci je horší než chybějící ovládací prvek.
 *
 * ⛔ `global` NENÍ JAZYK. `get_supported_languages` vrací na téhle instanci
 * devět položek a jedna z nich je `global:Global` — pseudo-locale pro obsah bez
 * jazyka. Do nabídky pro návštěvníka nepatří. Nefiltruje se podle jména (to by
 * byla magická konstanta), ale podle tvaru: jazyk se identifikuje kódem
 * ISO 639-1, případně s regionem. Co tak nevypadá, není volba jazyka.
 *
 * Zástupný symbol v editoru:
 *   <div data-runtime-block="language-switcher"></div>
 *
 * @module
 */
import { useTranslation } from "react-i18next";
import { useSupportedLanguages } from "@/hooks/useSupportedLanguages";
import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

/** ISO 639-1, volitelně s regionem (`cs`, `pt-BR`). `global` tím propadne. */
const KOD_JAZYKA = /^[a-z]{2}(-[a-z]{2})?$/i;

interface Jazyk {
  code: string;
  name_native: string;
}

/**
 * Runtime blok: volba jazyka v hlavičce webu.
 *
 * Konfigurace: `{ popisek?: string }` — `aria-label` ovládacího prvku.
 */
export function LanguageSwitcherBlock({ config }: RuntimeBlockProps) {
  const { i18n } = useTranslation();
  const { data } = useSupportedLanguages(true);
  const popisek = typeof config?.popisek === "string" ? config.popisek : "Language";

  const jazyky = ((data ?? []) as Jazyk[]).filter(
    (j) => typeof j?.code === "string" && KOD_JAZYKA.test(j.code) && j.name_native,
  );

  // ⛔ NEZNÁMÝ SEZNAM SE NENAHRAZUJE DOMNĚNKOU. Dokud jazyky nedorazí — nebo
  // když by zbyl jediný — nemá se z čeho vybírat a prvek se nekreslí. Nabídka
  // se dvěma vymyšlenými položkami by lhala o tom, co instance umí.
  if (jazyky.length < 2) return null;

  const aktualni =
    jazyky.find((j) => j.code === i18n.language)?.code ??
    jazyky.find((j) => i18n.language?.startsWith(`${j.code}-`))?.code ??
    "";

  return (
    <label className="nav__lang">
      <span className="nav__lang-popisek">{popisek}</span>
      {/*
        Nativní `select` schválně: na mobilu dostane systémový výběr, umí
        klávesnici i čtečku bez jediného řádku navíc a nepotřebuje portál ani
        platformní komponentu. Vzhled dodá CSS plátna (`.nav__lang`), takže
        prvek patří webu, ne Studiu.
      */}
      <select
        aria-label={popisek}
        className="nav__lang-vyber"
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        value={aktualni}
      >
        {aktualni ? null : <option value="">—</option>}
        {jazyky.map((j) => (
          <option key={j.code} value={j.code}>
            {j.name_native}
          </option>
        ))}
      </select>
    </label>
  );
}

export default LanguageSwitcherBlock;
