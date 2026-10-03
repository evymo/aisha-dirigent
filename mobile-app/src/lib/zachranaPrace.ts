/**
 * Co se stane s rozdělanou prací, když se ji nepodaří odeslat.
 *
 * ⛔ PROČ TO MÁ VLASTNÍ JMÉNO A VLASTNÍ SOUBOR
 * Tohle pravidlo rozhoduje o tom, jestli řidiči zmizí hodina práce. Dokud
 * bydlelo uvnitř `catch` v obrazovce, nešlo ho vyslovit ani doložit — a přesně
 * proto se dalo tiše porušit: `catch { setBanner(chyba) }` vypadá jako obsloužená
 * chyba, ne jako zahozená data.
 *
 * Naměřeno 2026-08-09: `kroky.tsx` ukládala do fronty jen na větvi „nemám
 * signál". Řidič se signálem, kterého edge odmítl, přišel o vyplněné předání —
 * příjemce, podpis, fotky, odchylku. TÁŽ třída, kterou o krok dál opravil
 * PR #154 (fronta mazala práci po třech pokusech).
 *
 * ⭐ ROZHODUJE PŘÍČINA, NE FAKT SELHÁNÍ
 * „Nepodařilo se" není informace, se kterou se dá zacházet. Teprve druh selhání
 * říká, jestli je vadná NAŠE data, náš přístup, nebo jen cesta.
 */
import type { FailureKind } from "@/services/offline";

export interface Zachrana {
  /**
   * Uložit rozdělanou práci do fronty?
   *
   * `false` znamená, že opakování nemá smysl — ne že na práci nezáleží.
   */
  ulozit: boolean;
  /**
   * Nabídnout zaklepání?
   *
   * ⭐ Jen u doloženého odmítnutí identity. Break-glass úkon, který se nabízí
   * pořád, přestane být break-glass: kdo ho vidí denně, přestane ho číst — a
   * pak ho použije i tam, kde stačilo počkat na signál.
   */
  nabidnoutZaklepani: boolean;
}

/**
 * | druh selhání | co s prací | proč |
 * |---|---|---|
 * | `rejected`    | zahodit    | server ROZUMĚL a data odmítl; poslat je znovu = totéž odmítnutí, jen později |
 * | `denied`      | uložit     | odmítl naši IDENTITU (401/403) — data jsou v pořádku, vadí přístup |
 * | `unreachable` | uložit     | nedoletělo to; o datech to netvrdí nic |
 * | `transient`   | uložit     | protistrana sama říká „zkus později" (408/429/5xx) |
 */
export function zachranaPrace(kind: FailureKind): Zachrana {
  if (kind === "rejected") {
    return { nabidnoutZaklepani: false, ulozit: false };
  }
  return { nabidnoutZaklepani: kind === "denied", ulozit: true };
}
