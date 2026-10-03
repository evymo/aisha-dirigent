/**
 * Žádný fallback nad env — třídní brána (baseline, která smí jen klesat)
 *
 * PRAVIDLO (majitel, 2026-08-12): „žádné fallbacky, vše musí být nastaveno jen
 * správně." Hodnota popisující SVĚT — kdo je instance, jaký je tvar nasazení,
 * kde co běží — se nesmí dosazovat literálem. Buď je deklarovaná, nebo to má
 * spadnout tam, kde je vidět, co se nenakonfigurovalo.
 *
 * ── PROČ JE FALLBACK HORŠÍ NEŽ CHYBĚJÍCÍ HODNOTA ──────────────────────────────
 * Chybějící hodnota selže na správném místě. Dosazená tiše trefí něco jiného a
 * projeví se až jako výpadek bez souvislosti s příčinou. Doloženo 2026-08-12
 * TŘIKRÁT za jediný den:
 *
 *   • `AISHA_SUBDOMAIN_PREFIX` nikdo nenaplnil a fallback „bez prefixu" to
 *     přikryl → hostnames nenesly identitu → pki-init sáhl na CIZÍ pki-bridge
 *     → aisha-core nešlo nasadit.
 *   • `VERDACCIO_TOKEN` fallback na statický token místo ražby → publikace
 *     balíčků tiše mrtvá 15 dní; nikdo si nevšiml, protože job končil nulou.
 *   • `REPO_API_TOKEN` prázdný → diagnostika CI posílala do 401 a končila nulou,
 *     takže kanál postavený pro nečitelné logy nikdy nic neposlal.
 *
 * Pokaždé někdo napsal správné řešení a fallback zajistil, že se NIKDY nespustilo.
 *
 * ── CO SE MĚŘÍ ────────────────────────────────────────────────────────────────
 * `process.env.X || "literál"` / `?? "literál"` s NEPRÁZDNÝM literálem, přes
 * VŠECHNY sledované zdrojáky.
 *
 * `|| ""` a `?? ""` se NEHLÁSÍ: prázdný řetězec není dosazená hodnota, je to
 * normalizace „nenastaveno" — a právě ta umožňuje fail-loud o řádek níž.
 *
 * ── PROČ BASELINE A NE NULA ───────────────────────────────────────────────────
 * Naměřeno 2026-08-12: 607 výskytů ve 165 souborech. Brána vynucující nulu by
 * nešla zavést a skončila by vypnutá — což je horší než brána, která drží
 * hranici. Vynucuje se tedy TÝŽ vzor jako u `workaround-markers`: snímek dluhu,
 * který smí jen KLESAT. Nic nového neprojde; staré ubývá.
 *
 * Po legitimním úbytku: `node scripts/gen-env-fallback-baseline.mjs`
 *
 * ⚠️ Baseline NENÍ povolení. Je to hranice s datem. Kdo přidá fallback, musí
 *    jiný odstranit — nebo hodnotu deklarovat pořádně.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { sesbirej } from "../../../scripts/gen-env-fallback-baseline.mjs";

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, "src/tests/gates/env-fallback.baseline.json");

type Snimek = {
  totalFallbacks: number;
  totalFiles: number;
  perFile: Record<string, number>;
};

function nactiBaseline(): Snimek {
  if (!existsSync(BASELINE)) {
    throw new Error(
      `Baseline chybí: ${BASELINE}\n` +
        "Bez ní brána NEMÁ CO POROVNÁVAT a mlčky by prošla nad čímkoli.\n" +
        "Vygeneruj: node scripts/gen-env-fallback-baseline.mjs",
    );
  }
  return JSON.parse(readFileSync(BASELINE, "utf-8")) as Snimek;
}

describe("fallback nad env: nic nového, staré ubývá", () => {
  const zaklad = nactiBaseline();
  const ted = sesbirej(ROOT) as Snimek;

  it("sonda má co měřit — baseline i sken vracejí čísla", () => {
    // Mlčení sondy je samo nálezem: kdyby se změnil tvar zdrojáků nebo sken
    // přestal procházet soubory, testy níž by prošly nad prázdnem.
    expect(zaklad.totalFallbacks, "baseline je prázdná — brána by tvrdila prázdno").toBeGreaterThan(0);
    expect(
      Object.keys(ted.perFile).length,
      "sken nenašel ANI JEDEN soubor — pravděpodobně neběží nad stromem, ne že je čisto",
    ).toBeGreaterThan(0);
  });

  it("žádný soubor nepřidal fallback", () => {
    const prirustky: string[] = [];
    for (const [soubor, pocet] of Object.entries(ted.perFile)) {
      const drive = zaklad.perFile[soubor] ?? 0;
      if (pocet > drive) prirustky.push(`${soubor}: ${drive} → ${pocet}`);
    }
    expect(
      prirustky.sort(),
      "Dosazený literál HÁDÁ fakt o světě. Chybějící hodnota selže na správném\n" +
        "místě; hádaná tiše trefí něco jiného a projeví se jako výpadek bez\n" +
        "souvislosti s příčinou.\n" +
        "Náprava: hodnotu DEKLAROVAT (profil, katalog, kontrakt env-doktora)\n" +
        "a při chybění selhat nahlas. `|| \"\"` (normalizace) brána nehlásí.",
    ).toEqual([]);
  });

  it("celkový dluh neroste", () => {
    expect(
      ted.totalFallbacks,
      `Celkem ${ted.totalFallbacks} fallbacků, baseline ${zaklad.totalFallbacks}.\n` +
        "Baseline je hranice s datem, ne povolení: kdo přidá, ať jiný odstraní.\n" +
        "Po legitimním úbytku: node scripts/gen-env-fallback-baseline.mjs",
    ).toBeLessThanOrEqual(zaklad.totalFallbacks);
  });
});
