/**
 * Stroj NAVRHUJE, člověk ZAPÍNÁ (CLASS gate)
 *
 * ⭐ ROZHODNUTÍ MAJITELE 2026-09-04: „spíš bych byl pro to, aby to službě mohl
 * uživatel povolit a následně schválit … systémové pluginy by mohly stačit
 * u servisních rolí."
 *
 * ⛔ CO TOMU PŘEDCHÁZELO. `submit_plugin` vyžadoval `auth.uid()`, protože je to
 * model PODÁNÍ: někdo nabízí, někdo schvaluje. U pluginů, které přicházejí
 * S PLATFORMOU, ale žádný „někdo" není — a vynucený uživatel znamenal, že heslo
 * bootstrap účtu muselo ležet v `docker-compose.coolify.yml`. Rohatka
 * `build-time-mnozina` to právem odmítla (62 tajemství proti stropu 60).
 *
 * ⭐ Rohatka nebyla překážka, byl to SIGNÁL O ŠPATNÉM NÁVRHU: chyba nebyla
 * v bráně, ale v tom, že se stroj vydával za člověka. Když stroj jen NAVRHNE
 * a člověk ZAPNE, heslo v compose není potřeba vůbec.
 *
 * TAHLE BRÁNA HLÍDÁ TU HRANICI. Servisní role smí podat, ale:
 *   · `trust_tier` je natvrdo `internal` — NIKDY z manifestu. Kdyby se četl
 *     z manifestu, stroj by si sám přidělil `partner` nebo `external`, tedy
 *     důvěru, kterou má vydávat člověk.
 *   · `status` se NENASTAVUJE — platí výchozí `submitted`. Podání není aktivace.
 *   · autor zůstává NULL — strojové podání nemá autora a nesmí předstírat, že má.
 *   · aktivace vede přes `transition_plugin_status`, které vyžaduje admina.
 *
 * ⛔ Bez téhle brány by stačilo jedno „zjednodušení" v té větvi a vlastnost by
 * padla TIŠE: plugin by se zapnul sám a nikdo by si toho nevšiml, protože
 * všechno ostatní by dál fungovalo.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const cti = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");

/** Kód bez SQL komentářů — brána nesmí trestat text, který pravidlo vysvětluje. */
function bezKomentaru(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])--.*$/gm, "$1");
}

/** Tělo větve `IF public.is_service_role() … THEN … ELSIF|ELSE`. */
function vetevServisniRole(sql: string): string {
  const i = sql.indexOf("IF public.is_service_role()");
  if (i < 0) return "";
  const zbytek = sql.slice(i);
  const konec = zbytek.search(/\n\s*(ELSIF|ELSE|END IF)/);
  return konec >= 0 ? zbytek.slice(0, konec) : zbytek;
}

const submit = cti("aisha/db/sql/functions/submit_plugin.sql");
const transition = cti("aisha/db/sql/functions/transition_plugin_status.sql");

describe("stroj navrhuje, člověk zapíná", () => {
  test("obě funkce existují — jinak brána měří prázdno", () => {
    expect(submit.length, "submit_plugin.sql nenalezen").toBeGreaterThan(0);
    expect(transition.length, "transition_plugin_status.sql nenalezen").toBeGreaterThan(0);
  });

  test("servisní role má v submit_plugin vlastní větev", () => {
    expect(bezKomentaru(submit)).toMatch(/IF\s+public\.is_service_role\(\)/);
  });

  test("⛔ trust_tier je v té větvi NATVRDO 'internal', nikdy z manifestu", () => {
    const vetev = bezKomentaru(vetevServisniRole(submit));
    expect(vetev, "větev servisní role se nenašla — brána by měřila vedle").not.toBe("");
    expect(vetev, "trust_tier musí být přidělen natvrdo").toMatch(/v_trust_tier\s*:=\s*'internal'/);
    expect(
      vetev,
      "větev servisní role NESMÍ číst trust_tier z manifestu — stroj by si sám " +
        "přidělil důvěru, kterou má vydávat člověk",
    ).not.toMatch(/p_manifest\s*->>\s*'trust_tier'/);
  });

  test("⛔ v té větvi se NENASTAVUJE status — podání není aktivace", () => {
    const vetev = bezKomentaru(vetevServisniRole(submit));
    expect(
      vetev,
      "status se nesmí nastavovat: platí výchozí 'submitted', do provozu vede " +
        "až transition_plugin_status",
    ).not.toMatch(/\bv_status\b|\bstatus\s*:=/);
  });

  test("⛔ strojové podání nemá autora", () => {
    const vetev = bezKomentaru(vetevServisniRole(submit));
    expect(vetev).toMatch(/v_partner_id\s*:=\s*NULL/i);
  });

  test("⛔ aktivaci hlídá člověk — transition_plugin_status žádá admina", () => {
    const t = bezKomentaru(transition);
    expect(
      t,
      "kdyby přechod stavu nevyžadoval admina, stroj by si plugin zapnul sám " +
        "a celá hranice by byla jen formalita",
    ).toMatch(/is_admin_or_staff\(\)/);
  });

  // ⭐ 2026-09-27 (rozhodnutí majitele): schválení se PŘENÁŠÍ na nový kód, když nová
  // verze nerozšiřuje oprávnění — ale jen při podání SPRÁVOU (plugin-publish-init
  // s AISHA_ADMIN_JWT). Holá servisní role dál jen navrhuje: její token drží víc
  // služeb a podvržený kód by jinak běžel bez člověka. Chování (přenos / reset /
  // důvod) měří src/tests/db/plugin-schvaleni-prenos-runtime.test.ts; tady se
  // hlídá tvar, aby „zjednodušení" nepustilo stroj.
  test("⛔ přenos schválení vyžaduje správu (v_is_admin) i důvěru internal", () => {
    const kod = bezKomentaru(submit);
    const prenos = /v_prenos\s*:=([^;]*);/.exec(kod)?.[1] ?? "";
    expect(prenos, "přiřazení v_prenos se nenašlo — brána by měřila vedle").not.toBe("");
    expect(prenos, "bez správy by schválení přenesl i stroj").toMatch(/^\s*v_is_admin\b/);
    expect(prenos).toMatch(/v_trust_tier\s*=\s*'internal'/);
    expect(prenos).toMatch(/cardinality\(v_rozsireni\)\s*=\s*0/);
    // větev servisní role v_is_admin natvrdo vypíná
    expect(bezKomentaru(vetevServisniRole(submit))).toMatch(/v_is_admin\s*:=\s*false/);
  });

  test("grant pro service_role existuje — bez něj je větev mrtvý kód", () => {
    // ⛔ NAMĚŘENO: samotná větev nestačila. `permission denied for function
    // submit_plugin` odhalil až POKUS proti živé DB; čtením kódu to vidět nebylo.
    expect(submit).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.submit_plugin[^;]*TO\s+service_role/i);
  });
});
