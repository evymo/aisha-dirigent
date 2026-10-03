/**
 * Rozepsaný text v prohlížeči — záchranná síť pro dialog článku.
 *
 * Kliknutí vedle okna, reload nebo pád prohlížeče do 2026-09-24 zahodily vše,
 * co autor napsal (naměřeno testerem: dvakrát ztracený článek). Server má
 * koncept (save_news_article_draft_admin), ale ten vzniká až uložením; tohle je
 * vrstva POD ním: každá změna formuláře se otiskne do localStorage, při
 * otevření se nabídne obnova, po uložení se otisk smaže.
 *
 * Bezpečnost: nic se neposílá, nic se nezveřejňuje. Otisk je per prohlížeč
 * a per článek (nebo „nový"). localStorage může chybět (soukromý režim, plný
 * disk) — každé čtení i zápis je v try/catch a bez úložiště se prostě nic
 * neuloží, formulář funguje dál.
 */
import { safeWarn } from "@/lib/security/safeLogger";

const PREDPONA = "novinky.rozepsane.";

export interface RozepsanyZaznam<T> {
  /** ISO čas posledního otisku. */
  ulozeno: string;
  data: T;
}

export function klicRozepsaneho(articleId: string | null | undefined): string {
  return `${PREDPONA}${articleId ?? "novy"}`;
}

export function ulozRozepsane<T>(klic: string, data: T, ted: Date = new Date()): void {
  try {
    const zaznam: RozepsanyZaznam<T> = { ulozeno: ted.toISOString(), data };
    window.localStorage.setItem(klic, JSON.stringify(zaznam));
  } catch (err) {
    // Bez úložiště (soukromý režim, plný disk) se jen neuloží — ale ne mlčky.
    safeWarn("rozepsanyText.ulozit", err);
  }
}

export function nactiRozepsane<T>(klic: string): RozepsanyZaznam<T> | null {
  try {
    const raw = window.localStorage.getItem(klic);
    if (!raw) return null;
    const z = JSON.parse(raw) as Partial<RozepsanyZaznam<T>>;
    if (typeof z.ulozeno !== "string" || z.data === undefined) return null;
    return { ulozeno: z.ulozeno, data: z.data };
  } catch (err) {
    safeWarn("rozepsanyText.nacist", err);
    return null;
  }
}

export function smazRozepsane(klic: string): void {
  try {
    window.localStorage.removeItem(klic);
  } catch (err) {
    safeWarn("rozepsanyText.smazat", err);
  }
}
