/**
 * Brána: klasifikace zdroje se vynucuje PODLE KONTRAKTU, ne podle dokumentu
 *
 * ⛔ PROČ TAHLE BRÁNA VZNIKLA. Kontrakt `docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md`
 * §1 předepisuje čtyři dimenze — `source_type`, `data_sensitivity`,
 * `retention_class`, `legal_basis` — a §3 vlastníka. Aktivační závora v DB ale
 * vyžadovala `data_sensitivity`, `legal_basis`, `owner`, `retention`. Rozpor
 * přežil, protože jeho vynucovací brána (`enterprise-source-hosting`) měří JEN
 * TO, ŽE DOKUMENT OBSAHUJE SEKCE — všech 12 testů je tvaru „contract defines
 * all 4 classification dimensions“, tedy tvrzení o próze, ne o kódu. Naměřeno
 * 2026-09-20; rozpor by nikdo nenašel, dokud by se někdo nepokusil zdroj
 * zapnout podle kontraktu (a nešlo by to) nebo podle závory (a prošel by bez
 * `source_type`, tedy bez dimenze, podle které §4 rozhoduje o souhlasu a DPA).
 *
 * Tahle brána proto měří VLASTNOST: co kontrakt předepisuje, to závora vynutí,
 * a co závora vynutí, to kontrakt předepisuje. Statická část porovnává obě
 * strany jako MNOŽINY, takže rozejití kterékoli strany spadne — přidání
 * dimenze do kontraktu bez závory i naopak.
 *
 * Mutace je součástí měření: každá kontrola má dvojče, které si vlastnost
 * úmyslně rozbije a vyžaduje, aby detekce zčervenala. Bez toho je to test,
 * který prochází, ne test, který měří.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const KONTRAKT = path.join(ROOT, "docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md");
const TABULKA = path.join(ROOT, "aisha/db/sql/tables/agent_knowledge_sources.sql");
const HEALS = path.join(ROOT, "aisha/db/heals.sql");

const kontrakt = readFileSync(KONTRAKT, "utf8");
const tabulka = readFileSync(TABULKA, "utf8");
const heals = readFileSync(HEALS, "utf8");

/** Dimenze, které kontrakt §1 vypisuje v tabulce „Povinná klasifikace zdroje". */
function dimenzeZKontraktu(text: string): string[] {
  const sekce = text.slice(text.indexOf("## 1."), text.indexOf("## 2."));
  return [...sekce.matchAll(/\*\*([a-z_]+)\*\*/g)].map((m) => m[1]).sort();
}

/** Klíče, které aktivační závora vyžaduje (`config ? 'klic'`). */
function klicePozadovaneZavorou(sql: string): string[] {
  const blok = sql.slice(sql.indexOf("agent_knowledge_sources_activation_guard"));
  const konec = blok.indexOf("))");
  return [...blok.slice(0, konec).matchAll(/config \? '([a-z_]+)'/g)].map((m) => m[1]).sort();
}

/** Povolené hodnoty dimenze podle CHECKu v SoT. */
function povoleneHodnoty(sql: string, dimenze: string): string[] {
  const re = new RegExp(`config->>'${dimenze}' IN \\(([^)]+)\\)`);
  const m = sql.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
}

/** Hodnoty, které pro dimenzi vypisuje kontrakt (buňka `a` \| `b` \| `c`). */
function hodnotyZKontraktu(text: string, dimenze: string): string[] {
  const radek = text.split("\n").find((l) => l.includes(`**${dimenze}**`));
  if (!radek) return [];
  return [...radek.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).sort();
}

describe("klasifikace zdroje: kontrakt a závora měří totéž", () => {
  it("dimenze z kontraktu §1 a klíče aktivační závory jsou TÁŽ MNOŽINA (+ owner z §3)", () => {
    const kontraktDimenze = dimenzeZKontraktu(kontrakt);
    const zavora = klicePozadovaneZavorou(tabulka);
    // §3 dělá vlastníka povinným, ale není to dimenze z tabulky §1 — proto zvlášť.
    expect(zavora).toEqual([...kontraktDimenze, "owner"].sort());
  });

  it("MUTACE: dimenze, kterou závora nevyžaduje, spadne", () => {
    const rozbite = tabulka.replace("config ? 'source_type' AND ", "");
    expect(klicePozadovaneZavorou(rozbite)).not.toContain("source_type");
    expect(klicePozadovaneZavorou(rozbite)).not.toEqual(
      [...dimenzeZKontraktu(kontrakt), "owner"].sort(),
    );
  });

  it.each(["source_type", "data_sensitivity", "retention_class", "legal_basis"])(
    "%s má v SoT hodnotový CHECK se TÝMIŽ hodnotami jako kontrakt",
    (dimenze) => {
      const vSoT = povoleneHodnoty(tabulka, dimenze);
      expect(vSoT.length, `${dimenze} nemá v SoT hodnotový CHECK — volný text v klasifikaci`).toBeGreaterThan(0);
      expect(vSoT).toEqual(hodnotyZKontraktu(kontrakt, dimenze));
    },
  );

  it("MUTACE: přidaná hodnota mimo kontrakt se pozná", () => {
    const rozbite = tabulka.replace(
      "config->>'source_type' IN ('internal','partner','external','user_provided')",
      "config->>'source_type' IN ('internal','partner','external','user_provided','vymyslene')",
    );
    expect(povoleneHodnoty(rozbite, "source_type")).not.toEqual(
      hodnotyZKontraktu(kontrakt, "source_type"),
    );
  });

  // ⛔ Bez tohohle by oprava dosedla jen na čerstvou DB: soubor tabulky je
  // `CREATE TABLE IF NOT EXISTS`, takže na existující databázi neudělá nic.
  it("závora doteče i na BĚŽÍCÍ databázi — heals ji konverguje", () => {
    for (const c of [
      "agent_knowledge_sources_activation_guard",
      "agent_knowledge_sources_source_type_valid",
      "agent_knowledge_sources_retention_class_valid",
      "agent_knowledge_sources_legal_basis_valid",
    ]) {
      expect(heals, `${c} chybí v heals → na běžící DB se nepřehraje`).toContain(
        `DROP CONSTRAINT IF EXISTS ${c}`,
      );
      expect(heals).toContain(`ADD CONSTRAINT ${c}`);
    }
  });

  it("konvergence v heals je idempotentní (ADD vždy po DROP IF EXISTS)", () => {
    const usek = heals.slice(heals.indexOf("Klasifikace zdroje: závora srovnaná"));
    const poradi = [...usek.matchAll(/(DROP CONSTRAINT IF EXISTS|ADD CONSTRAINT) (agent_knowledge_sources_[a-z_]+)/g)];
    for (let i = 0; i < poradi.length; i += 2) {
      expect(poradi[i][1]).toBe("DROP CONSTRAINT IF EXISTS");
      expect(poradi[i + 1]?.[1]).toBe("ADD CONSTRAINT");
      expect(poradi[i + 1]?.[2]).toBe(poradi[i][2]);
    }
  });

  // Evidenční vrstva: citlivost dokumentu se DĚDÍ ze zdroje. Kdyby ji posílal
  // volající, klasifikace zdroje by přestala být pravdou o datech pod ním.
  it("registrace dokumentu dědí citlivost ze zdroje a vyžaduje AKTIVNÍ zdroj", () => {
    const rpc = readFileSync(
      path.join(ROOT, "aisha/db/sql/functions/register_source_document_audited.sql"),
      "utf8",
    );
    expect(rpc).toMatch(/INHERITED from the source classification|dědí/i);
    expect(rpc).toMatch(/is_active/);
    expect(rpc).not.toMatch(/p_data_sensitivity|p_sensitivity/);
  });
});
