/**
 * Env-doktor: NEZNÁMÝ PŘEPÍNAČ JE STOP, NE APPLY (CLASS gate)
 *
 * ⛔ NAMĚŘENO 2026-09-03 PŘI MĚŘENÍ TOHOTO NÁSTROJE. Měřicí běh
 *
 *     M="--report --strict --no-external"
 *     node scripts/aisha-env-doctor.mjs $M
 *
 * pod **zsh** předá JEDEN argument — zsh neuvozovkovanou expanzi na slova
 * NEDĚLÍ, na rozdíl od bashe. Doktor nerozpoznal žádný přepínač a spustil se
 * v APPLY: přepsal `.env.coolify` v běhu, který měl jen měřit. Ještě horší
 * následek byl ten měkký — protože si drift sám opravil, hlásil pak exit 0
 * a z toho vyšel nepravdivý závěr o chování `--strict`.
 *
 * ⭐ TŘÍDA VADY: NEJISTOTA ROZHODNUTÁ NEJDESTRUKTIVNĚJŠÍM VÝKLADEM. Táž třída
 * už jednou zapsala 36 klíčů a odvozeninou z prázdného prostředí smazala alias
 * `corp` — tehdy chyběl `--help`, takže `--help` SÁM byl tím neznámým
 * přepínačem, který spustil zápis.
 *
 * ⭐ UNIVERZUM SE ODVOZUJE, NEPÍŠE RUKOU: seznam se čte ze zdrojáku
 * (`args.has("--…")`), ne z kopie v testu. Nový přepínač, který se zapomene
 * zaregistrovat, tuhle bránu zčervená — ručně psaný seznam by mlčel.
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const DOKTOR = join(ROOT, "scripts/aisha-env-doctor.mjs");
const zdroj = () => readFileSync(DOKTOR, "utf8");

/** Přepínače, na které se doktor SKUTEČNĚ ptá — odvozeno ze zdrojáku. */
function ctenePrepinace(src: string): string[] {
  return [...src.matchAll(/args\.has\(\s*"(--[a-z-]+)"\s*\)/g)].map((m) => m[1]).sort();
}

/** Obsah registru `ZNAME_PREPINACE`. */
function registrovanePrepinace(src: string): string[] {
  const blok = src.match(/const ZNAME_PREPINACE = new Set\(\[([\s\S]*?)\]\)/);
  if (!blok) return [];
  return [...blok[1].matchAll(/"(-{1,2}[a-z-]+)"/g)].map((m) => m[1]).sort();
}

/** Tělo bloku `if (JSEM_SPOUSTENY) { … }`, vymezené párováním závorek. */
function teloStraze(src: string): string {
  const zacatek = src.indexOf("if (JSEM_SPOUSTENY) {");
  if (zacatek < 0) return "";
  let hloubka = 0;
  for (let i = src.indexOf("{", zacatek); i < src.length; i += 1) {
    if (src[i] === "{") hloubka += 1;
    else if (src[i] === "}") {
      hloubka -= 1;
      if (hloubka === 0) return src.slice(zacatek, i + 1);
    }
  }
  return "";
}

describe("env-doktor: neznámý přepínač", () => {
  test("registr existuje a je navázaný na entry-point (ne na modulový rozsah)", () => {
    const src = zdroj();
    expect(registrovanePrepinace(src).length).toBeGreaterThan(0);
    // Stráž musí být ODVOZENÁ z entry-pointu, ne z domněnky.
    expect(src).toMatch(/const JSEM_SPOUSTENY = [^\n]*import\.meta\.url/);
    // ⛔ `process.exit` v modulovém rozsahu zabíjí IMPORT: testovací běžec
    // předává vlastní argv a stráž by spadla při pouhém NAČTENÍ souboru.
    //
    // ⭐ Tvrzení je O UMÍSTĚNÍ, ne o vzdálenosti. První verze měřila „do 400
    // znaků" a spadla na 604 — vymyšlené číslo bez domova, které by se navíc
    // rozešlo s každou další řádkou diagnostiky. Blok se proto VYMEZÍ
    // závorkami a ptáme se, jestli je `exit` UVNITŘ.
    expect(teloStraze(src)).toContain("process.exit(2)");
  });

  test("každý ČTENÝ přepínač je v registru — univerzum se neodvozuje z kopie", () => {
    const src = zdroj();
    const registr = new Set(registrovanePrepinace(src));
    const chybi = ctenePrepinace(src).filter((f) => !registr.has(f));
    expect(chybi, `přepínače čtené, ale neregistrované: ${chybi.join(", ")}`).toEqual([]);
  });

  test("neznámý přepínač NEZAPÍŠE a skončí nenulově", () => {
    // ⛔ VSTUP SE VYROBÍ, NEKOPÍRUJE ZE STROJE. `.env.coolify` je gitignorovaný,
    // takže v CI NEEXISTUJE — brána opřená o něj by lokálně měřila jiný svět než
    // CI a v CI spadla na chybějícím souboru místo na tvrzení, které nese.
    // Stráž přepínačů běží PŘED čtením obsahu, takže stačí libovolný soubor.
    const dir = mkdtempSync(join(tmpdir(), "envdoktor-"));
    const cil = join(dir, ".env.coolify");
    writeFileSync(cil, "APP_NAME_PREFIX=zkouska\n");
    const pred = readFileSync(cil, "utf8");

    let kod = 0;
    try {
      execFileSync("node", [DOKTOR, "--report --strict --no-external"], {
        cwd: ROOT,
        env: { ...process.env, ENV_FILE: cil },
        stdio: "pipe",
      });
    } catch (e: unknown) {
      kod = (e as { status?: number }).status ?? -1;
    }

    expect(kod, "slepený argument musí být odmítnut, ne vyložen jako apply").not.toBe(0);
    expect(readFileSync(cil, "utf8"), "odmítnutý běh NESMÍ zapisovat").toBe(pred);
  });
});
