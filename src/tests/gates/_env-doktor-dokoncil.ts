/**
 * Kdy env-doktor DOKONČIL zápis — pro brány, které ho pouštějí kvůli JINÝM klíčům.
 *
 * Od 2026-10-05 (revize 27d6f3f5e) má env-doktor pro „WEB_FQDNS (domény webu)
 * neznám" vlastní kód KOD_ENV_DOKTORA_WEB_NEVIM: ostatní odvozené klíče zapsal,
 * jen deklaraci domén webu nemá. Samostatný běh bez cold-startu (čerstvý nebo
 * zasetý soubor bez klíče WEB_FQDNS, dopočtený požadavek na overlay) tam končí
 * VŽDY — výchozí hodnotu smí založit jen cold-start nebo trezor operátora.
 *
 * Brány, které měří jiné klíče, proto berou jako „doběhl" PRÁVĚ tyhle dva kódy —
 * ne libovolnou nenulu. Samotné WEB_FQDNS měří redeploy-zna-domeny-webu a unit
 * scripts/lib/domenovy-overlay.test.mjs.
 */
import { KOD_ENV_DOKTORA_WEB_NEVIM } from "../../../scripts/lib/domenovy-overlay.mjs";

export const ENV_DOKTOR_DOKONCIL: readonly number[] = [0, KOD_ENV_DOKTORA_WEB_NEVIM];

export function envDoktorDokoncil(status: number | null | undefined): boolean {
  return status === 0 || status === KOD_ENV_DOKTORA_WEB_NEVIM;
}
