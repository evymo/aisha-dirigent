/**
 * Rozložení podle DOSTUPNÉ PLOCHY, ne podle zařízení.
 *
 * ⭐ PROČ ŠÍŘKA A NE „JE TO TABLET"
 * Seznam zařízení zastará dřív, než se dopíše. Šířka je to, co o rozložení
 * skutečně rozhoduje, a React Native ji dává přímo — takže otočený telefon,
 * rozdělená obrazovka i 10" tablet v držáku dostanou rozumné chování ze stejného
 * pravidla. Nikde se neptáme „jsme tablet?", protože na to nepotřebujeme znát
 * odpověď.
 *
 * ⛔ TOHLE JE ZMĚNA PŘEDCHOZÍHO ROZHODNUTÍ, NE JEHO OBEJITÍ.
 * `docs/predani-ocima-ridice-ux-2026-08-20.md` (N13) master–detail ZAMÍTL
 * s odůvodněním „zadání znělo: mělo by to být jedno, tedy ne druhá tabletová
 * appka". Tehdy byl tablet nahodilý. 2026-09-03 majitel upřesnil, že řidiči
 * dostanou 10" tablety — tablet je tím CÍLOVÉ zařízení a důvod pro zamítnutí
 * padl. `sirkaObsahu` (strop 640 dp) zůstává v platnosti pro jednosloupcovku;
 * tenhle modul se ptá o patro výš: kolik sloupců vůbec dává smysl.
 *
 * ⭐ PRÁH 700 dp NENÍ „VELIKOST TABLETU"
 * Je to bod, od kterého se vedle čitelného sloupce (640 dp, viz `sirkaObsahu`)
 * vejde ještě druhý užitečný pruh. Pod ním by master–detail znamenal dva
 * proužky, z nichž ani jeden není čitelný — tedy horší výsledek než jeden
 * sloupec. Číslo tedy popisuje TEXT, ne hardware.
 *
 * @module
 */
import { useWindowDimensions, type ViewStyle } from "react-native";
import { SLOUPEC_MAX_DP } from "./sirkaObsahu";

/**
 * Šířka pásky (seznamu) v dvousloupcovém rozložení.
 *
 * Užší než detail schválně: páska je REJSTŘÍK, detail je práce.
 */
export const PASKA_SIRKA_DP = 320;

/**
 * Od kolika dp mají dva sloupce smysl — ODVOZENO, ne vymyšleno.
 *
 * ⛔ NAMĚŘENO PŘI PSANÍ TESTU: nejdřív tu stálo 700. Jenže páska 360 by při
 * 700 nechala detailu 340 — tedy DETAIL UŽŠÍ NEŽ REJSTŘÍK. Práce by dostala
 * míň místa než orientace v ní, což je horší výsledek než jeden sloupec.
 *
 * ⭐ Práh proto není číslo o hardwaru, ale SOUČET dvou věcí, které se musí
 * vejít obě: rejstřík (320) a CELÝ čitelný sloupec (`SLOUPEC_MAX_DP`, 640).
 * Pod tím zůstává jednosloupcovka — a je to správně, ne ústupek.
 *
 * V praxi: 10" tablet v držáku na šířku (~1280 dp) → dva sloupce. Tentýž
 * tablet na výšku (~800 dp) → jeden, protože na dva prostě není místo.
 */
export const PRAH_DVOUSLOUPCE_DP = PASKA_SIRKA_DP + SLOUPEC_MAX_DP;

export type Rozlozeni = {
  /** Vejdou se páska i detail vedle sebe? */
  dvousloupec: boolean;
  /** Skutečná šířka plochy v dp — pro rozhodnutí, která potřebují číslo. */
  sirka: number;
};

/**
 * Jak rozložit obsah na ploše, kterou právě máme.
 *
 * ⭐ Reaguje na OTOČENÍ i na rozdělenou obrazovku, protože
 * `useWindowDimensions` se překreslí sám. Řidič, který tablet v držáku otočí,
 * tedy nemusí appku restartovat.
 */
export function useRozlozeni(): Rozlozeni {
  const { width } = useWindowDimensions();
  return { dvousloupec: width >= PRAH_DVOUSLOUPCE_DP, sirka: width };
}

/**
 * Styl obalu obrazovky, která pod prahem kreslí jeden sloupec a nad ním pásku + detail.
 *
 * ⛔ OBAL MÁ VŽDY `flex: 1` (NAMĚŘENO 2026-09-30, tablet na výšku ≈ 601 dp, 1.2.0):
 *    obal BEZ stylu přerušil řetěz flex mezi KeyboardAvoidingView a ScrollView,
 *    ScrollView dostal výšku 0 a detail kroku byl PRÁZDNÝ — ani hlavička, žádná chyba
 *    v logu. Týká se každého telefonu (vždy pod prahem); na šířku se to „spravilo“ jen
 *    proto, že styl řádku flex měl.
 */
export function obalRozlozeni(dvousloupec: boolean): ViewStyle {
  // Řádek: páska drží pevnou šířku, detail bere zbytek. `flex: 1` na obou
  // stranách by pásku roztáhl na půl obrazovky — rejstřík tolik místa nechce.
  return dvousloupec ? { flex: 1, flexDirection: "row" } : { flex: 1 };
}
