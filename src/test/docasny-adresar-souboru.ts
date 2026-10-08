/**
 * Každý soubor testů dostane VLASTNÍ dočasný adresář a po doběhnutí ho celý smaže.
 *
 * ⛔ NAMĚŘENO 2026-10-02 (Mac sdílený relacemi): v $TMPDIR leželo za jediný den
 * 33 008 adresářů (9,5 GB) — jeden běh `test:gates` jich nechá 214 (93 MB),
 * `test:scripts` 18, `test:run` 2. Testy si dočasné adresáře zakládají
 * (`mkdtempSync(join(tmpdir(), …))`, i v podprocesech) a neuklízejí je.
 * Na CI runneru totéž plní disk a plný disk se tváří jako vada kódu.
 *
 * Oprava pro CELOU TŘÍDU, ne test po testu: `setupFiles` běží v procesu souboru
 * testů dřív, než se soubor načte. Nastaví TMPDIR/TMP/TEMP na čerstvý podadresář
 * původního dočasného adresáře — `os.tmpdir()` i podprocesy, které dědí prostředí,
 * pak píší dovnitř — a po posledním testu souboru ho smaže. Testy samy se nemění.
 *
 * ⚠ macOS: `mktemp` BEZ šablony (holé `mktemp`, `mktemp -d`, `mktemp -t x`) dává
 * přednost `_CS_DARWIN_USER_TEMP_DIR` před TMPDIR (man mktemp) — takové položky
 * jdou dál do uživatelského dočasného adresáře. Naměřeno 2026-10-03: 6 897 položek
 * `tmp.*` za 24 h, dohromady 33 MB, tedy zlomek; GNU mktemp na CI TMPDIR bere.
 * Systémový nástroj se proto nepodvrhuje. Místo dělají adresáře testů (cs-izolace
 * z _falesny-coolify.ts: 584 × ~15 MB = 8,4 GB) a ty se tu uklidí.
 *
 * Podmínka: soubor běží ve VLASTNÍM procesu (pool `forks`, výchozí ve vitest 3;
 * žádná konfigurace to nemění). Ve vlákně (`worker_threads`) je prostředí společné
 * celému procesu a souběžné soubory by si adresář přepisovaly a mazaly — tam se
 * proto nic nemění a jen se to řekne.
 *
 * Soubor, jehož všechny testy jsou přeskočené, `afterAll` nespustí — jeho adresář
 * smaže až kořen běhu (`docasny-adresar-behu.ts` v globalSetup), ve kterém adresáře
 * souborů vznikají.
 *
 * Hlídá brána `testy-uklidi-docasne-adresare`.
 */
import { afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMainThread } from "node:worker_threads";

export const PREDPONA = "aisha-testy-";

if (!isMainThread) {
  console.warn("[docasny-adresar-souboru] soubor testů běží ve vlákně — TMPDIR se NEMĚNÍ (prostředí je společné vláknům); dočasné adresáře se neuklidí");
} else {
  const adresar = mkdtempSync(join(tmpdir(), PREDPONA));
  process.env.TMPDIR = adresar;
  process.env.TMP = adresar;
  process.env.TEMP = adresar;
  afterAll(() => {
    // Podproces, který test nechal běžet, může do adresáře ještě psát — opakovat, nikdy neshodit test.
    rmSync(adresar, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
}
