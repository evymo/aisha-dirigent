/**
 * Ověření úložiště proti DEKLARACI instance: leží v bucketu to, co instance
 * slíbila?
 *
 * ⭐ ZADÁNÍ MAJITELE (2026-09-22): „je to artefakt co se má smazat a nahrát to do
 * minia… nezůstane apk v repo, to nechceme."
 *
 * ⛔ TENHLE MODUL JEN OVĚŘUJE (čte a rozhoduje). Binárka je ARTEFAKT: nebydlí
 * v datech instance ani v obrazu, bydlí v úložišti. Doplnit ji smí jen z místa,
 * které deklarace VÝSLOVNĚ uvádí (`zdroj`, od 2026-09-24) a jen s ověřeným
 * otiskem — to dělá `doplneni-baliku.ts` nad tímto ověřením. Bez zdroje se nic
 * nehledá jinde; co služba umí, je říct PRAVDU o rozdílu, a to včas.
 *
 * ⛔ ROZHODUJE OTISK, NE PŘÍTOMNOST. Klíč v bucketu může existovat a nést starou
 * nebo cizí binárku. „Soubor tam je" není „je tam ten správný" — a ten rozdíl se
 * jinak pozná až tím, že tablet instalaci odmítne, tedy jinde a později.
 *
 * ⛔ TŘI STAVY, NE DVA. „Chybí" a „nesedí" jsou dvě různé poruchy: první znamená,
 * že správce balíček nenahrál, druhá že nahrál JINÝ, než deklarace slibuje.
 * Hledaly by se jinde, takže se nesmí slít do jednoho „není to v pořádku".
 */
export type VysledekOvereni =
  | { stav: 'nedeklarovano' }
  | { stav: 'drzi'; klic: string }
  | { stav: 'chybi'; klic: string }
  | { stav: 'nesedi'; klic: string; deklarovano: string; vUlozisti: string | null };

export interface OvereniVstup {
  /** Kam balíček patří, např. `appky/cz.riq.ridic.apk`. */
  klic: string;
  /** Otisk z deklarace instance — bez něj se NEOVĚŘUJE. */
  ocekavanySha256: string;
}

export interface Uloziste {
  /** Otisk objektu, `null` když objekt není. */
  otisk(klic: string): Promise<string | null>;
}

/** Ověří JEDEN deklarovaný balíček. Nic nemění — čte a rozhoduje. */
export async function overBalik(
  vstup: OvereniVstup | null,
  uloziste: Uloziste,
): Promise<VysledekOvereni> {
  if (!vstup || !vstup.klic || !vstup.ocekavanySha256) return { stav: 'nedeklarovano' };
  const { klic, ocekavanySha256 } = vstup;
  const vUlozisti = await uloziste.otisk(klic);
  if (vUlozisti === null) return { stav: 'chybi', klic };
  if (vUlozisti.toLowerCase() !== ocekavanySha256.toLowerCase()) {
    return { stav: 'nesedi', klic, deklarovano: ocekavanySha256.toLowerCase(), vUlozisti };
  }
  return { stav: 'drzi', klic };
}
