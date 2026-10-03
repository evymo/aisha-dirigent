import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { KOD_NEZMERENO, KOD_SELHANI, KOD_ZELENA } from "../test/verdikt-kody.mjs";
import { MIMO_SADU, NENACETL, ZNACKA_DB_NEDOSTUPNA, jmenoPadu, souboryDbSady, verdikt } from "./rohatka-test-db.mjs";

const KOREN = "/repo";
const soubor = (jmeno, status, testy, message) => ({
  name: `${KOREN}/src/tests/db/${jmeno}`,
  status,
  message,
  assertionResults: testy.map(([predci, title, st, msg]) => ({ ancestorTitles: predci, title, status: st, failureMessages: msg ? [msg] : [] })),
});
const OCEKAVANE = ["src/tests/db/a.test.ts", "src/tests/db/b.test.ts"];
const report = (...testResults) => ({ testResults });
const A_OK = soubor("a.test.ts", "passed", [[["blok"], "projde", "passed"]]);
const B_PAD = soubor("b.test.ts", "failed", [[["x", "y"], "padá", "failed", "AssertionError: čekal 1"], [[], "projde", "passed"]]);
const PAD_B = jmenoPadu("src/tests/db/b.test.ts", ["x", "y"], "padá");

describe("rohatka test:db — verdikt", () => {
  test("nový pád shodí (1) a nese zprávu", () => {
    const v = verdikt({ report: report(A_OK, B_PAD), koren: KOREN, ocekavane: OCEKAVANE, znami: [] });
    expect(v.kod).toBe(KOD_SELHANI);
    expect(v.nove).toEqual([PAD_B]);
    expect(v.zpravy.get(PAD_B)).toMatch(/čekal 1/);
  });

  test("známý pád neshodí (0), jen se ohlásí", () => {
    const v = verdikt({ report: report(A_OK, B_PAD), koren: KOREN, ocekavane: OCEKAVANE, znami: [PAD_B] });
    expect(v.kod).toBe(KOD_ZELENA);
    expect(v.zname).toEqual([PAD_B]);
    expect(v.nove).toEqual([]);
  });

  test("opravená položka baseline se ohlásí, běh netrestá", () => {
    const v = verdikt({ report: report(A_OK, soubor("b.test.ts", "passed", [[["x", "y"], "padá", "passed"]])), koren: KOREN, ocekavane: OCEKAVANE, znami: [PAD_B] });
    expect(v.kod).toBe(KOD_ZELENA);
    expect(v.opravene).toEqual([PAD_B]);
  });

  test("soubor, který spadl bez padlého testu, je pád „nenačetl se“", () => {
    const v = verdikt({ report: report(A_OK, soubor("b.test.ts", "failed", [], "Cannot find module x")), koren: KOREN, ocekavane: OCEKAVANE, znami: [] });
    expect(v.kod).toBe(KOD_SELHANI);
    expect(v.nove).toEqual([jmenoPadu("src/tests/db/b.test.ts", [], NENACETL)]);
  });

  test("chybí-li v reportu soubor sady, je to NEZMĚŘENO (75), ne zelená", () => {
    const v = verdikt({ report: report(A_OK), koren: KOREN, ocekavane: OCEKAVANE, znami: [] });
    expect(v.kod).toBe(KOD_NEZMERENO);
    expect(v.chybi).toEqual(["src/tests/db/b.test.ts"]);
  });

  test("nový pád vyhraje nad nezměřeným souborem (změřená vada je vada)", () => {
    const v = verdikt({ report: report(B_PAD), koren: KOREN, ocekavane: OCEKAVANE, znami: [] });
    expect(v.kod).toBe(KOD_SELHANI);
    expect(v.chybi).toEqual(["src/tests/db/a.test.ts"]);
  });

  // ⛔ Rozbor #1113 (2026-09-28): „dutá zelená" — soubor bez DB se nesmí počítat jako změřený.
  const B_BEZ_DB_NACTENI = soubor("b.test.ts", "failed", [], `Error: ${ZNACKA_DB_NEDOSTUPNA}: DB je povinná, ale neodpověděla`);
  const B_BEZ_DB_V_TESTU = soubor("b.test.ts", "failed", [[[], "čte DB", "failed", `Error: ${ZNACKA_DB_NEDOSTUPNA}: …`]]);

  test.each([
    ["při načtení souboru", B_BEZ_DB_NACTENI],
    ["uvnitř testu", B_BEZ_DB_V_TESTU],
  ])("soubor bez DB (povinný režim, %s) je NEZMĚŘENO (75), ne pád a ne zelená", (_, b) => {
    const v = verdikt({ report: report(A_OK, b), koren: KOREN, ocekavane: OCEKAVANE, znami: [] });
    expect(v.kod).toBe(KOD_NEZMERENO);
    expect(v.nove).toEqual([]);
    expect(v.duvod).toMatch(/nedostal/);
  });

  test("soubor bez DB neschová nový pád v jiném souboru (změřená vada je vada)", () => {
    const v = verdikt({ report: report(B_PAD, soubor("a.test.ts", "failed", [], `${ZNACKA_DB_NEDOSTUPNA}: …`)), koren: KOREN, ocekavane: OCEKAVANE, znami: [] });
    expect(v.kod).toBe(KOD_SELHANI);
    expect(v.nove).toEqual([PAD_B]);
  });

  test.each([[null], [{}], [{ testResults: [] }]])("chybějící nebo prázdný report je NEZMĚŘENO: %j", (r) => {
    expect(verdikt({ report: r, koren: KOREN, ocekavane: OCEKAVANE, znami: [] }).kod).toBe(KOD_NEZMERENO);
  });
});

describe("rohatka test:db — soubory sady", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rohatka-sada-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("sada = *.test/spec.ts(x) i v podadresářích, bez pomocníků a bez MIMO_SADU", () => {
    const db = path.join(dir, "src/tests/db");
    mkdirSync(path.join(db, "pod"), { recursive: true });
    for (const f of ["a.test.ts", "pod/b.spec.tsx", "validation-utils.ts", "x.baseline.json", path.basename(MIMO_SADU[0])]) {
      writeFileSync(path.join(db, f), "");
    }
    expect(souboryDbSady(dir)).toEqual(["src/tests/db/a.test.ts", "src/tests/db/pod/b.spec.tsx"]);
  });
});
