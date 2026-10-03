/**
 * Člověk přihlášený na SDÍLENÉM tabletu v kabině — kdy ho odhlásit.
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-30): tablet vidí systémovým přístupem vybrané
 * rozvozy; řidič se může přihlásit ke SVÉMU účtu a vidí jen to, co je jeho.
 * Tablet ale patří kabině, ne řidiči: kdo se ráno přihlásí a večer zapomene
 * odhlásit, nechá další směně svůj účet — cizí řidič by pak potvrzoval
 * předání jeho jménem.
 *
 * Proto přihlášení na tabletu platí do místní půlnoci tabletu (týž den jako
 * výběr řidiče/vozidla v `kioskRozvozy`). Explicitní „Odhlásit se" je na
 * obrazovce řidiče; tohle je pojistka pro zapomnění.
 *
 * ⛔ ODHLÁŠENÍ SE ODKLÁDÁ, dokud má fronta neodeslanou práci (nebo ji nejde
 *    přečíst). Fronta odesílá jen za toho, kdo je přihlášený; po odhlášení by
 *    předání řidiče čekala, dokud se na TOMTO tabletu znovu nepřihlásí. Rozvoz
 *    přes půlnoc tak nic neztratí: odhlásí se až po odeslání. Detail předání
 *    kontrolu vůbec nespouští (běží jen na seznamu), takže podpis ani razítko
 *    půlnoc nepřeruší.
 *
 * Čistá funkce: rozhoduje jen z uloženého záznamu, přihlášeného `uid`, dne
 * a počtu čekajících položek fronty.
 */

/** Kdo a kterého dne se na tabletu přihlásil. */
export const KLIC_OSOBY = "aisha.kiosk.osoba.v1";

export interface ZaznamOsoby {
  uid: string;
  den: string;
}

export type AkceOsoby =
  | { akce: "nic" }
  | { akce: "zapsat"; zaznam: ZaznamOsoby }
  | { akce: "smazat" }
  | { akce: "odhlasit" }
  | { akce: "odlozit" };

function zParsuj(json: string | null): ZaznamOsoby | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<ZaznamOsoby>;
    return typeof v.uid === "string" && v.uid && typeof v.den === "string" && v.den ? { uid: v.uid, den: v.den } : null;
  } catch {
    return null;
  }
}

/**
 * @param ulozeno  obsah `KLIC_OSOBY` (nebo null)
 * @param uid      přihlášený člověk, null = na tabletu nikdo není
 * @param den      dnešní místní den (`dnesniDen`)
 * @param cekajici  položky ve frontě; null = frontu nejde přečíst
 */
export function rozhodniOsobu(
  ulozeno: string | null,
  uid: string | null,
  den: string,
  cekajici: number | null,
): AkceOsoby {
  const z = zParsuj(ulozeno);
  if (!uid) return z || ulozeno ? { akce: "smazat" } : { akce: "nic" };
  // Nový člověk (nebo první spuštění s touto verzí): přihlásil se DNES.
  if (!z || z.uid !== uid) return { akce: "zapsat", zaznam: { uid, den } };
  if (z.den === den) return { akce: "nic" };
  return cekajici === 0 ? { akce: "odhlasit" } : { akce: "odlozit" };
}
