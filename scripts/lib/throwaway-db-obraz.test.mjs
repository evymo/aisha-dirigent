/**
 * Obraz zahazovací DB: tag podle OTISKU obsahu infra/postgres — a JEDEN domov.
 * ⛔ 2026-10-02: typegen jel na proměnlivém `aisha-db-throwaway:pg<major>`, který
 * přestavěl kdokoli z jiného stromu; testovací DB už otisk měla. Dvě pravidla pro
 * týž obraz se rozešla a typegen spouštěl cizí entrypoint.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { otiskKontextuDb, vychoziObrazDb } from "./throwaway-db-obraz.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Strom s infra/postgres podle mapy cesta → obsah. */
function strom(soubory) {
  const root = mkdtempSync(join(tmpdir(), "throwaway-obraz-"));
  for (const [cesta, obsah] of Object.entries(soubory)) {
    const abs = join(root, "infra/postgres", cesta);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, obsah);
  }
  return root;
}

const ZAKLAD = { Dockerfile: "FROM postgres", "entrypoint-wrapper.sh": "#!/bin/sh\n", "initdb/002_set_passwords.sh": "x" };

describe("otisk obsahu infra/postgres", () => {
  it("týž obsah = týž otisk (i v jiném adresáři), 12 hex znaků", () => {
    const a = otiskKontextuDb(strom(ZAKLAD));
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(otiskKontextuDb(strom(ZAKLAD))).toBe(a);
  });

  it("⛔ změna entrypointu, souboru v podsložce i přejmenování otisk změní", () => {
    const a = otiskKontextuDb(strom(ZAKLAD));
    expect(otiskKontextuDb(strom({ ...ZAKLAD, "entrypoint-wrapper.sh": "#!/bin/sh\necho jinak\n" }))).not.toBe(a);
    expect(otiskKontextuDb(strom({ ...ZAKLAD, "initdb/002_set_passwords.sh": "y" }))).not.toBe(a);
    const { "entrypoint-wrapper.sh": obsah, ...zbytek } = ZAKLAD;
    expect(otiskKontextuDb(strom({ ...zbytek, "entrypoint.sh": obsah }))).not.toBe(a);
  });

  it("tag nese major verzi i otisk", () => {
    const root = strom(ZAKLAD);
    expect(vychoziObrazDb(root, 18)).toBe(`aisha-db-throwaway:pg18-${otiskKontextuDb(root)}`);
    expect(vychoziObrazDb(root, "17")).not.toBe(vychoziObrazDb(root, "18"));
  });
});

describe("jeden domov obrazu zahazovací DB", () => {
  it("⛔ oba spouštěče berou výchozí obraz z téhož modulu, žádný si tag nestaví sám", () => {
    for (const s of ["db/with-throwaway-db.mjs", "db/types-refresh-throwaway.mjs"]) {
      const zdroj = readFileSync(join(SCRIPTS, s), "utf8");
      expect(zdroj, `${s} musí volat sdílený vychoziObrazDb`).toMatch(/vychoziObrazDb\(ROOT, PG_MAJOR\)/);
      expect(zdroj, `${s} si nesmí počítat otisk sám`).not.toMatch(/createHash\(/);
      // Proměnlivý tag bez otisku — přesně to, co rozbilo typegen.
      expect(zdroj, `${s} skládá tag bez otisku`).not.toMatch(/`aisha-db-throwaway:pg\$\{[^}]+\}`/);
    }
  });
});
