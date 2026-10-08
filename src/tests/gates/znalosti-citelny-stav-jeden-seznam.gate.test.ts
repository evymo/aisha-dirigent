/**
 * Brána: výčet čitelných stavů znalosti je JEDEN — funkce a politiky tabulky se shodují
 *
 * Domovem pravidla je `public.knowledge_state_readable` (allowlist: které stavy smí
 * čtení vydat). Funkce, které obsah vydávají, ji volají — běží právy vlastníka. Politiky
 * tabulky `knowledge_items` se ale vyhodnocují právy TAZATELE a rolím API se funkce
 * nevydává (anonymem volatelná funkce bez práv vlastníka by porušila bránu security;
 * s právy vlastníka by ji plánovač nevložil do dotazu a volala by se na každém řádku).
 * Politiky proto nesou týž výčet doslova — a tahle brána drží obě místa u sebe.
 *
 * Hlídá tři věci:
 *  1. výčet v politice je shodný s výčtem ve funkci;
 *  2. KAŽDÁ politika, která dává čtení anonymovi nebo přihlášenému, výčet nese —
 *     kromě vyjmenovaných s důvodem. Nová politika bez podmínky stavu se s ostatními
 *     sečte (PERMISSIVE = OR) a karanténu obejde celou;
 *  3. politika nepoužije denylist a nevolá funkci, kterou tazatel nesmí spustit.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripSqlComments } from "../../../scripts/db/lib/sql-comments.mjs";

const ROOT = process.cwd();
const FUNKCE = join(ROOT, "aisha/db/sql/functions/knowledge_state_readable.sql");
const POLITIKY = join(ROOT, "aisha/db/sql/policies");

/** Politiky čtení, které stav ZÁMĚRNĚ nefiltrují — jméno politiky → proč. */
const BEZ_FILTRU_STAVU: Record<string, string> = {
  knowledge_items_story_participants_read:
    "vlastník a účastník vidí svou položku příběhu i v karanténě — jinak neví, že ji má, a nemá ji kdo posoudit",
  knowledge_items_admin_read: "správa čte všechny položky, i v karanténě — posuzuje je",
};

type Politika = { soubor: string; jmeno: string; cteni: boolean; role: string[]; sql: string };

const vycty = (sql: string): string[][] =>
  [...sql.matchAll(/\b(?:p_state|quarantine_status)\s+IN\s*\(([^)]*)\)/gi)].map((m) =>
    m[1].split(",").map((x) => x.trim().replace(/^'|'$/g, "")).sort(),
  );

/** Politiky nad `knowledge_items` v textu jednoho souboru (už bez komentářů). */
function politikyZ(soubor: string, sql: string): Politika[] {
  const out: Politika[] = [];
  const re = /CREATE\s+POLICY\s+"?([^"\n]+?)"?\s+ON\s+public\.knowledge_items\b([\s\S]*?);/gi;
  for (const m of sql.matchAll(re)) {
    const telo = m[2];
    const pro = /\bFOR\s+(SELECT|ALL|INSERT|UPDATE|DELETE)\b/i.exec(telo)?.[1].toUpperCase() ?? "ALL";
    const komu = /\bTO\s+([a-z_,\s"]+?)\s*(?:USING|WITH\s+CHECK)\b/i.exec(telo)?.[1] ?? "public";
    out.push({
      soubor,
      jmeno: m[1].trim(),
      cteni: pro === "SELECT" || pro === "ALL",
      role: komu.split(",").map((r) => r.trim().replace(/"/g, "").toLowerCase()).filter(Boolean),
      sql: telo,
    });
  }
  return out;
}

/** Odchylky politik od domova výčtu. Čistá funkce — brána i její kotva měří touž. */
function vadyPolitik(domov: string[], politiky: Politika[], vyjimky: Record<string, string>): string[] {
  const vady: string[] = [];
  const proApi = (p: Politika) => p.cteni && p.role.some((r) => r === "anon" || r === "authenticated" || r === "public");
  for (const p of politiky.filter(proApi)) {
    const v = vycty(p.sql);
    if (/quarantine_status\s+NOT\s+IN|quarantine_status\s*(<>|!=)/i.test(p.sql)) vady.push(`${p.jmeno}: stav filtruje denylistem — neznámý stav projde`);
    if (/knowledge_state_readable\s*\(/i.test(p.sql)) vady.push(`${p.jmeno}: volá funkci, kterou tazatel nesmí spustit — dotaz skončí chybou místo predikátu`);
    for (const x of v) {
      if (JSON.stringify(x) !== JSON.stringify(domov)) vady.push(`${p.jmeno}: výčet [${x.join(", ")}] se liší od domova [${domov.join(", ")}]`);
    }
    if (v.length === 0 && !(p.jmeno in vyjimky)) vady.push(`${p.jmeno}: dává čtení roli API bez podmínky čitelného stavu — sečte se s ostatními a karanténu obejde`);
    if (v.length > 0 && p.jmeno in vyjimky) vady.push(`${p.jmeno}: je ve výjimkách, ale výčet nese — výjimku smaž`);
  }
  return vady;
}

describe("čitelný stav znalosti: funkce a politiky tabulky nesou týž výčet", () => {
  const domov = vycty(stripSqlComments(readFileSync(FUNKCE, "utf-8")));
  const politiky = readdirSync(POLITIKY)
    .filter((f) => f.endsWith(".sql"))
    .flatMap((f) => politikyZ(f, stripSqlComments(readFileSync(join(POLITIKY, f), "utf-8"))));

  it("domov výčtu existuje a je to allowlist (kotva)", () => {
    expect(domov, "funkce má nést právě jeden výčet `p_state IN (…)`").toHaveLength(1);
    expect(domov[0].length).toBeGreaterThan(0);
    expect(domov[0]).not.toContain("quarantined");
    expect(domov[0]).not.toContain("flagged");
  });

  it("měřák vidí politiky tabulky znalostí a role, kterým dávají čtení (kotva)", () => {
    const anon = politiky.filter((p) => p.cteni && p.role.includes("anon")).map((p) => p.jmeno);
    const prihlaseny = politiky.filter((p) => p.cteni && p.role.includes("authenticated")).map((p) => p.jmeno);
    expect(anon.length, "žádná politika čtení pro anonyma — měřák nevidí, co má").toBeGreaterThanOrEqual(1);
    expect(prihlaseny.length).toBeGreaterThanOrEqual(2);
    for (const j of Object.keys(BEZ_FILTRU_STAVU)) {
      expect(politiky.map((p) => p.jmeno), `výjimka ${j} neodpovídá žádné politice — smaž ji`).toContain(j);
    }
  });

  it("kotva měřidla: úmyslně rozdílný výčet, politika bez stavu, denylist i volání funkce jsou nález", () => {
    const d = ["clear", "reinstated", "reviewed"];
    const p = (jmeno: string, using: string, role = "authenticated"): Politika => ({ soubor: "vzorek.sql", jmeno, cteni: true, role: [role], sql: ` FOR SELECT TO ${role} USING (${using})` });
    expect(vadyPolitik(d, [p("shodna", "quarantine_status IN ('clear', 'reviewed', 'reinstated')")], {})).toEqual([]);
    expect(vadyPolitik(d, [p("rozdilna", "quarantine_status IN ('clear', 'flagged')")], {})).toHaveLength(1);
    expect(vadyPolitik(d, [p("bez_stavu", "status = 'active'", "anon")], {})).toHaveLength(1);
    expect(vadyPolitik(d, [p("bez_stavu", "status = 'active'")], { bez_stavu: "důvod" })).toEqual([]);
    expect(vadyPolitik(d, [p("denylist", "quarantine_status NOT IN ('flagged')")], {}).length).toBeGreaterThanOrEqual(1);
    expect(vadyPolitik(d, [p("vola", "public.knowledge_state_readable(quarantine_status)")], {}).length).toBeGreaterThanOrEqual(1);
    // Politika jen pro zápis nebo jen pro service_role se neměří.
    expect(vadyPolitik(d, [{ ...p("zapis", "true"), cteni: false }, p("sluzba", "true", "service_role")], {})).toEqual([]);
  });

  it("politiky tabulky: výčet shodný s domovem a žádné čtení pro roli API bez podmínky stavu", () => {
    expect(
      vadyPolitik(domov[0], politiky, BEZ_FILTRU_STAVU),
      "Politika čtení nad knowledge_items musí nést výčet čitelných stavů shodný s public.knowledge_state_readable, " +
        "nebo být ve výjimkách BEZ_FILTRU_STAVU s důvodem.",
    ).toEqual([]);
  });
});
