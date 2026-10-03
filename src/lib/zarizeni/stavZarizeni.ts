/**
 * Stav instalace na tabletu proti tomu, co na něm má být (deklarace instance).
 *
 * Čistá logika přehledu zařízení v administraci — co tablet nahlásil, se tu
 * jen porovná; nic se nedopočítává ani neodhaduje.
 */

export type StavBalicku = "aktualni" | "starsi" | "chybi";

/** `nainstalovano` je versionCode z hlášení (-1 = na tabletu není). */
export function stavBalicku(nainstalovano: number | undefined, cil: number): StavBalicku {
  if (nainstalovano === undefined || nainstalovano < 0) return "chybi";
  return nainstalovano >= cil ? "aktualni" : "starsi";
}

/** Tablet, který se neozval déle než tohle, se v přehledu označí. */
export const TICHO_MS = 48 * 60 * 60 * 1000;

export function mlci(prijato: string, ted: Date): boolean {
  const t = Date.parse(prijato);
  // Nečitelný čas není „nedávno“ — ukáže se jako podezřelý.
  return Number.isNaN(t) || ted.getTime() - t > TICHO_MS;
}

/** Jak tablet dopadl celkově: nejhorší ze stavů jeho balíčků. */
export function celkem(stavy: StavBalicku[]): StavBalicku {
  if (stavy.includes("chybi")) return "chybi";
  if (stavy.includes("starsi")) return "starsi";
  return "aktualni";
}
