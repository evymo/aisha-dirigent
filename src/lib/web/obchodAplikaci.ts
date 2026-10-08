/**
 * Který obchod s aplikací nabídnout návštěvníkovi webu.
 *
 * Zadání správkyně webu (2026-09-30) a majitele (2026-10-01): web pozná telefon
 * a nabídne „Get our app“ — iPhone/iPad → App Store, Android → Google Play;
 * počítač nebo neznámé zařízení → OBA odkazy. Telefon pozná sdílená
 * `platformaNavstevnika` (lib/zarizeni/platforma.ts).
 */
import type { Platforma } from "@/lib/zarizeni/platforma";

export interface OdkazyObchodu {
  ios?: string;
  android?: string;
}

/**
 * Které obchody ukázat: na telefonu jen „jeho“ (když je odkaz vyplněný),
 * jinak všechny vyplněné. Prázdný seznam = blok se nevykreslí.
 */
export function obchodyKZobrazeni(platforma: Platforma, odkazy: OdkazyObchodu): ("ios" | "android")[] {
  const vyplnene = (["ios", "android"] as const).filter((o) => (odkazy[o] ?? "").trim() !== "");
  if (platforma !== "jina" && vyplnene.includes(platforma)) return [platforma];
  return [...vyplnene];
}
