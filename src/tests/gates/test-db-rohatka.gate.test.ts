/**
 * Celá sada `src/tests/db` běží v CI — s rohatkou známých pádů.
 *
 * ⛔ NAMĚŘENO 2026-09-27: CI pouštělo jen jmenované DB soubory; celá `test:db`
 * nikdy. Tři agentní runtime testy tak padaly dva měsíce bez povšimnutí.
 * Rohatka (scripts/lib/rohatka-test-db.mjs) dovolí sadu zapojit blokujícně:
 * nový pád shodí, známý dluh v `src/tests/db/test-db.baseline.json` smí jen klesat.
 *
 * Brána drží věci, bez kterých by rohatka byla dekorace — nebo past:
 *  1. CI ji opravdu pouští, a to s tvrdou kontrolou DinD (bez DB = selhání, ne zelená);
 *  2. skript jde přes zahazovací DB a zapíná POVINNOU DB v sondě testů
 *     (nedostupná DB = NEZMĚŘENO, ne tiše přeskočený soubor — „dutá zelená");
 *  3. baseline nehnije — položka ukazuje na existující soubor sady, bez duplicit, seřazeně;
 *  4. rohatka běží jen na PR a NEHRADÍ nasazení (rozhodnutí 2026-09-28, rozbor #1113:
 *     v needs deploy-koren/deploy-stacky by červená rohatka na mainu přeskočila kořen
 *     a stacky, zatímco core/edge/extranet by se nasadily → částečné nasazení).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ENV_DB_POVINNA, MIMO_SADU, SADA, ZNACKA_DB_NEDOSTUPNA } from "../../../scripts/lib/rohatka-test-db.mjs";

const ROOT = process.cwd();
const cti = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const CI = cti(".forgejo/workflows/ci.yml");
const PKG = JSON.parse(cti("package.json")) as { scripts: Record<string, string> };
const BASELINE = JSON.parse(cti(`${SADA}/test-db.baseline.json`)) as { pady: string[] };

/** Tělo úlohy CI podle jejího klíče (do další úlohy na téže úrovni odsazení). */
function uloha(klic: string): string {
  const m = CI.match(new RegExp(`^  ${klic}:\\n([\\s\\S]*?)(?=^  [a-z0-9-]+:\\n|(?![\\s\\S]))`, "m"));
  return m ? m[1] : "";
}

describe("celá test:db v CI s rohatkou", () => {
  test("skript test:db:rohatka běží nad zahazovací DB a pouští rohatku", () => {
    expect(PKG.scripts["test:db:rohatka"]).toBe(
      "node scripts/db/with-throwaway-db.mjs -- node scripts/test/test-db-rohatka.mjs",
    );
  });

  test("CI má úlohu, která ho pouští — a bez DinD selže, nepřeskočí do zelené", () => {
    const telo = uloha("db-runtime-rohatka");
    expect(telo, "úloha db-runtime-rohatka v ci.yml chybí").not.toBe("");
    const kroky = telo.split(/\n(?= {6}- )/);
    const krok = kroky.find((k) => k.includes("npm run test:db:rohatka")) ?? "";
    expect(krok, "žádný krok nepouští npm run test:db:rohatka").not.toBe("");
    expect(krok, "krok rohatky musí sám ověřit DinD a bez něj skončit chybou").toMatch(/docker info[\s\S]*exit 1/);
    expect(krok, "rohatka nesmí být continue-on-error").not.toMatch(/continue-on-error:\s*true/);
  });

  test("⛔ rohatka NEHRADÍ nasazení a běží jen na PR (jinak částečné nasazení)", () => {
    for (const nasazeni of ["deploy-koren", "deploy-stacky", "deploy-core", "deploy-edge", "deploy-extranet"]) {
      const telo = uloha(nasazeni);
      expect(telo, `úloha ${nasazeni} v ci.yml chybí`).not.toBe("");
      expect(telo, `${nasazeni} nesmí čekat na rohatku ani ji číst v if:`).not.toContain("db-runtime-rohatka");
    }
    const hlava = uloha("db-runtime-rohatka").split(/\n {4}steps:\n/)[0];
    expect(hlava, "rohatka musí mít v if: podmínku pull_request").toMatch(/if:[\s\S]*github\.event_name == 'pull_request'/);
  });

  test("⛔ skript rohatky zapíná povinnou DB a sonda testů v ní nedostupnou DB nepřeskočí", () => {
    const skript = cti("scripts/test/test-db-rohatka.mjs");
    expect(skript, "vitest rohatky musí dostat povinnou DB v env").toMatch(/\[ENV_DB_POVINNA\]:\s*"1"/);
    const sonda = cti("src/tests/db/test-env-probe.ts");
    expect(sonda, "sonda čte povinný režim z téhož env").toContain(`process.env.${ENV_DB_POVINNA} === "1"`);
    expect(sonda, "sonda bere značku z knihovny rohatky (jeden domov)").toMatch(/import \{ ZNACKA_DB_NEDOSTUPNA \} from "..\/..\/..\/scripts\/lib\/rohatka-test-db\.mjs"/);
    expect(ZNACKA_DB_NEDOSTUPNA).toBe("AISHA_TESTDB_NEDOSTUPNA");
  });

  test("soubory mimo sadu mají vlastní skript (jinak by neběžely nikde)", () => {
    const skripty = Object.values(PKG.scripts).join("\n");
    for (const f of MIMO_SADU) expect(skripty, `${f} nemá vlastní npm skript`).toContain(f);
  });

  test("baseline: seřazená, bez duplicit, každá položka ukazuje na existující soubor sady", () => {
    expect(Array.isArray(BASELINE.pady)).toBe(true);
    expect(BASELINE.pady).toEqual([...new Set(BASELINE.pady)].sort());
    for (const pad of BASELINE.pady) {
      const soubor = pad.split(" › ")[0];
      expect(soubor.startsWith(`${SADA}/`), `${pad}: soubor mimo sadu`).toBe(true);
      expect(MIMO_SADU.includes(soubor), `${pad}: soubor je mimo sadu (vlastní skript)`).toBe(false);
      expect(existsSync(path.join(ROOT, soubor)), `${pad}: soubor neexistuje — smaž položku`).toBe(true);
    }
  });
});
