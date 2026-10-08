/**
 * Brána: testy po sobě uklidí dočasné adresáře — mechanismem, ne kázní
 *
 * ⛔ NAMĚŘENO 2026-10-02: na Macu sdíleném relacemi leželo v $TMPDIR za jediný den
 * 33 008 adresářů (9,5 GB). Jeden běh `test:gates` jich nechá 214 (93 MB),
 * `test:scripts` 18, `test:run` 2. Testy si dočasné adresáře zakládají samy
 * (`mkdtempSync(join(tmpdir(), …))`) i přes podprocesy a úklid je na kázni
 * každého z nich. Nejvíc místa: cs-izolace z _falesny-coolify.ts, 584 × ~15 MB
 * = 8,4 GB za den. Kázeň v ~600 souborech nedrží; na CI
 * runneru se plný disk navíc tváří jako vada kódu.
 *
 * Oprava je jedna pro celou třídu, ve dvou patrech:
 *   - `src/test/docasny-adresar-souboru.ts` v `setupFiles` dá každému souboru testů
 *     vlastní TMPDIR a po posledním testu ho smaže (místo se uvolňuje průběžně);
 *   - `src/test/docasny-adresar-behu.ts` v `globalSetup` založí kořen celého běhu,
 *     ve kterém adresáře souborů vznikají, a na konci ho smaže — i s adresáři
 *     souborů, kde `afterAll` neproběhl. Naměřeno 2026-10-03: bez něj `test:run`
 *     nechal 149 adresářů = 149 souborů se všemi testy přeskočenými (vitest jim
 *     spustí setupFiles, hooky ne).
 * Tahle brána hlídá, že:
 *   1. oba zapojuje KAŽDÁ kořenová konfigurace vitestu (nová konfigurace bez nich = nález),
 *   2. žádná konfigurace nepřepne pool na vlákna (tam je prostředí společné
 *      souběžným souborům a modul TMPDIR záměrně nemění),
 *   3. tenhle soubor sám běží ve vlastním adresáři (mechanismus je živý),
 *   4. CHOVÁNÍ: soubor testů, který po sobě neuklidí — sám ani přes podproces —
 *      ani soubor se všemi testy přeskočenými po doběhnutí nenechají v dočasném
 *      adresáři nic. Měří se skutečným během vitestu nad fixture, ne čtením textu.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { PREDPONA } from "../../test/docasny-adresar-souboru";
import { PREDPONA_BEHU } from "../../test/docasny-adresar-behu";

const ROOT = process.cwd();
const MODULY: Array<[klic: string, modul: string]> = [
  ["setupFiles", "docasny-adresar-souboru"],
  ["globalSetup", "docasny-adresar-behu"],
];
const FIXTURE = join(ROOT, "src/tests/gates/fixtures/docasny-adresar");

const konfigurace = () => readdirSync(ROOT).filter((f) => /^vitest(\.[\w-]+)?\.config\.(ts|mts|js|mjs|cjs)$/.test(f));

describe("testy po sobě uklidí dočasné adresáře", () => {
  it("každá kořenová konfigurace vitestu zapojuje úklid po souborech (setupFiles) i po běhu (globalSetup)", () => {
    const vsechny = konfigurace();
    expect(vsechny.length, "měřidlo nenašlo konfigurace vitestu — změnil se kořen?").toBeGreaterThanOrEqual(4);
    const bez = vsechny.flatMap((f) => {
      const text = readFileSync(join(ROOT, f), "utf8");
      return MODULY.filter(([klic, modul]) => !new RegExp(`${klic}:\\s*\\[[^\\]]*${modul}`).test(text)).map(([klic, modul]) => `${f}: chybí src/test/${modul}.ts v ${klic}`);
    });
    expect(bez, `Tyhle konfigurace po sobě nechávají dočasné adresáře:\n  ${bez.join("\n  ")}`).toEqual([]);
  });

  it("žádná konfigurace ani skript nepřepne pool na vlákna (prostředí by sdílely souběžné soubory)", () => {
    const vlakna = /\bpool\s*:\s*["'](threads|vmThreads)["']|--pool[=\s]+(threads|vmThreads)\b/;
    const zdroje = [...konfigurace(), "package.json"];
    const spatne = zdroje.filter((f) => vlakna.test(readFileSync(join(ROOT, f), "utf8")));
    expect(spatne, "Modul mění TMPDIR jen ve vlastním procesu souboru (pool forks); ve vláknech se úklid vypne").toEqual([]);
  });

  it("tenhle soubor bran sám běží ve vlastním dočasném adresáři uvnitř kořene běhu", () => {
    expect(basename(tmpdir()), "setupFiles bran nezapojily úklid po souborech").toMatch(new RegExp(`^${PREDPONA}`));
    expect(basename(dirname(tmpdir())), "globalSetup bran nezapojil kořen běhu").toMatch(new RegExp(`^${PREDPONA_BEHU}`));
    expect(process.env.TMPDIR).toBe(tmpdir());
  });

  it("⛔ soubor testů, který po sobě neuklidí (sám ani přes podproces), ani soubor se vším přeskočeným nenechají nic", () => {
    // Obojí ve vlastním adresáři tohohle souboru — uklidí se s ním.
    const koren = mkdtempSync(join(tmpdir(), "koren-"));
    const zapis = join(mkdtempSync(join(tmpdir(), "zapis-")), "stopa.json");
    // Vnořený vitest nesmí zdědit identitu workeru tohohle běhu. Mezipaměť překladu
    // Node (`node-compile-cache` v TMPDIR hlavního procesu) je sdílená a záměrná, ne únik
    // testu — ve vnořeném běhu se vypne, aby kořen měřil jen to, co nechá soubor testů.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("VITEST") && k !== "NODE_COMPILE_CACHE"));
    const beh = spawnSync(
      process.execPath,
      [join(ROOT, "node_modules/vitest/vitest.mjs"), "run", "--root", ROOT, "--config", join(FIXTURE, "vitest.fixture.config.mjs")],
      { cwd: ROOT, encoding: "utf8", timeout: 45_000, env: { ...env, NODE_DISABLE_COMPILE_CACHE: "1", TMPDIR: koren, TMP: koren, TEMP: koren, STOPA_ZAPIS: zapis } },
    );
    expect(beh.status, `vnořený vitest nad fixture neprošel:\n${beh.stdout}\n${beh.stderr}`).toBe(0);
    expect(existsSync(zapis), "fixture nezapsala, kam psala — neproběhla?").toBe(true);
    const stopa = JSON.parse(readFileSync(zapis, "utf8")) as { tmp: string; vlastni: string; zPodprocesu: string };

    // Fixture psala do VLASTNÍHO adresáře souboru uvnitř kořene běhu, ne rovnou do kořene.
    // Nejdřív patro souboru: bez setupFiles píše fixture rovnou do kořene běhu
    // (nebo do kořene) a hláška musí jmenovat chybějící modul, ne ten druhý.
    expect(basename(stopa.tmp), "fixture nepsala do vlastního adresáře souboru — setupFiles nezapojily src/test/docasny-adresar-souboru.ts").toMatch(new RegExp(`^${PREDPONA}(?!beh-)`));
    const behu = dirname(stopa.tmp);
    expect(basename(behu), "adresář souboru neleží v kořeni běhu — globalSetup nezapojil src/test/docasny-adresar-behu.ts").toMatch(new RegExp(`^${PREDPONA_BEHU}`));
    expect(dirname(behu)).toBe(koren);
    const uvnitr = [stopa.tmp, stopa.tmp.replace(koren, realpathSync(koren))].map((p) => `${p}/`);
    expect(uvnitr.some((p) => stopa.vlastni.startsWith(p)), `mkdtemp mimo adresář souboru: ${stopa.vlastni}`).toBe(true);
    expect(uvnitr.some((p) => stopa.zPodprocesu.startsWith(p)), `podproces nezdědil TMPDIR: ${stopa.zPodprocesu}`).toBe(true);

    // A po doběhnutí z toho nezbylo nic.
    expect([stopa.tmp, stopa.vlastni, stopa.zPodprocesu].filter((p) => existsSync(p)), "po doběhnutí souboru zbyly dočasné adresáře").toEqual([]);
    // Prázdný kořen = uklizený i adresář přeskočeného souboru (preskoceny.fixture.mjs).
    expect(readdirSync(koren), "v kořeni dočasných adresářů po běhu něco zůstalo").toEqual([]);
  });
});
