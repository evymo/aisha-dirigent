/**
 * Brána: krok nesmí po OHLÁŠENÉ CHYBĚ skončit nulou.
 *
 * TŘÍDA VADY: skript vypíše ❌, a přesto se ukončí úspěchem „ať to nespadne".
 * Nadřízená vrstva (Coolify, vlny, cold-start:verify) pak zcela správně hlásí
 * „krok proběhl" — protože proběhl. Vada se přesune o tři patra dál, kde už
 * nemá jméno.
 *
 * ⛔ NAMĚŘENO 2026-08-19 na riqi:
 *   pki-init:  ❌ Keycloak ROPC request failed: curl: (60) SSL: no alternative
 *              certificate subject name matches '<fork>-auth.backend.<fork>.internal'
 *   docker ps: pki-init-… Exited (0)
 * Šest takových konců mělo v `issue-netbird-mesh-cert.sh` komentář
 * „Don't fail container — fallback to self-signed". Ten fallback je důvod,
 * proč každý netbird-agent umíral na `tls: internal error` a proč mesh
 * nevstal, aniž by to kterékoli měřidlo pojmenovalo.
 *
 * CO SE MĚŘÍ: pro každý `exit 0` se najde NEJBLIŽŠÍ PŘEDCHOZÍ hlášení stavu
 * (`err` / `ok` / `warn`). Je-li to `err`, krok lže. Po `ok` („není co dělat")
 * nebo `warn` je nula legitimní — proto se neměří vzdálenost v řádcích, ta
 * přeskakuje hranice větví a označila by dva správné skripty za vadné.
 *
 * Jednořádková DEFINICE funkce (`nedokonceno() { err "$*"; … }`) není hlášení:
 * na svém řádku nic nevypisuje, jen pojmenovává. Naměřeno 2026-09-13: definice
 * v hlavičce cold-startu se stala „nejbližším err" pro `--help` `exit 0` o šedesát
 * řádků níž. Definice se proto přeskočí a hledá se dál — skutečné `err` nad ní
 * brána chytí stejně (viz sonda v prvním testu).
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());

/** Univerzum se HLEDÁ v gitu, nevypisuje se ručně — jinak brána zdědí díry seznamu. */
function shellSkripty(): string[] {
  return execFileSync("git", ["ls-files", "*.sh"], { cwd: ROOT, encoding: "utf-8" })
    .split("\n")
    .filter(Boolean);
}

const HLASENI = /(^|[^A-Za-z0-9_])(err|ok|warn)[ \t]+["']/;
const EXIT_NULA = /^[ \t]*exit[ \t]+0([ \t]|#|$)/;
const DEFINICE_FUNKCE = /^[ \t]*(function[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*\(\)[ \t]*\{.*\}[ \t]*$/;

/** Vrátí čísla řádků (1-indexovaně), kde `exit 0` následuje po `err`. */
export function lzivéKonce(zdroj: string): number[] {
  const radky = zdroj.split("\n");
  const nalezy: number[] = [];
  for (let i = 0; i < radky.length; i++) {
    if (!EXIT_NULA.test(radky[i])) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (DEFINICE_FUNKCE.test(radky[j])) continue; // definice nic nehlásí
      const m = HLASENI.exec(radky[j]);
      if (!m) continue;
      if (m[2] === "err") nalezy.push(i + 1);
      break; // rozhoduje NEJBLIŽŠÍ hlášení, ne kterékoli v okolí
    }
  }
  return nalezy;
}

describe("krok nesmí hlásit úspěch po chybě", () => {
  test("detektor pozná tvar, kvůli kterému brána vznikla", () => {
    // Bez tohohle by se brána mohla stát tichým no-opem a nikdo by si nevšiml.
    expect(lzivéKonce(['err "ROPC failed:"', "  exit 0  # fallback"].join("\n"))).toEqual([2]);
    expect(lzivéKonce(['ok "cert still valid — skipping"', "  exit 0"].join("\n"))).toEqual([]);
    expect(lzivéKonce(['warn "nothing to apply"', "  exit 0"].join("\n"))).toEqual([]);
    expect(lzivéKonce(['err "creds missing"', "  exit 1"].join("\n"))).toEqual([]);
    // Definice funkce není hlášení — ale skutečné `err` nad ní se přes ni neschová.
    expect(lzivéKonce(['ok "start"', 'nedokonceno() { err "$*"; X+=("$*"); }', "  exit 0"].join("\n"))).toEqual([]);
    expect(lzivéKonce(['err "ROPC failed:"', 'nedokonceno() { err "$*"; }', "  exit 0"].join("\n"))).toEqual([3]);
  });

  test("žádný skript v repu po `err` neskončí nulou", () => {
    const vady: string[] = [];
    for (const rel of shellSkripty()) {
      for (const n of lzivéKonce(readFileSync(join(ROOT, rel), "utf-8"))) {
        vady.push(`${rel}:${n}`);
      }
    }
    expect(
      vady,
      "krok, který ohlásil chybu, musí skončit NENULOVĚ — nula ji jen přesune o patro výš,\n" +
        "kde už nemá jméno (Coolify i vlny pak správně hlásí „krok proběhl\").\n\n" +
        "CO S TÍM: `exit 0` po `err` přepiš na `exit 1`. Má-li běh pokračovat, nehlas to\n" +
        "přes `err`, ale `warn` — a napiš PROČ je ten stav přijatelný.\n" +
        "NEDĚLEJ: nepřidávej sem výjimku. `exit 0` po `ok`/`warn` brána propouští sama.\n\n" +
        "LŽIVÉ KONCE:\n  " + vady.join("\n  "),
    ).toEqual([]);
  });
});
