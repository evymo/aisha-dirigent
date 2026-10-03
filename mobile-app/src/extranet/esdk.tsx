/**
 * Jazyk ESDK nativně — adaptér na `@aisha/extranet-sdk-native`.
 *
 * ⛔ PROČ TU NENÍ IMPORT `@aisha/extranet-sdk-ui`. Mobil je React Native bez
 * `react-dom`; `es-*` jsou custom elements a RN je nevykreslí ani přes most.
 * „ESDK na mobilu" proto znamená DRUHÝ RENDERER TÉHOŽ JAZYKA — a ten je od
 * 0.2.4 balíkem, ne kopií v tomhle repu.
 *
 * ⭐ CO SE TÍMHLE SOUBOREM ZMĚNILO (2026-08-17). Dřív tu ty komponenty byly
 * NAPSANÉ. Byla to druhá implementace téhož jazyka a jediné, co ji drželo
 * v souladu s webem, byla paritní brána. Teď je tu jen adaptér: komponenty
 * přicházejí z balíku a tenhle soubor řeší dvě věci, které balík řešit nemá —
 *
 *   1. DEPENDENCY INJECTION. `nativeKit(React, RN)` schválně nic neimportuje,
 *      aby nezamykal verzi Reactu ani RN a byl testovatelný bez zařízení.
 *      Instanci si tedy musí složit hostitel, tedy my.
 *   2. BRAND INSTANCE. `Provider` bere brand a téma; hodnoty tečou z `@/theme`,
 *      který se generuje z brand souboru instance — takže „jiná instance = jiné
 *      hodnoty", stejně jako na webu.
 *
 * ⚠️ Jména re-exportů se NEMĚNÍ. Konzumenti (`BlockRenderer`, testy) mluví
 * `Lamp/Prov/Fact/Measure/Evidence` a přejmenovat je by z výměny udělalo
 * refaktor napříč appkou — bez užitku, protože jde o tatáž slova jazyka.
 *
 * @module
 */
import * as React from "react";
import * as RN from "react-native";
import Svg, { Circle, Line, Path, Rect, G, Text as SvgText } from "react-native-svg";
import Constants from "expo-constants";
import { nativeKit } from "@aisha/extranet-sdk-native";

/**
 * Kit se skládá JEDNOU. Každé volání `nativeKit` vyrábí nový React kontext,
 * takže dvě instance by znamenaly dva nezávislé motivy a `useEsdk()` uvnitř
 * cizího stromu by četl výchozí hodnoty místo těch z Provideru.
 */
/**
 * SVG se DODÁVÁ, nedomýšlí. Balík schválně nic neimportuje (viz DI výš), takže
 * kruhové projekce (Donut, Orbit) potřebují primitivy od hostitele. Bez nich by
 * se nekreslilo prázdno — mají textovou náhradu nesoucí táž čísla — ale mobil
 * `react-native-svg` má, takže dostane plnou podobu.
 */
const kit = nativeKit(React, RN, { Svg: { Svg, Circle, Line, Path, Rect, G, Text: SvgText } });

/** Stavy lampy — glyf + slovo, barva je až třetí kanál (kit: ok/work/wait/fault/off/plan/mute). */
export type LampState = "ok" | "work" | "wait" | "fault" | "off" | "plan" | "mute";

/**
 * Brand a téma jazyka pro `EsdkProvider` — z profilu appky (`version.json` →
 * `brand.esdk`, jinak `slug` a `noc`). ⛔ NAMĚŘENO 2026-09-29: Provider nikdo nezapojil,
 * takže Es.* kreslily výchozí SVĚTLÉ `den` na tmavé appce — tmavý text na tmavém
 * a bílé karty. Téma se NEHÁDÁ z jména instance: přichází z dat, stejně jako barvy.
 */
export const ESDK_BRAND: string = (Constants.expoConfig?.extra?.AISHA_ESDK_BRAND as string | undefined) ?? "aisha";
export const ESDK_TEMA: "den" | "noc" =
  (Constants.expoConfig?.extra?.AISHA_ESDK_THEME as string | undefined) === "den" ? "den" : "noc";

export const {
  /** Poskytovatel motivu; obaluje strom appky. */
  Provider: EsdkProvider,
  /** Stavová lampa — NIKDY jen barva. */
  Lamp,
  /** Provenience — žádné číslo bez zdroje. */
  Prov,
  /** Jeden údaj — prázdný se NEKRESLÍ. */
  Fact,
  /** Naměřená hodnota — stroj navrhuje, ČLOVĚK potvrzuje. */
  Measure,
  /** Evidence — nese STAV, ne obrázky. */
  Evidence,
  /** Je to totéž číslo? „12,0" a „12" ANO — porovnává se číselně. */
  jeTazHodnota,
} = kit;

/** Zbytek jazyka (Gate, Timeline, Table, Stepper, Banner, …) pro nové obrazovky. */
export const Es = kit;
