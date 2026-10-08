/**
 * tenant-sentinels — čtení jmen instancí nesmí jméno prozradit ani v chybě.
 *
 * ⛔ NAMĚŘENO 2026-10-05: hláška JSON.parse v Node 22 nese výřez obsahu souboru
 * („…"tinels": [acme-…"). Varování o poškozeném config/tenant.json ji vypisovalo, takže
 * jméno ze soukromého seznamu odešlo do výpisu (a ve veřejné CI do logu). Jména v testu
 * jsou smyšlená.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTenantSentinels, mistoChyby, ownTenantIds } from "./tenant-sentinels.mjs";

const TAJNE = "acme-tajny-najemce";

function koren(obsah) {
  const d = mkdtempSync(path.join(tmpdir(), "sentinely-"));
  mkdirSync(path.join(d, "config"));
  if (obsah !== undefined) writeFileSync(path.join(d, "config/tenant.json"), obsah);
  return d;
}

afterEach(() => vi.restoreAllMocks());

describe("tenant-sentinels — poškozený tenant.json", () => {
  it("varování jmenuje soubor a místo, ale ne obsah (ani výřez z hlášky parseru)", () => {
    const varovani = [];
    vi.spyOn(console, "warn").mockImplementation((...a) => varovani.push(a.join(" ")));
    const d = koren(`{ "sentinels": [${TAJNE}", "dalsi"] }`);
    expect(loadTenantSentinels(d, {})).toEqual([]);
    expect(varovani).toHaveLength(1);
    expect(varovani[0]).toContain("config/tenant.json");
    expect(varovani[0]).toMatch(/neplatný JSON/);
    expect(varovani[0].toLowerCase()).not.toContain("acme");
    expect(varovani[0]).not.toContain("tajny");
  });

  it("kotva: hláška parseru výřez obsahu opravdu nese (proto se nesmí vypsat)", () => {
    let zprava = "";
    try {
      JSON.parse(`{ "sentinels": [${TAJNE}"] }`);
    } catch (e) {
      zprava = e.message;
    }
    expect(zprava).toContain("acme");
    expect(mistoChyby(new SyntaxError(zprava))).not.toContain("acme");
  });

  it("mistoChyby vrátí jen čísla místa nebo třídu chyby", () => {
    expect(mistoChyby(new SyntaxError(`Unexpected token a, "[acme-x" is not valid JSON at position 13 (line 1 column 14)`))).toBe(
      "neplatný JSON, řádek 1, sloupec 14",
    );
    expect(mistoChyby(new SyntaxError("Unexpected token at position 7"))).toBe("neplatný JSON, pozice 7");
    expect(mistoChyby(new SyntaxError("cokoli s acme"))).toBe("neplatný JSON");
    expect(mistoChyby(new Error("EACCES acme"))).toBe("chyba čtení (Error)");
  });

  it("platný soubor a proměnná prostředí se sloučí, malá písmena, bez duplicit; vlastní instance z instances/", () => {
    const d = koren(JSON.stringify({ sentinels: ["Acme-Corp", "globex"] }));
    expect(loadTenantSentinels(d, { AISHA_TENANT_SENTINELS: "globex, initech" }).sort()).toEqual(["acme-corp", "globex", "initech"]);
    mkdirSync(path.join(d, "instances/_default"), { recursive: true });
    mkdirSync(path.join(d, "instances/acme"), { recursive: true });
    expect(ownTenantIds(d)).toEqual(["acme"]);
  });
});
