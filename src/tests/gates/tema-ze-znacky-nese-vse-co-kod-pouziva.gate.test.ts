/**
 * Téma vygenerované ze ZNAČKY nese všechno, co kód používá.
 *
 * ⛔ CO SE STALO (2026-09-09, RIQ Řidič build 12). Generátor bral
 * `brand.mobile` CELOU a platformní základ z `tokens.json` zahodil. Značka
 * Řidiče nesla sedm typografických klíčů, kód jich používá čtrnáct — takže
 * `typography.dataMicro` v postaveném balíku NEEXISTOVALO.
 *
 * `BlockRenderer.tsx:783` na něj sáhne v `StyleSheet.create` na úrovni modulu,
 * tedy PŘI NAČÍTÁNÍ, ne při vykreslování. Aplikace proto nespadla do záchytné
 * sítě — spadl celý proces:
 *
 *     TypeError: Cannot read property 'fontSize' of undefined
 *     loadRoute → getQualifiedRouteComponent → SceneView
 *
 * ⭐ PROČ TO ŽÁDNÁ BRÁNA NECHYTILA. Ve zdrojovém stromě je `src/theme/index.ts`
 * ÚPLNÝ — všech 14 klíčů. Rozdíl vzniká až při buildu, kdy
 * `instance-overlay-apply.sh` spustí `gen:tokens` a soubor přegeneruje. Lokálně
 * tedy všechno vypadalo v pořádku a vada se projevila až v telefonu.
 *
 * Proto tahle brána neměří strom, ale VÝSLEDEK GENEROVÁNÍ pro každou značku,
 * kterou v repu najde — univerzum se HLEDÁ, nepíše.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");

/** Klíče, na které kód sahá — čtou se z kódu, nevypisují se sem. */
function pouziteTokeny(): string[] {
  const out = execFileSync(
    "git",
    ["grep", "-hoE", "typography\\.[a-zA-Z0-9_]+", "--", "mobile-app/src"],
    { cwd: ROOT, encoding: "utf-8" },
  );
  return [...new Set(out.split("\n").filter(Boolean).map((s) => s.split(".")[1]))].sort();
}

/**
 * ⛔ UNIVERZUM SE NESMÍ OPÍRAT O TO, JAKÉ ZNAČKY V REPU NÁHODOU JSOU.
 *
 * První verze téhle brány procházela značky z `instances/` — a byla SLEPÁ:
 * v tomhle stromě je jen `_default` s úplnou sadou, kdežto vadná značka
 * (RIQ Řidič, 7 klíčů) žije v instančním repu, kam platformní strom nevidí.
 * Mutace „vrať původní chování" ji nechala ZELENOU.
 *
 * Proto se neměří VZOREK, ale VLASTNOST: značka smí hodnoty přebít, ale ne
 * odstranit. Ověří se uměle zmenšenou značkou — ta existuje vždycky a nezávisí
 * na tom, co kdo do repa přidal.
 */
function zmensenaZnacka(): string {
  const floor = JSON.parse(readFileSync(join(ROOT, "packages/design-tokens/tokens.json"), "utf-8"));
  const typ = floor.mobile.typography;
  const ponechat = Object.keys(typ).filter((k) => !k.startsWith("$")).slice(0, 3);
  floor.mobile.typography = Object.fromEntries(
    Object.entries(typ).filter(([k]) => k.startsWith("$") || ponechat.includes(k)),
  );
  floor.$meta = { ...(floor.$meta ?? {}), name: "zmensena-znacka-pro-branu" };
  const f = join(mkdtempSync(join(tmpdir(), "znacka-")), "brand.tokens.json");
  writeFileSync(f, JSON.stringify(floor), "utf-8");
  return f;
}

/** Značky, které v repu skutečně jsou — měří se navrch, ne místo vlastnosti. */
function znackyVRepu(): string[] {
  const out = [join(ROOT, "packages/design-tokens/tokens.json")];
  const insts = join(ROOT, "instances");
  if (existsSync(insts)) {
    for (const d of readdirSync(insts)) {
      const p = join(insts, d, "brand.tokens.json");
      if (existsSync(p)) out.push(p);
    }
  }
  return out;
}

function temaZeZnacky(brandFile: string): string[] {
  const out = join(mkdtempSync(join(tmpdir(), "tema-")), "index.ts");
  execFileSync("node", ["packages/design-tokens/build.mjs", "--brand", brandFile, "--out", out], {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: "pipe",
  });
  const s = readFileSync(out, "utf-8");
  const blok = /export const typography\s*=\s*\{([\s\S]*?)\n\}/.exec(s);
  if (!blok) return [];
  return [...blok[1].matchAll(/^ {2}([a-zA-Z0-9_]+)\s*:/gm)].map((m) => m[1]);
}

describe("téma ze značky nese vše, co kód používá", () => {
  const pouzito = pouziteTokeny();

  it("univerzum není prázdné — jinak by brána mlčela z nedostatku vstupu", () => {
    expect(pouzito.length).toBeGreaterThan(5);
    expect(znackyVRepu().length).toBeGreaterThan(0);
  });

  it("ZNAČKA PŘEBÍJÍ, NEMAŽE — zmenšená značka dá stále úplné téma", () => {
    const maKlice = temaZeZnacky(zmensenaZnacka());
    const chybi = pouzito.filter((k) => !maKlice.includes(k));
    expect(
      chybi,
      `Značka se třemi typografickými klíči vyrobila téma BEZ: ${chybi.join(", ")}.\n` +
        `Generátor tedy značkou NAHRAZUJE platformní základ místo aby ho doplnil.\n` +
        `Build z takové značky spadne PŘI NAČÍTÁNÍ MODULU (StyleSheet.create na úrovni\n` +
        `souboru), tedy pádem celého procesu — ne chybou na obrazovce.`,
    ).toEqual([]);
  });

  it.each(znackyVRepu())("%s: vygenerované téma pokrývá všechny použité tokeny", (brandFile) => {
    const maKlice = temaZeZnacky(brandFile);
    const chybi = pouzito.filter((k) => !maKlice.includes(k));
    expect(chybi, `Značka ${brandFile.replace(ROOT, "")} vyrobí téma BEZ: ${chybi.join(", ")}`).toEqual([]);
  });
});
