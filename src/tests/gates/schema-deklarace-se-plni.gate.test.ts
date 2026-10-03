/**
 * `$schema` je závazek, ne ozdoba — deklarované schéma musí existovat a platit
 *
 * ── PRAVIDLO ──────────────────────────────────────────────────────────────────
 * Když JSON soubor deklaruje `"$schema": "./neco.schema.json"`, pak:
 *   1. ten soubor MUSÍ existovat,
 *   2. data mu MUSÍ vyhovovat,
 *   3. a musí to někdo skutečně kontrolovat — tenhle test.
 *
 * ── PROČ (naměřeno 2026-08-13) ────────────────────────────────────────────────
 * Osm souborů v repu deklarovalo lokální schéma. Z toho:
 *   • 3 (všechny deployment profily) mířily na `profiles.schema.json`, který
 *     NIKDY NEEXISTOVAL — deklarace bez adresáta,
 *   • `coolify/servers.schema.json` existoval, ale v celém stromu na něj nebyl
 *     JEDINÝ odkaz z kódu: nikdo podle něj nic nevaliduje.
 *
 * Obojí je táž vada jako „deklarace, kterou nikdo neplní": soubor vypadá
 * hlídaný, editor ukáže zelenou, a přitom se nekontroluje nic. Zvlášť bolí to
 * u `config/services.json` — ten popisuje TVAR katalogu, a právě rozchod jeho
 * tvaru s realitou stál za 38 rozejitými jmény kontejnerů (viz
 * `katalog-ukazuje-na-jmeno-neopisuje`).
 *
 * ── PROČ VLASTNÍ VALIDÁTOR ────────────────────────────────────────────────────
 * `ajv` není závislost repa a přidávat ji kvůli pěti souborům je neúměrné.
 * Podmnožina draft-07 žije v `lib/json-schema-podmnozina.ts` — sdílí ji brána
 * nad instančním overlayem, aby obě měřila TÝMŽ měřidlem.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { overit, type Uzel } from "./lib/json-schema-podmnozina";

const ROOT = process.cwd();
const PRESKOCIT = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", ".turbo"]);

/**
 * JSON soubory, které deklarují LOKÁLNÍ schéma. Univerzum se hledá, nepíše.
 *
 * Zdrojem je INDEX (`git ls-files`), ne procházení disku. Chůze po disku brala
 * i `.claude/worktrees/*` — worktrees z minulých sezení, jejichž `config/*.json`
 * jsou o desítky commitů starší než schémata. Brána pak na každé pracovní stanici
 * hlásila 27 nálezů o souborech, které v repu nejsou, zatímco vlastní strom byl
 * čistý (naměřeno 2026-08-13). Nález o kódu mimo repo není nález — je to šum,
 * který učí operátora červenou ignorovat.
 */
function deklarace(): Array<{ soubor: string; schemaRel: string; schemaAbs: string }> {
  const out: Array<{ soubor: string; schemaRel: string; schemaAbs: string }> = [];
  const seznam = execFileSync("git", ["ls-files", "-z", "*.json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
  if (seznam.length === 0) throw new Error("git ls-files nevrátil žádný .json — brána by měřila vzduch");

  for (const rel of seznam) {
    if (rel.endsWith(".schema.json")) continue;
    if (rel.split("/").some((cast) => PRESKOCIT.has(cast))) continue;
    const p = path.join(ROOT, rel);
    // Index není disk: soubor smazaný a nezapsaný v něm pořád je.
    if (!existsSync(p)) continue;
    let d: unknown;
    try {
      d = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    const s = (d as { $schema?: unknown })?.$schema;
    if (typeof s !== "string" || /^https?:/.test(s)) continue;
    out.push({ soubor: rel, schemaRel: s, schemaAbs: path.resolve(path.dirname(p), s) });
  }
  return out;
}

describe("$schema je závazek, ne ozdoba", () => {
  const vsechny = deklarace();

  it("univerzum se našlo — prázdno by vypadalo jako čistý strom", () => {
    expect(vsechny.length, "žádná deklarace $schema — hledač je rozbitý").toBeGreaterThan(4);
  });

  it("každé deklarované schéma existuje", () => {
    const chybi = vsechny
      .filter((d) => !existsSync(d.schemaAbs))
      .map((d) => `${d.soubor} → ${d.schemaRel}`);
    expect(
      chybi,
      "Soubor deklaruje schéma, které neexistuje. Editor pak nevaliduje nic a\n" +
        "deklarace jen předstírá, že je tvar hlídaný. Buď schéma dopiš, nebo\n" +
        "deklaraci odstraň — obojí je poctivé, tenhle mezistav ne.",
    ).toEqual([]);
  });

  it.each(vsechny.map((d) => [d.soubor, d] as const))("%s vyhovuje svému schématu", (_jmeno, d) => {
    const schema = JSON.parse(readFileSync(d.schemaAbs, "utf8")) as Uzel;
    // `$schema` uvnitř schématu je metadata draft-07, ne pravidlo pro data.
    const data = JSON.parse(readFileSync(path.join(ROOT, d.soubor), "utf8"));
    const chyby = overit(data, schema, schema);
    expect(chyby, `${d.soubor} neodpovídá ${d.schemaRel}:\n  ${chyby.join("\n  ")}`).toEqual([]);
  });
});
