/**
 * Brána: viditelnost znalostí má JEDEN domov — pro VŠECHNY cesty čtení, bez vlastních výčtů
 *
 * Domovem je `public.knowledge_visibility_searchable(viditelnost, je_prihlasen, je_v_gilde)`:
 * public každému, members jen přihlášenému, guild jen gildě (G1), cokoli jiného ne.
 * Volají ho politiky tabulky (čtení napřímo), hledání v2 a v3, čtení podle id, vrstva mozku,
 * citace a graf běhu; že ho žádná cesta neobejde, drží třídní brána znalosti-viditelnost-kazda-cesta.
 *
 * Změřeno 2026-10-04/05: hledání mělo vlastní výčet ('public', 'members', 'guild') bez ohledu na
 * tazatele, politika tabulky pro anonyma a čtení podle id ('public', 'members'), takže `members`
 * šlo nepřihlášenému — proti pravidlu majitele (2026-10-04: „nepřihlášený vidí jen public“).
 * Výčty o jedné věci se rozešly; zásady a rysy navíc obcházely viditelnost výjimkou podle typu.
 *
 * Brána drží:
 *  1. tvar domova (rozbor + kotva): public každému, members jen „je přihlášen“, guild jen „je v gildě“,
 *     ELSE false;
 *  2. žádná funkce ani politika nad knowledge_items ani expert_rules nenese vlastní výčet viditelností
 *     (`ki.visibility IN (…)`, `er.visibility = '…'`) a nikde nežije dvouvstupový tvar domova; pravidla
 *     se ptají domova přes public.expert_rule_visible_to (2026-10-05, revize B1);
 *  3. „je přihlášen“ se počítá z identity toho, pro koho se čte — nikde konstanta `true`; politiky tabulky
 *     (běží právy tazatele) se ptají množiny knowledge_visibilities_for_caller() — spočítá se jednou za
 *     dotaz z identity volajícího a pravidlo nenese; „je v gildě“ má domov knowledge_audience_in_guild (G1);
 *  4. OTEVŘENÉ ROZHODNUTÍ b) interní téma se do znalostí zapisuje jako `guild` (pojmenovaný stav).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripSqlComments } from "../../../scripts/db/lib/sql-comments.mjs";

const SQL = join(process.cwd(), "aisha/db/sql");
const cti = (rel: string) => (existsSync(join(SQL, rel)) ? stripSqlComments(readFileSync(join(SQL, rel), "utf-8")) : "");
const vse = (adr: string) =>
  readdirSync(join(SQL, adr))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => [`${adr}/${f}`, cti(`${adr}/${f}`)] as const);

const DOMOV = "functions/knowledge_visibility_searchable.sql";
const NAVOD_INTERNI =
  "OTEVŘENÉ ROZHODNUTÍ b) interní téma se do znalostí zapisuje jako `guild` (sync_topic_version_to_knowledge_item, " +
  "obě místa: UPDATE i INSERT). Mění-li se mapování, změř znovu, kdo interní téma najde — po opravě z 2026-10-04 " +
  "ho najde gilda a správa, téma samo jen správa.";

const hodnoty = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

/** Aliasy knowledge_items a expert_rules v kódu (`FROM knowledge_items ki` → ki, i čárkový join a uvozovky). */
const aliasy = (sql: string) => [
  ...new Set([...sql.matchAll(/\b(?:FROM|JOIN|,)\s+(?:public\.)?"?(?:knowledge_items|expert_rules)"?\s+(?:AS\s+)?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase())),
].filter((a) => !["where", "on", "using", "join", "left", "inner", "set", "order", "group", "limit"].includes(a));

/** Vlastní výčty viditelnosti nad položkami znalostí a pravidly: `<alias>.visibility IN (…)` / `= '…'` / `<> '…'`. */
function vycty(sql: string, vPolitice: boolean): string[] {
  const kdo = vPolitice ? ["", ...aliasy(sql)] : aliasy(sql);
  const out: string[] = [];
  for (const a of kdo) {
    const pref = a ? `\\b${a}\\.` : "(?<![\\w.])";
    for (const m of sql.matchAll(new RegExp(`${pref}visibility\\s*(?:(?:NOT\\s+)?IN\\s*\\(([^)]*)\\)|(?:=|<>|!=)\\s*'([a-z_]+)')`, "gi"))) {
      out.push(m[0].replace(/\s+/g, " "));
    }
  }
  return out;
}

/** Co domov říká. Čistá funkce — měří ji i kotva. */
function rozborDomova(sql: string): { kazdemu: string[]; prihlasenym: string[]; gilde: string[] } | null {
  const kazdemu = [...sql.matchAll(/WHEN\s+p_visibility\s*=\s*'([a-z_]+)'\s+THEN\s+true\b/gi)].map((m) => m[1]);
  const prihlasenym = [...sql.matchAll(/WHEN\s+p_visibility\s*=\s*'([a-z_]+)'\s+THEN\s+COALESCE\(\s*p_signed_in\s*,\s*false\s*\)/gi)].map((m) => m[1]);
  const gilde = [...sql.matchAll(/WHEN\s+p_visibility\s*=\s*'([a-z_]+)'\s+THEN\s+COALESCE\(\s*p_in_guild\s*,\s*false\s*\)/gi)].map((m) => m[1]);
  if (!/\bELSE\s+false\b/i.test(sql) || /p_visibility\s+IN\s*\(/i.test(sql)) return null;
  if (!/\(\s*p_visibility\s+text\s*,\s*p_signed_in\s+boolean\s*,\s*p_in_guild\s+boolean\s*\)/i.test(sql)) return null;
  return { kazdemu: kazdemu.sort(), prihlasenym: prihlasenym.sort(), gilde: gilde.sort() };
}

describe("viditelnost znalostí má jeden domov — všechny cesty čtení, žádné vlastní výčty", () => {
  const domov = rozborDomova(cti(DOMOV));

  it("domov existuje, měřák mu rozumí a říká pravidlo majitele (kotva)", () => {
    expect(domov, "tvar domova: (p_visibility text, p_signed_in boolean, p_in_guild boolean), WHEN … THEN true / COALESCE(p_signed_in, false) / COALESCE(p_in_guild, false), ELSE false").not.toBeNull();
    expect(domov).toEqual({ kazdemu: ["public"], prihlasenym: ["members"], gilde: ["guild"] });
    // Kotva měřidla: výčet místo pravidla, chybějící ELSE false nebo dvouvstupový tvar domovem nejsou.
    const s3 = "(p_visibility text, p_signed_in boolean, p_in_guild boolean) SELECT CASE";
    expect(rozborDomova(`${s3} WHEN p_visibility IN ('public', 'members') THEN true ELSE false END`)).toBeNull();
    expect(rozborDomova(`${s3} WHEN p_visibility = 'public' THEN true END`)).toBeNull();
    expect(rozborDomova("(p_visibility text, p_in_guild boolean) SELECT CASE WHEN p_visibility = 'public' THEN true ELSE false END")).toBeNull();
    // `members` každému je jiné pravidlo než majitelovo — měřák ho pozná.
    expect(rozborDomova(`${s3} WHEN p_visibility = 'public' THEN true WHEN p_visibility = 'members' THEN true WHEN p_visibility = 'guild' THEN COALESCE(p_in_guild, false) ELSE false END`)).toEqual({
      kazdemu: ["members", "public"],
      prihlasenym: [],
      gilde: ["guild"],
    });
  });

  it("žádná funkce nad knowledge_items ani expert_rules nenese vlastní výčet viditelností", () => {
    const sVyctem = vse("functions")
      .filter(([f]) => f !== DOMOV)
      .map(([f, sql]) => [f, vycty(sql, false)] as const)
      .filter(([, v]) => v.length > 0);
    expect(sVyctem, "funkce s vlastním výčtem viditelností nad knowledge_items / expert_rules — volej public.knowledge_visibility_searchable (pravidla přes public.expert_rule_visible_to)").toEqual([]);
    // Kotva měřidla: výčet pozná u kteréhokoli aliasu (i u pravidel — vedle pomocníka by výčet s OR rozšířil, co pomocník povolí),
    // volání domova ani cizí tabulku (knowledge_topics má vlastní štítky) za výčet nepovažuje.
    expect(vycty("SELECT 1 FROM public.knowledge_items ki WHERE ki.visibility IN ('public', 'members')", false)).toHaveLength(1);
    expect(vycty("SELECT 1 FROM knowledge_items k2 WHERE k2.visibility = 'public'", false)).toHaveLength(1);
    expect(vycty("SELECT 1 FROM public.knowledge_items ki WHERE public.knowledge_visibility_searchable(ki.visibility, true, false)", false)).toEqual([]);
    expect(vycty("SELECT 1 FROM public.expert_rules er WHERE public.expert_rule_visible_to(er.visibility, er.author_partner_id, auth.uid()) OR er.visibility = 'members'", false)).toHaveLength(1);
    expect(vycty("SELECT 1 FROM public.partner_profiles pp, \"expert_rules\" er WHERE er.visibility IN ('public')", false)).toHaveLength(1);
    expect(vycty("SELECT 1 FROM public.knowledge_topics kt WHERE kt.visibility = 'public'", false)).toEqual([]);
  });

  it("žádná politika nad knowledge_items ani expert_rules nenese vlastní výčet viditelností", () => {
    const sVyctem = vse("policies")
      .filter(([, sql]) => /\bON\s+(?:public\.)?(?:knowledge_items|expert_rules)\b/i.test(sql))
      .map(([f, sql]) => [f, vycty(sql, true)] as const)
      .filter(([, v]) => v.length > 0);
    expect(sVyctem, "politika knowledge_items / expert_rules s vlastním výčtem — ptej se množiny public.knowledge_visibilities_for_caller()").toEqual([]);
    expect(vycty("CREATE POLICY x ON public.knowledge_items FOR SELECT TO anon USING (visibility IN ('public'))", true)).toHaveLength(1);
  });

  it("dvouvstupový tvar domova nikde nežije a „je přihlášen“ se počítá z identity, nikde konstanta true", () => {
    const volani: Array<[string, string]> = [];
    for (const [f, sql] of [...vse("functions"), ...vse("policies")]) {
      if (f === DOMOV) continue;
      // Závorky se párují ručně: argument politiky nese poddotazy hlouběji, než unese regulární výraz.
      for (const m of sql.matchAll(/public\.knowledge_visibility_searchable\s*\(/gi)) {
        let i = (m.index ?? 0) + m[0].length;
        let hloubka = 1;
        const zacatek = i;
        while (i < sql.length && hloubka > 0) {
          if (sql[i] === "(") hloubka++;
          else if (sql[i] === ")") hloubka--;
          i++;
        }
        volani.push([f, sql.slice(zacatek, i - 1)]);
      }
    }
    expect(volani.length, "měřák nenašel žádné volání domova").toBeGreaterThanOrEqual(10);
    const argumenty = (a: string) => {
      const out: string[] = [];
      let hloubka = 0;
      let cur = "";
      for (const c of a) {
        if (c === "(") hloubka++;
        if (c === ")") hloubka--;
        if (c === "," && hloubka === 0) {
          out.push(cur.trim());
          cur = "";
        } else cur += c;
      }
      out.push(cur.trim());
      return out;
    };
    const vady = volani
      .map(([f, a]) => [f, argumenty(a)] as const)
      .filter(([, a]) => a.length !== 3 || /^true$/i.test(a[1]) || !(/IS\s+NOT\s+NULL\s*$/i.test(a[1]) || /^false$/i.test(a[1])))
      .map(([f, a]) => `${f}: (${a.join(", ")})`);
    expect(vady, "domov se volá třemi vstupy; „je přihlášen“ = `<identita> IS NOT NULL` (u anonyma konstanta false)").toEqual([]);
  });

  it("politiky tabulek se ptají množiny štítků pro VOLAJÍCÍHO; ta se ptá domova na štítky, které domov povolí", () => {
    const mnozina = cti("functions/knowledge_visibilities_for_caller.sql");
    expect(mnozina, "functions/knowledge_visibilities_for_caller.sql chybí").not.toBe("");
    // Bez parametru: za nikoho jiného se zeptat nejde; identita = volající.
    expect(mnozina).toMatch(/FUNCTION\s+public\.knowledge_visibilities_for_caller\s*\(\s*\)/i);
    expect(
      mnozina,
      "množina se ptá domova s identitou volajícího: auth.uid() IS NOT NULL a gilda z public.knowledge_audience_in_guild(auth.uid())",
    ).toMatch(/public\.knowledge_visibility_searchable\(\s*v\s*,\s*auth\.uid\(\)\s+IS\s+NOT\s+NULL\s*,\s*public\.knowledge_audience_in_guild\(\s*auth\.uid\(\)\s*\)\s*\)/i);
    expect(/WHEN\s+p_visibility/i.test(mnozina), "pravidlo (WHEN p_visibility …) patří jen do domova").toBe(false);
    // Kandidáti = přesně štítky, které domov kdy povolí (jinak by napřímo někdo něco neviděl / viděl navíc).
    const kandidati = hodnoty(/unnest\(\s*ARRAY\[([^\]]*)\]/i.exec(mnozina)?.[1] ?? "").sort();
    expect(kandidati, "kandidáti množiny ≠ štítky domova").toEqual([...domov!.kazdemu, ...domov!.prihlasenym, ...domov!.gilde].sort());
    // Domov sám rolím API vydaný NENÍ (vkládá se do dotazů definer funkcí); množina ano (volají ji politiky).
    expect(cti(DOMOV)).not.toMatch(/GRANT\s+EXECUTE[^;]*\bTO\s+[^;]*\b(anon|authenticated)\b/i);
    expect(mnozina).toMatch(/GRANT\s+EXECUTE[^;]*\bTO\s+anon\b/i);
    for (const pol of ["policies/knowledge_items_global_anon_read.sql", "policies/knowledge_items_global_authenticated_read.sql"]) {
      expect(cti(pol), `${pol}: ptá se množiny štítků jednou za dotaz`).toMatch(/visibility\s*=\s*ANY\s*\(\s*\(\s*SELECT\s+public\.knowledge_visibilities_for_caller\(\)\s*\)\s*::\s*text\[\]\s*\)/i);
    }
  });

  it("„je v gildě“ má jeden domov: G1 (schválený konzultant studie + certifikace od správy), nic samoobslužného", () => {
    const gilda = cti("functions/knowledge_audience_in_guild.sql");
    expect(gilda, "functions/knowledge_audience_in_guild.sql chybí").not.toBe("");
    expect(gilda, "přijetí: study_consultants.status = 'approved'").toMatch(/study_consultants\s+sc\s+ON\s+sc\.partner_id\s*=\s*pp\.id\s+AND\s+sc\.status\s*=\s*'approved'/i);
    expect(gilda, "testy: partner_profiles.is_certified (řídí správa)").toMatch(/pp\.is_certified\s+IS\s+TRUE/i);
    // Samoobslužná pole (vlastník je přepíše) gildu určovat nesmějí.
    expect(gilda).not.toMatch(/guild_tier|certification_passed_at/i);
    expect(gilda).not.toMatch(/GRANT\s+EXECUTE[^;]*\bTO\s+[^;]*\b(anon|authenticated)\b/i);
    // Nikdo jiný gildu nepočítá vlastním EXISTS nad partner_profiles.
    const vlastniGilda = vse("functions")
      .filter(([f]) => f !== "functions/knowledge_audience_in_guild.sql")
      .filter(([, sql]) => /v_in_guild\s*(?:boolean\s*)?:=\s*EXISTS/i.test(sql))
      .map(([f]) => f);
    expect(vlastniGilda, "v_in_guild se počítá jen přes public.knowledge_audience_in_guild").toEqual([]);
  });

  it("OTEVŘENÉ ROZHODNUTÍ b) interní téma se do znalostí zapisuje jako `guild`", () => {
    const mapovani = cti("functions/sync_topic_version_to_knowledge_item.sql").match(/WHEN\s+'internal'\s+THEN\s+'guild'/gi) ?? [];
    expect(mapovani.length, NAVOD_INTERNI).toBe(2);
  });

  it("expertní pravidla mají týž domov: pomocník čtenářů se ptá domova a nenese vlastní pravidlo (srovnávací kotva)", () => {
    const pom = cti("functions/expert_rule_visible_to.sql");
    expect(pom, "functions/expert_rule_visible_to.sql chybí").not.toBe("");
    expect(pom, "pomocník pravidel se ptá domova s identitou publika a gildou z domova gildy").toMatch(
      /public\.knowledge_visibility_searchable\(\s*p_visibility\s*,\s*p_audience_user_id\s+IS\s+NOT\s+NULL\s*,\s*public\.knowledge_audience_in_guild\(\s*p_audience_user_id\s*\)\s*\)/i,
    );
    expect(/WHEN\s+p_visibility|visibility\s+IN\s*\(/i.test(pom), "pravidlo patří jen do domova").toBe(false);
    expect(pom).not.toMatch(/GRANT\s+EXECUTE[^;]*\bTO\s+[^;]*\b(anon|authenticated)\b/i);
    // Seznam pravidel (web) se ptá pomocníka za volajícího — dřív tu stál vlastní výčet s vlastní gildou.
    expect(cti("functions/get_expert_rules.sql")).toMatch(/public\.expert_rule_visible_to\(\s*er\.visibility\s*,\s*er\.author_partner_id\s*,\s*auth\.uid\(\)\s*\)/i);
  });
});
