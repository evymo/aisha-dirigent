/**
 * Tajemství prvního startu zahazovací DB: env soubor, jinak efemérní klíče — a JEDEN domov.
 * ⛔ 2026-09-25 se dvě kopie rozešly: types-refresh-throwaway.mjs efemérní klíče neměl a
 * v čerstvém worktree padal na „VAULT_ENCRYPTION_KEY must be set".
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EFEMERNI_KLICE, argumentyTajemstvi } from "./throwaway-db-tajemstvi.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("tajemství prvního startu zahazovací DB", () => {
  it("s .env.local.dev se předá env soubor a nic se nevymýšlí", () => {
    const root = mkdtempSync(join(tmpdir(), "throwaway-"));
    writeFileSync(join(root, ".env.local.dev"), "VAULT_ENCRYPTION_KEY=x\n");
    expect(argumentyTajemstvi(root, {}, () => "NAHODNE")).toEqual(["--env-file", join(root, ".env.local.dev")]);
  });

  it("⛔ bez env souboru dostane KAŽDÝ klíč se stráží efemérní hodnotu (jinak init DB spadne)", () => {
    const root = mkdtempSync(join(tmpdir(), "throwaway-"));
    const args = argumentyTajemstvi(root, {}, () => "NAHODNE");
    expect(args).toEqual(EFEMERNI_KLICE.flatMap((k) => ["-e", `${k}=NAHODNE`]));
    expect(EFEMERNI_KLICE).toContain("VAULT_ENCRYPTION_KEY");
    expect(EFEMERNI_KLICE).toContain("COLUMN_ENCRYPTION_KEY");
  });

  it("výslovná hodnota z prostředí vyhrává, prázdná se bere jako chybějící", () => {
    const root = mkdtempSync(join(tmpdir(), "throwaway-"));
    const args = argumentyTajemstvi(root, { VAULT_ENCRYPTION_KEY: "z-prostredi", JWT_SECRET: "   " }, () => "NAHODNE");
    expect(args).toContain("VAULT_ENCRYPTION_KEY=z-prostredi");
    expect(args).toContain("JWT_SECRET=NAHODNE");
  });

  // ⛔ NAMĚŘENO 2026-09-29 (fork, sdílený Mac 5,6 GB volných): obraz postgresu deklaruje VOLUME pro data,
  // úklid kontejneru bez přepínače `-v` po každém běhu nechal anonymní svazek — 490 kusů = 93,3 GB (od 17. 9., jen 28. 9. +125).
  it("⛔ úklid zahazovací DB maže i anonymní svazek s daty (přepínač -v)", () => {
    for (const s of ["db/with-throwaway-db.mjs", "db/types-refresh-throwaway.mjs"]) {
      const zdroj = readFileSync(join(SCRIPTS, s), "utf8");
      const volani = zdroj.match(/spawnSync\("docker", \["rm"[^\]]*\]/g) ?? [];
      expect(volani.length, `${s}: měřidlo nenašlo žádný úklid kontejneru`).toBeGreaterThan(0);
      for (const v of volani) expect(v, `${s}: úklid bez -v nechá anonymní svazek`).toMatch(/"-v"/);
    }
  });

  it("⛔ jeden domov: oba spouštěče zahazovací DB berou tajemství z téhož modulu, žádný si nestaví vlastní", () => {
    for (const s of ["db/with-throwaway-db.mjs", "db/types-refresh-throwaway.mjs"]) {
      const zdroj = readFileSync(join(SCRIPTS, s), "utf8");
      expect(zdroj, `${s} musí volat sdílený argumentyTajemstvi`).toMatch(/argumentyTajemstvi\(ROOT\)/);
      expect(zdroj, `${s} si nesmí skládat cestu k .env.local.dev sám`).not.toMatch(/["']\.env\.local\.dev["']/);
    }
  });
});
