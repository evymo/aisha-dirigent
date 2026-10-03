// ⛔ SONDA NA CIZÍ NÁLEZ. Tahle vada se pozná jen při souběhu, a souběh se
// v testu neobjedná — dá se ale objednat to, co ho dělá: DVA různé běhy.
// Když dva běhy téhož kroku dostanou tutéž cestu, je vada zpátky.
import { describe, expect, test } from "vitest";
import { BEH_ID, cestaArtefaktuBehu, nazevKroku } from "./cesta-artefaktu-behu.mjs";

describe("artefakt selhání patří svému běhu", () => {
  test("dva běhy téhož kroku si nemohou přepsat výpis", () => {
    const a = cestaArtefaktuBehu("/tmp/zaklad", "npm run test:gates", "2026-09-20T18-00-00-000Z-111");
    const b = cestaArtefaktuBehu("/tmp/zaklad", "npm run test:gates", "2026-09-20T18-00-00-000Z-222");
    expect(a.soubor).not.toBe(b.soubor);
    // A co je důležitější než nerovnost: v cestě musí být IDENTITA BĚHU,
    // jinak by se shoda dala „opravit" čímkoli náhodným.
    expect(a.soubor).toContain("111");
    expect(b.soubor).toContain("222");
  });

  test("dva kroky téhož běhu bydlí spolu — je to jeden nález, ne dva", () => {
    const beh = "2026-09-20T18-00-00-000Z-333";
    const gates = cestaArtefaktuBehu("/tmp/zaklad", "npm run test:gates", beh);
    const unit = cestaArtefaktuBehu("/tmp/zaklad", "npm run test:run", beh);
    expect(gates.adresar).toBe(unit.adresar);
    expect(gates.soubor).not.toBe(unit.soubor);
  });

  test("jméno kroku se nesmí rozlézt do cesty", () => {
    // ⛔ VZOREK JE ZLOMYSLNÝ TVAREM, NE OBSAHEM. První verze tu měla doslovný
    // `rm -rf /` — a skener destruktivních operací (scripts/audit/destructive-ops-survey.mjs)
    // ho započítal jako NOVOU destruktivní operaci v repu (baseline 13 → 14).
    // Měl pravdu: čte text, ne úmysl. Sanitizace cesty se dá ověřit stejně
    // dobře na znacích, které nic neznamenají.
    const { soubor } = cestaArtefaktuBehu("/tmp/zaklad", "../../etc/passwd ; nic-takoveho", "beh");
    expect(soubor).not.toContain("..");
    expect(soubor).not.toContain(";");
    expect(soubor.endsWith(".log")).toBe(true);
    expect(nazevKroku("")).toBe("krok"); // prázdné jméno není prázdná cesta
  });

  test("identita běhu je stálá po celý proces", () => {
    // Kdyby se počítala při každém volání, rozpadl by se jeden nález do dvou
    // adresářů — a obsluha by hledala druhou polovinu.
    expect(cestaArtefaktuBehu("/z", "krok A").adresar).toBe(cestaArtefaktuBehu("/z", "krok B").adresar);
    expect(BEH_ID).toContain(String(process.pid));
  });
});
