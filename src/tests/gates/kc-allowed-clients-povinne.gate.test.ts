/**
 * Brána: komu se věří jako nositeli identity člověka, má JEDEN domov a je povinné
 *
 * `KC_ALLOWED_CLIENTS` skládá `aisha-env-doctor` z deklarovaných OIDC klientů (pravidlo
 * v scripts/lib/povoleni-klienti.mjs). Dvě vady téže třídy, obě změřené 2026-10-04:
 *
 *  - služba měla výčet klientů v KÓDU a compose jí hodnotu nepředával (nebo ji předával
 *    pod jménem proměnné, kterou nikdo nevydával, s prázdnou výchozí hodnotou) — platil
 *    druhý domov vedle deklarace realmu;
 *  - „prázdný seznam pustí každého“ — stačilo, aby seznam vyšel prázdný.
 *
 * Brána měří tvar ve všech službách a ve všech compose; že prázdný seznam odmítne
 * každý token, měří testy jednotlivých služeb.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

function projdiTs(dir: string, out: string[] = []): string[] {
  for (const p of readdirSync(dir)) {
    if (p === "node_modules" || p === "dist" || p === "build" || p === "tests" || p === "__tests__") continue;
    const cesta = join(dir, p);
    if (statSync(cesta).isDirectory()) projdiTs(cesta, out);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts") && !/\.(test|spec)\.ts$/.test(p)) out.push(cesta);
  }
  return out;
}

/** Kód bez komentářů (řádkových i blokových) — rozhoduje se o kódu, ne o vysvětlení. */
const bezKomentaru = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const sluzby = readdirSync(join(ROOT, "services")).filter((s) => existsSync(join(ROOT, "services", s, "src")));
const ctenari = sluzby
  .flatMap((s) => projdiTs(join(ROOT, "services", s, "src")))
  .map((f) => ({ rel: relative(ROOT, f), kod: bezKomentaru(readFileSync(f, "utf-8")) }))
  .filter((f) => f.kod.includes("KC_ALLOWED_CLIENTS"));

describe("KC_ALLOWED_CLIENTS: jeden domov, povinná hodnota, prázdný seznam = nikdo", () => {
  it("měřák vidí služby, které seznam čtou (kotva)", () => {
    const kdo = new Set(ctenari.map((f) => f.rel.split("/")[1]));
    for (const s of ["gateway", "svc-mcp-knowledge", "svc-ide-context"]) {
      expect([...kdo], `služba ${s} seznam povolených klientů čte — měřák ji musí vidět`).toContain(s);
    }
  });

  it("každá služba ho bere přes requireEnv — bez výchozí hodnoty a bez přímého čtení prostředí", () => {
    const vady = ctenari
      .filter((f) => !/requireEnv\(\s*['"]KC_ALLOWED_CLIENTS['"]/.test(f.kod) || /process\.env\.KC_ALLOWED_CLIENTS/.test(f.kod))
      .map((f) => f.rel);
    expect(
      vady,
      "Seznam klientů nesmí mít výchozí hodnotu v kódu: skládá ho env-doctor z deklarace realmu. Použij requireEnv('KC_ALLOWED_CLIENTS', …).",
    ).toEqual([]);
  });

  it("žádná služba nebere prázdný seznam klientů jako „pusť každého“", () => {
    const vady = sluzby
      .flatMap((s) => projdiTs(join(ROOT, "services", s, "src")))
      .filter((f) => /kcAllowedClients\.length\s*===?\s*0\s*\)\s*return\s+true/.test(bezKomentaru(readFileSync(f, "utf-8"))))
      .map((f) => relative(ROOT, f));
    expect(vady, "Prázdný seznam = nikdo. Nevím-li, komu věřit, nevěřím nikomu.").toEqual([]);
  });

  it("každý compose předává KC_ALLOWED_CLIENTS jako povinnou hodnotu téhož jména", () => {
    const radky: string[] = [];
    for (const f of readdirSync(ROOT).filter((n) => /^docker-compose\.coolify.*\.ya?ml$/.test(n))) {
      for (const [i, l] of readFileSync(join(ROOT, f), "utf-8").split("\n").entries()) {
        const m = /^\s*KC_ALLOWED_CLIENTS:\s*(.*?)\s*$/.exec(l);
        if (m) radky.push(`${f}:${i + 1} ${m[1]}`);
      }
    }
    expect(radky.length, "žádný compose KC_ALLOWED_CLIENTS nepředává — kotva chybí").toBeGreaterThanOrEqual(3);
    expect(
      radky.filter((r) => !/ \$\{KC_ALLOWED_CLIENTS:\?[^}]+\}$/.test(r)),
      "Hodnota musí přijít pod svým jménem a být povinná (`${KC_ALLOWED_CLIENTS:?…}`): prázdná výchozí hodnota nebo jiné jméno proměnné znamená, že rozhoduje výčet v kódu služby.",
    ).toEqual([]);
  });
});
