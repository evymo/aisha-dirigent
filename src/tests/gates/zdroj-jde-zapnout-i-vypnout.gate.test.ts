import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Zapnout a vypnout musí jít OBOJE — a tajemství nesmí mít cestu ven.
 *
 * ⛔ PROČ EXISTUJE
 * Naměřeno 2026-09-01: jediný UPDATE nad `agent_knowledge_sources` v celém SoT
 * byl `is_active = false`. Vypínací funkce byla hotová a auditovaná, zapínací
 * neexistovala — systém uměl bezpečně říct „ne" a neuměl říct „ano". Zdroj
 * `money` proto stál neaktivní a broker každou minutu hlásil, že čeká na
 * rozhodnutí člověka, který neměl čím rozhodnout.
 *
 * ⭐ MĚŘÍ SE SYMETRIE, NE PŘÍTOMNOST. Že soubor existuje, neříká nic; že
 * existuje protějšek a že OBA jsou dosažitelné z `heals.sql`, říká všechno —
 * SoT bez `\ir` se na běžící databázi nikdy nepřehraje.
 *
 * ⚠️ Brána NEMĚŘÍ, že šifrování je správné (to je věc `aisha_encrypt_column_*`
 * a jeho vlastní brány). Měří, že k šifrovaným řádkům NEVEDE povolující policy
 * — tedy že „nikdo" je opravdu nikdo, ne „skoro nikdo".
 */
const ROOT = join(__dirname, "../../..");
const SQL = join(ROOT, "aisha/db/sql");
const HEALS = readFileSync(join(ROOT, "aisha/db/heals.sql"), "utf8");

const cti = (rel: string) => readFileSync(join(SQL, rel), "utf8");

describe("zdroj dat: zapnout i vypnout, pověření bez cesty ven", () => {
  it("k vypnutí existuje protějšek a oba jsou zapojené v heals", () => {
    for (const jmeno of ["activate_data_source", "deactivate_data_source"]) {
      const rel = `functions/${jmeno}.sql`;
      expect(existsSync(join(SQL, rel)), `chybí SoT soubor ${rel}`).toBe(true);
      expect(
        HEALS.includes(`\\ir sql/${rel}`),
        `${jmeno} NENÍ v heals.sql — na běžící databázi se nikdy nepřehraje`,
      ).toBe(true);
    }
  });

  it("aktivace se ptá schématu pluginu, nespoléhá na ruční výčet", () => {
    const src = cti("functions/activate_data_source.sql");
    // Požadavek se odvozuje z `required` ∩ `secret` — kdyby tu byl výčet klíčů,
    // byl by to druhý udržovaný seznam, který se tiše rozejde s pluginem.
    expect(src).toMatch(/config_schema/);
    expect(src).toMatch(/'required'/);
    expect(src).toMatch(/->>'secret'/);
    expect(
      src,
      "aktivace musí odmítnout zapnutí, dokud chybí povinná pověření",
    ).toMatch(/RAISE EXCEPTION[^;]*chybí pověření/);
  });

  it("nad tabulkou pověření je RLS a ŽÁDNÁ povolující policy", () => {
    const rls = cti("rls/agent_knowledge_source_secrets.sql");
    expect(rls).toMatch(/ENABLE ROW LEVEL SECURITY/);

    const policies = readdirSync(join(SQL, "policies")).filter((f) =>
      f.startsWith("agent_knowledge_source_secrets"),
    );
    expect(
      policies,
      `Tabulka s pověřeními má policy — tím vzniká cesta, kterou lze šifrotext\n` +
        `vytáhnout ven. Přístup má mít jen SECURITY DEFINER funkce:\n  ${policies.join("\n  ")}`,
    ).toEqual([]);
  });

  it("do žurnálu jdou jména klíčů, ne hodnoty", () => {
    const src = cti("functions/set_data_source_secrets.sql");
    expect(src).toMatch(/jsonb_object_keys\(p_secrets\)/);
    // Hodnota se do metadat nesmí dostat ani oklikou přes celý vstup.
    expect(
      /audit_journal[\s\S]{0,600}'secrets',\s*p_secrets/.test(src),
      "audit nesmí nést celý vstup — jsou v něm hodnoty",
    ).toBe(false);
  });
});
