/**
 * Brána: `git clone` nesmí zahodit důvod svého nezdaru.
 *
 * TŘÍDA VADY: velký přenos se nahodile utrhne, jeden pokus to nepřežije —
 * a `2>/dev/null` z toho udělá bezobsažné „clone failed". Operátor pak ladí
 * pověření, přestože jde o stav sítě.
 *
 * ⛔ NAMĚŘENO 2026-08-20 na riqi, DVAKRÁT V JEDNOM DNI:
 *
 *  1. Klon instance-data padal na `RPC failed; curl 18 Transferred a partial
 *     file`. Volající měl `2>/dev/null`, takže zbylo „clone failed" — přitom
 *     `git ls-remote` proti témuž URL vracel refy. Rollout kvůli tomu stál.
 *  2. Nasazení core i edge aplikace selhalo na
 *     `open Dockerfile.pki-init: no such file or directory`, ačkoli ten soubor
 *     v nasazovaném commitu JE (4031 B) — buildkit dostal 2 bajty. Neúplný
 *     kontext. Druhý pokus prošel BEZE ZMĚNY KÓDU. Mezitím byl celý veřejný
 *     vstup 503, protože Coolify u compose aplikací nejdřív zastaví staré
 *     kontejnery a teprve pak staví nové.
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis): žádné volání `git clone` ve sledovaných
 * skriptech nesmí mít na témže řádku `2>/dev/null` ani `>/dev/null 2>&1`.
 * Univerzum se HLEDÁ přes `git ls-files`.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const POMOCNIK = "scripts/lib/git-klon.sh";

/** Řádky, kde se klonuje a stderr se zahazuje. */
export function tichyKlon(cesta: string, text: string): string[] {
  if (cesta.endsWith("klon-nesmi-zahodit-duvod.gate.test.ts")) return [];
  if (cesta === POMOCNIK) return []; // pomocník stderr SCHOVÁVÁ a pak vysloví
  const nalezy: string[] = [];
  text.split("\n").forEach((radek, i) => {
    if (!/\bgit\s+(-c\s+\S+\s+)*clone\b/.test(radek)) return;
    if (/^\s*#/.test(radek)) return; // komentář ten tvar popisuje, nevykonává
    if (/2>\s*\/dev\/null|>\s*\/dev\/null\s+2>&1/.test(radek)) nalezy.push(`${cesta}:${i + 1}`);
  });
  return nalezy;
}

describe("git clone nesmí zahodit důvod", () => {
  test("detektor pozná tvar, kvůli kterému brána vznikla", () => {
    expect(tichyKlon("a.sh", 'git clone --depth 1 "$U" "$D" 2>/dev/null')).toEqual(["a.sh:1"]);
    expect(tichyKlon("b.sh", 'git clone --depth 1 "$U" "$D" >/dev/null 2>&1')).toEqual(["b.sh:1"]);
    expect(tichyKlon("c.sh", 'git -c http.lowSpeedLimit=0 clone "$U" "$D" 2>/dev/null')).toEqual(["c.sh:1"]);
    // Poctivé volání projde.
    expect(tichyKlon("d.sh", 'git clone --depth 1 "$U" "$D" 2>"$ERR"')).toEqual([]);
    expect(tichyKlon("e.sh", 'klonuj "$U" "$D"')).toEqual([]);
    // Komentář, který ten tvar popisuje, není jeho výskytem.
    expect(tichyKlon("f.sh", '# dřív tu bylo git clone … 2>/dev/null')).toEqual([]);
  });

  test("pomocník existuje a umí odpovědět NE", () => {
    const zdroj = readFileSync(join(ROOT, POMOCNIK), "utf-8");
    expect(zdroj, `${POMOCNIK} musí opakovat pokusy`).toMatch(/for\s+_kl_pokus\s+in/);
    expect(zdroj, `${POMOCNIK} musí od 2. pokusu klonovat bez historických blobů`).toContain("--filter=blob:none");
    expect(zdroj, `${POMOCNIK} musí při nezdaru vrátit NENULU`).toMatch(/return 1/);
    expect(zdroj, `${POMOCNIK} musí redigovat pověření v URL`).toMatch(/\*\*\*@/);
  });

  test("žádné volání klonu nezahazuje důvod", () => {
    const nalezy = execFileSync("git", ["ls-files", "scripts", "keycloak", "services"], { cwd: ROOT, encoding: "utf-8" })
      .split("\n").filter(Boolean)
      .flatMap((c) => tichyKlon(c, readFileSync(join(ROOT, c), "utf-8")));
    expect(
      nalezy,
      "tady se klonuje a důvod nezdaru jde do koše. Utržený přenos pak vypadá jako špatné\n" +
        "pověření a hledá se úplně jinde — naměřeno 2026-08-20 dvakrát, podruhé to stálo\n" +
        "výpadek celého veřejného vstupu.\n\n" +
        `CO S TÍM: použij \`${POMOCNIK}\` — \`. lib/git-klon.sh\` a pak \`klonuj URL CÍL [REF]\`.\n` +
        "Opakuje, od 2. pokusu klonuje bez historických blobů a důvod VYSLOVÍ.\n" +
        "NEDĚLEJ: nenahrazuj `2>/dev/null` za `2>&1 | tail` — roura zahodí návratový kód\n" +
        "a uřízne diagnostiku, tedy obojí najednou.\n\n" +
        "ZAHAZUJE DŮVOD:\n  " + nalezy.join("\n  "),
    ).toEqual([]);
  });
});
