/**
 * Hlavička `Range` — kolik z balíčku klient chce.
 *
 * ⭐ PROČ TO VZNIKLO (naměřeno 2026-09-22). Cesta dovnitř i ven má strop ~60 s na
 * délku požadavku a APK řidiče se z veřejné adresy stahovalo rychlostí
 * 50 kB/s — z 52 MB tedy 15 MB za 300 s. Tablet balíček NESTÁHL VŮBEC, i když
 * v úložišti ležel. Jedno dlouhé stahování je proto slepá ulička: musí jít po
 * částech, aby žádný jednotlivý požadavek na strop nenarazil.
 *
 * ⛔ A MUSÍ JÍT NAVÁZAT. Přenos po LTE se přeruší; bez `Range` začíná tablet
 * pokaždé od nuly a při 50 kB/s se ke konci nedostane nikdy. Navazování není
 * optimalizace, je to podmínka doručitelnosti.
 *
 * ⛔ CHYBNÝ ROZSAH SE NEOPRAVUJE. `bytes=999-10` nebo začátek za koncem souboru
 * je 416, ne „pošlu, co dává smysl": tiše posunutý rozsah by klientovi složil
 * soubor ze špatných kusů a poznalo by se to až neplatným otiskem — tedy na
 * místě vzdáleném od příčiny.
 */
export type Rozsah =
  | { druh: 'cely' }
  | { druh: 'cast'; od: number; do: number; delka: number }
  | { druh: 'mimo' };

/** Jen `bytes=` a jediný rozsah: víc rozsahů by znamenalo multipart odpověď, kterou nikdo z našich klientů nečte. */
const VZOR = /^bytes=(\d*)-(\d*)$/;

export function prectiRozsah(hlavicka: string | undefined, velikost: number): Rozsah {
  if (!hlavicka) return { druh: 'cely' };
  const m = VZOR.exec(hlavicka.trim());
  if (!m) return { druh: 'cely' }; // nesrozumitelné = chová se, jako by nebyla (RFC 9110)
  const [, a, b] = m;
  if (a === '' && b === '') return { druh: 'cely' };

  let od: number;
  let doB: number;
  if (a === '') {
    // `bytes=-500` = POSLEDNÍCH 500 bajtů.
    const kolik = Number(b);
    if (!Number.isInteger(kolik) || kolik <= 0) return { druh: 'mimo' };
    od = Math.max(0, velikost - kolik);
    doB = velikost - 1;
  } else {
    od = Number(a);
    doB = b === '' ? velikost - 1 : Number(b);
    if (!Number.isInteger(od) || od < 0) return { druh: 'mimo' };
    if (!Number.isInteger(doB)) return { druh: 'mimo' };
    if (od >= velikost) return { druh: 'mimo' };
    // Konec za koncem souboru se OŘÍZNE (RFC 9110) — to není hádání, klient
    // legitimně nemusí znát velikost.
    if (doB >= velikost) doB = velikost - 1;
    if (doB < od) return { druh: 'mimo' };
  }
  if (velikost === 0) return { druh: 'mimo' };
  return { druh: 'cast', od, do: doB, delka: doB - od + 1 };
}
