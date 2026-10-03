/**
 * cli-entry.mjs — jedna odpověď na otázku „spustili mě přímo, nebo mě jen naimportovali?"
 *
 * Modul, který je zároveň knihovnou i nástrojem, si tuhle otázku musí položit
 * dřív, než něco vypíše na stdout. Sedm míst v repu si ji kladlo vlastním
 * výrazem `import.meta.url === pathToFileURL(process.argv[1]).href` — a ten
 * porovnává ŘETĚZCE, ne cesty.
 *
 * Proč to selhává: `import.meta.url` je cesta PO rozpletení symlinků, kdežto
 * `argv[1]` nese doslova to, co napsal volající. Stačí symlink kdekoli v cestě,
 * logické `pwd`, `/tmp` → `/private/tmp` na macOS nebo git worktree, a ty dva
 * řetězce se rozejdou. Blok se pak TIŠE přeskočí: nic se nevypíše, návratový
 * kód je 0.
 *
 * A přesně tenhle tvar je zákeřný — volající v shellu dostane prázdný výstup
 * s nulovým kódem a vyloží si ho jako MĚŘENÍ. Naměřeno 2026-08-14: doctor
 * hlásil „subnet NEODPOVÍDÁ odvození:" s prázdným detailem, protože CLI blok
 * v subnet-drift.mjs vůbec neběžel. Selhání nástroje se převléklo za nález.
 *
 * A porovnávat ani ROZPLETENÉ cesty nestačí — pořád jsou to řetězce. Naměřeno
 * 2026-08-14: dva worktree se stejným commitem, lišící se jen jménem adresáře
 * (`pki-cistý` vs `pki-clean`), daly `derive-domains.mjs --shell` = 0 bajtů
 * proti 6039. Prostředí nemá nastavené LANG ani LC_ALL, takže se zápis cesty
 * s diakritikou rozešel: `import.meta.url` nese `%C3%BD`, kdežto argv[1] syrové
 * bajty. Následek zase ten nejhorší: prázdný výstup s kódem 0, ze kterého si
 * dvanáct bran udělalo „resolver neemitoval ani jednu doménu".
 *
 * Proto se neporovnává ZÁPIS cesty, ale SOUBOR: dvojice `dev` + `ino` je
 * POSIXová definice „totožný soubor". Nezávisí na kódování, na symlincích ani
 * na tom, jak cestu napsal volající. Když jednu stranu nejde přečíst, odpověď
 * je „ne" — knihovna mlčí, což je bezpečná strana.
 */
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {string} importMetaUrl — vždy `import.meta.url` volajícího modulu
 * @returns {boolean} true právě když je tenhle modul vstupním bodem procesu
 */
export function isDirectRun(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false; // `node -e`, REPL — vstupní bod neexistuje
  try {
    const a = statSync(entry);
    const b = statSync(fileURLToPath(importMetaUrl));
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}
