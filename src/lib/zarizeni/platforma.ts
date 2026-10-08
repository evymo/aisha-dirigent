/**
 * Na jakém telefonu (nebo ne-telefonu) běží prohlížeč — z User-Agentu.
 *
 * Jedna funkce pro všechna místa, která to potřebují: banner aplikace na webu
 * (který obchod nabídnout) i přehled přihlášení v administraci (Android/iOS).
 *
 * ⛔ ZÁLEŽÍ NA POŘADÍ. UA Androidu nese i „Linux“ a UA iPhonu i „like Mac OS X“.
 * Přehled přihlášení se ptal nejdřív na Mac a Linux, a tak hlásil Android jako
 * Linux a iPhone jako macOS (naměřeno 2026-10-01). Tady se nejdřív ptá na
 * telefon, teprve potom na cokoli obecnějšího.
 *
 * ⛔ iPadOS 13+ se v UA hlásí jako Mac (`Macintosh`) — rozezná ho až dotyková
 * obrazovka (`maxTouchPoints > 1`). Tu zná jen prohlížeč; z UA uloženého na
 * serveru se takový iPad od Macu rozeznat nedá.
 */

export type Platforma = "ios" | "android" | "jina";

export interface Zarizeni {
  userAgent: string;
  maxTouchPoints?: number;
}

export function platformaNavstevnika({ userAgent, maxTouchPoints = 0 }: Zarizeni): Platforma {
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  return "jina";
}
