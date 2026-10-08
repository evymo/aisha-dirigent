/**
 * Seed znalostí ze zkušenosti (41_aisha_knowledge_from_experience.sql) na skutečné DB.
 *
 * Statická brána (knowledge-seed-from-sources) ví, že seed odpovídá zdrojům. Tenhle
 * test měří, co seed udělá s DATABÁZÍ:
 *   · každá zařazená položka je v DB právě jednou, ve výchozím příběhu (story_id NULL),
 *     public, active, ve vyhrazeném zdroji platform_knowledge, s id = md5('ki-' || slug);
 *   · nepřihlášený (anon) ji najde přes mcp_search_knowledge_v2 — globální KB;
 *   · dvojí aplikace nic nezdvojí ani nezvedne verzi (seed běží při KAŽDÉM nasazení);
 *   · oprava položky do EXISTUJÍCÍ DB dorazí (upsert s verzí, ne DO NOTHING) — i pod
 *     rolí service_role, pod kterou aplikuje SQL datová cesta instance;
 *   · KONSTRUKCE: kdo smí založit položku se slugem, seed neshodí — položka příběhu se
 *     stejným slugem leží vedle naší a seed projde; vyhrazený zdroj koncový uživatel
 *     nezapíše ani přes definer RPC, a čtení (počítadlo použití) přitom funguje;
 *   · stav, který vznikne jen ručním zásahem pod superuživatelem, seed odmítne nahlas.
 *
 *   · vyhrazený typ nezapíše ani služba přes API (story-sync importuje balíček pod service
 *     klíčem): import balíčku s vyhrazeným typem je odmítnutý s příčinou, 0 řádků;
 *   · změna obsahu vrací položku ke skenu (safety_scanned_at NULL).
 *
 * Běh: AISHA_TESTDB_POVINNA=1 npm run test:db:znalosti
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PLATFORM_OUTPUT_FILE, buildSeedSql, idPolozky } from "../../../scripts/db/gen-knowledge-seed.mjs";
import { PG_DATABASE, PG_HOST, PG_PASSWORD, PG_PORT, PG_USER, isPgReachable } from "./test-env-probe";

const ARGS = ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", PG_DATABASE, "-v", "ON_ERROR_STOP=1"];
const ENV = { ...process.env, PGPASSWORD: PG_PASSWORD };

function psql(sql: string): string {
  return execFileSync("psql", [...ARGS, "-tA", "-c", sql], { encoding: "utf-8", env: ENV }).trim();
}

/** Poslední řádek výstupu (SET / set_config vypisují vlastní řádky před výsledkem). */
const posledni = (sql: string): string => psql(sql).split("\n").pop() ?? "";

/** Pokus, u kterého je selhání očekávaný výsledek: kód + stderr. */
function zkus(sql: string): { kod: number; chyba: string } {
  const r = spawnSync("psql", [...ARGS, "-tA", "-c", sql], { encoding: "utf-8", env: ENV });
  return { kod: r.status ?? -1, chyba: r.stderr ?? "" };
}

/** Aplikuje soubor; vrací kód a stderr (selhání je tu někdy očekávaný výsledek). */
function aplikuj(soubor: string, role?: string): { kod: number; chyba: string } {
  const r = spawnSync("psql", [...ARGS, "-q", "-f", soubor], {
    encoding: "utf-8",
    env: role ? { ...ENV, PGOPTIONS: `-c role=${role}` } : ENV,
  });
  return { kod: r.status ?? -1, chyba: r.stderr ?? "" };
}

/** Relace koncového uživatele tak, jak ji staví PostgREST: claims s rolí + SET ROLE. */
const jako = (role: "anon" | "authenticated", sub?: string) =>
  `SELECT set_config('request.jwt.claims', '${JSON.stringify(sub ? { role, sub } : { role })}', false); ` +
  `SELECT set_config('request.jwt.claim.sub', '${sub ?? ""}', false); SET ROLE ${role};`;

type Polozka = { slug: string; title: string };
const { zarazene } = buildSeedSql() as { zarazene: Polozka[] };
/** id položky platformy: md5('ki-' || source_type || ':' || slug). */
const ID = (slug: string): string => idPolozky(slug, "platform_knowledge");
const seznam = zarazene.map((x) => `'${x.slug}'`).join(", ");

/** Otisk zařazených řádků: id, verze a obsah — mění se právě tehdy, když se mění řádek. */
const otisk = () =>
  psql(`SELECT string_agg(id || ':' || version || ':' || md5(body_markdown || title || array_to_string(ai_context_tags, ',')), ',' ORDER BY id)
          FROM public.knowledge_items WHERE source_slug IN (${seznam}) AND source_type = 'platform_knowledge'`);

const BEH = randomUUID().slice(0, 8);
const SPRAVCE = randomUUID();
const PRIBEH = randomUUID();

describe.skipIf(!isPgReachable())("znalosti ze zkušenosti — seed na skutečné DB", () => {
  beforeAll(() => {
    psql(`INSERT INTO aisha_auth.users (id, email) VALUES ('${SPRAVCE}', 'znalosti-${BEH}@test.local');
          INSERT INTO public.user_roles (user_id, role) VALUES ('${SPRAVCE}', 'admin');
          INSERT INTO public.partner_stories (id, title, user_id) VALUES ('${PRIBEH}', 'znalosti ${BEH}', '${SPRAVCE}');`);
  });
  // Jedna makroúloha mezi synchronními případy: worker vitestu stihne potvrdit průběh
  // (RPC s limitem 60 s; bez toho dlouhá sada končí „Timeout calling onTaskUpdate“).
  afterEach(() => new Promise((r) => setImmediate(r)));
  afterAll(() => {
    psql(`DELETE FROM public.knowledge_items WHERE story_id = '${PRIBEH}';
          DELETE FROM public.partner_stories WHERE id = '${PRIBEH}';
          DELETE FROM public.user_roles WHERE user_id = '${SPRAVCE}';
          DELETE FROM aisha_auth.users WHERE id = '${SPRAVCE}';`);
  });

  it("kotva: seed má zařazené položky", () => {
    expect(zarazene.length).toBeGreaterThan(2);
  });

  it("každá zařazená položka je v DB právě jednou: výchozí příběh, public, active, vyhrazený zdroj, id z md5('ki-' || slug)", () => {
    const radky = psql(`
      SELECT source_slug || '|' || id || '|' || coalesce(story_id::text, 'NULL') || '|' || visibility || '|' || status || '|'
             || source_type || '|' || (id = md5('ki-platform_knowledge:' || source_slug)::uuid) || '|' || locale
        FROM public.knowledge_items WHERE source_slug IN (${seznam}) ORDER BY source_slug`)
      .split("\n")
      .filter(Boolean);
    expect(radky).toHaveLength(zarazene.length);
    for (const r of radky) {
      const [slug, id, ...zbytek] = r.split("|");
      expect(id, slug).toBe(ID(slug));
      expect(zbytek, slug).toEqual(["NULL", "public", "active", "platform_knowledge", "true", "global"]);
    }
  });

  it("nepřihlášený je najde přes mcp_search_knowledge_v2 (globální KB, štítek vrstvy)", () => {
    const nalezene = posledni(`${jako("anon")}
      SELECT string_agg(r->>'source_slug', ',' ORDER BY r->>'source_slug')
        FROM jsonb_array_elements(public.mcp_search_knowledge_v2(
               p_context_tags => ARRAY['knowledge-from-experience'], p_limit => 200,
               p_story_id => NULL::uuid, p_audience_user_id => NULL::uuid)) r
       WHERE r->>'source_slug' IN (${seznam});`);
    expect(nalezene.split(",").filter(Boolean).sort()).toEqual(zarazene.map((p) => p.slug).sort());
  });

  it("dvojí aplikace seedu nic nezdvojí ani nezvedne verzi", () => {
    const pred = otisk();
    for (let i = 0; i < 2; i++) expect(aplikuj(PLATFORM_OUTPUT_FILE).kod).toBe(0);
    expect(otisk()).toBe(pred);
    expect(psql(`SELECT count(*) FROM public.knowledge_items WHERE source_slug IN (${seznam}) AND source_type = 'platform_knowledge'`)).toBe(
      String(zarazene.length),
    );
  });

  it("samotný soubor seedu nepřidá při opakování žádný řádek (neidempotenci jinde nezhoršuje)", () => {
    const pred = psql(`SELECT count(*) FROM public.knowledge_items`);
    expect(aplikuj(PLATFORM_OUTPUT_FILE).kod).toBe(0);
    expect(psql(`SELECT count(*) FROM public.knowledge_items`)).toBe(pred);
  });

  it("oprava položky do existující DB dorazí — i pod rolí service_role (cesta dat instance)", () => {
    const cil = zarazene[0].slug;
    const verze = Number(psql(`SELECT version FROM public.knowledge_items WHERE id = '${ID(cil)}'`));
    psql(`UPDATE public.knowledge_items SET body_markdown = 'starý obsah', title = 'starý titulek', safety_scanned_at = now() WHERE id = '${ID(cil)}'`);
    expect(aplikuj(PLATFORM_OUTPUT_FILE, "service_role").kod).toBe(0);
    expect(psql(`SELECT safety_scanned_at IS NULL FROM public.knowledge_items WHERE id = '${ID(cil)}'`), "změněný obsah jde znovu ke skenu").toBe("t");
    const [titulek, verzePo, telo] = psql(
      `SELECT title || '|' || version || '|' || (body_markdown LIKE '%**Verification:**%') FROM public.knowledge_items WHERE id = '${ID(cil)}'`,
    ).split("|");
    expect(titulek).toBe(zarazene[0].title);
    expect(Number(verzePo)).toBe(verze + 1);
    expect(telo).toBe("true");
    expect(aplikuj(PLATFORM_OUTPUT_FILE, "service_role").kod).toBe(0);
    expect(Number(psql(`SELECT version FROM public.knowledge_items WHERE id = '${ID(cil)}'`))).toBe(verze + 1);
  });

  it("KONSTRUKCE: položka příběhu se stejným slugem (správa přes definer RPC) leží vedle naší a seed dál projde", () => {
    const cil = zarazene[1].slug;
    const vysledek = posledni(`${jako("authenticated", SPRAVCE)}
      SELECT public.upsert_story_knowledge_item_audited(
        p_story_id => '${PRIBEH}', p_title => 'cizí položka ${BEH}', p_body_markdown => 'obsah položky příběhu',
        p_source_type => 'manual', p_source_slug => '${cil}');`);
    expect(vysledek, "položka příběhu se založila (ne napojila na naši)").toMatch(/^[0-9a-f-]{36}$/);
    expect(vysledek).not.toBe(ID(cil));
    const seed = aplikuj(PLATFORM_OUTPUT_FILE);
    expect(seed.kod, `seed nad obsazeným slugem projde: ${seed.chyba}`).toBe(0);
    expect(psql(`SELECT count(*) FROM public.knowledge_items WHERE source_slug = '${cil}' AND locale = 'global'`)).toBe("2");
    expect(psql(`SELECT source_type || '|' || coalesce(story_id::text, 'NULL') FROM public.knowledge_items WHERE id = '${ID(cil)}'`)).toBe(
      "platform_knowledge|NULL",
    );
  });

  it("KONSTRUKCE: vyhrazený source_type koncový uživatel nezapíše — ani správa přes definer RPC, ani přímo", () => {
    const pres = zkus(`${jako("authenticated", SPRAVCE)}
      SELECT public.upsert_story_knowledge_item_audited(
        p_story_id => '${PRIBEH}', p_title => 'podvržená ${BEH}', p_body_markdown => 'x',
        p_source_type => 'platform_knowledge', p_source_slug => 'podvrh-${BEH}');`);
    expect(pres.kod).not.toBe(0);
    expect(pres.chyba).toMatch(/reserved for the repository seed/);
    const primo = zkus(`${jako("authenticated", SPRAVCE)}
      INSERT INTO public.knowledge_items (item_type, source_type, source_slug, title, body_markdown)
      VALUES ('engineering_doc', 'platform_knowledge', 'podvrh2-${BEH}', 'x', 'x');`);
    expect(primo.kod).not.toBe(0);
    expect(psql(`SELECT count(*) FROM public.knowledge_items WHERE source_slug LIKE 'podvrh%${BEH}'`)).toBe("0");
  });

  it("KONSTRUKCE: vyhrazený typ nezapíše ani služba přes API (PostgREST pod service_role) — přímo ani přes RPC", () => {
    // Tak relaci staví PostgREST: claims + metoda požadavku + SET ROLE.
    const sluzba =
      `SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); ` +
      `SELECT set_config('request.method', 'POST', false); SET ROLE service_role;`;
    const primo = zkus(`${sluzba} INSERT INTO public.knowledge_items (item_type, source_type, source_slug, title, body_markdown)
      VALUES ('engineering_doc', 'platform_knowledge', 'sluzba-${BEH}', 'x', 'x');`);
    expect(primo.kod).not.toBe(0);
    expect(primo.chyba).toMatch(/vyhrazený/);
    const rpc = zkus(`${sluzba} SELECT public.upsert_story_knowledge_item_audited(
      p_story_id => '${PRIBEH}', p_title => 'x', p_body_markdown => 'x', p_source_type => 'instance_knowledge', p_source_slug => 'sluzba2-${BEH}');`);
    expect(rpc.kod).not.toBe(0);
    expect(rpc.chyba).toMatch(/reserved for the repository seed/);
    expect(psql(`SELECT count(*) FROM public.knowledge_items WHERE source_slug LIKE 'sluzba%${BEH}'`)).toBe("0");
  });

  it("KONSTRUKCE: balíček s vyhrazeným typem import odmítne s příčinou a nezapíše nic; kotva: běžný typ se vloží", () => {
    const INST = randomUUID();
    const ZLY = randomUUID();
    const DOBRY = randomUUID();
    const manifest = (slug: string, typ: string) =>
      JSON.stringify({ schema_version: "1.0.0", knowledge_items: [{ slug, title: slug, content: "obsah", metadata: { source_type: typ } }] });
    psql(`INSERT INTO public.story_instances (id, story_id, instance_label, is_origin) VALUES ('${INST}', '${PRIBEH}', 'znalosti ${BEH}', false);
          INSERT INTO public.story_bundles (id, story_id, bundle_version, ruleset_fingerprint, schema_version, portable_manifest) VALUES
            ('${ZLY}', '${PRIBEH}', 1, 'test', '1.0.0', '${manifest(`balik-zly-${BEH}`, "platform_knowledge")}'::jsonb),
            ('${DOBRY}', '${PRIBEH}', 2, 'test', '1.0.0', '${manifest(`balik-dobry-${BEH}`, "story_sync")}'::jsonb);`);
    const zly = zkus(`${jako("authenticated", SPRAVCE)} SELECT public.import_story_bundle('${ZLY}', NULL, '${INST}');`);
    expect(zly.kod, "import s vyhrazeným typem musí selhat").not.toBe(0);
    expect(zly.chyba).toMatch(/carries reserved source_type platform_knowledge/);
    expect(zly.chyba).toContain(`balik-zly-${BEH}`);
    expect(psql(`SELECT count(*) FROM public.knowledge_items WHERE source_slug = 'balik-zly-${BEH}'`)).toBe("0");
    const dobry = zkus(`${jako("authenticated", SPRAVCE)} SELECT public.import_story_bundle('${DOBRY}', NULL, '${INST}');`);
    expect(dobry.kod, dobry.chyba).toBe(0);
    expect(psql(`SELECT source_type || '|' || story_id FROM public.knowledge_items WHERE source_slug = 'balik-dobry-${BEH}'`)).toBe(
      `story_sync|${PRIBEH}`,
    );
  });

  it("kotva: seed pod claims service_role (jak se seed sám prohlašuje) vyhrazený zdroj zapsat SMÍ", () => {
    const skript = join(mkdtempSync(join(tmpdir(), "znalosti-db-")), "seed-claims.sql");
    writeFileSync(
      skript,
      `SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false);
UPDATE public.knowledge_items SET title = 'před seedem' WHERE id = '${ID(zarazene[3].slug)}';
\\i ${PLATFORM_OUTPUT_FILE}
`,
    );
    const r = aplikuj(skript);
    expect(r.kod, r.chyba).toBe(0);
    expect(psql(`SELECT title FROM public.knowledge_items WHERE id = '${ID(zarazene[3].slug)}'`)).not.toBe("před seedem");
  });

  it("KONSTRUKCE: obsah vyhrazené položky koncový uživatel nezmění, čtení s počítadlem použití funguje", () => {
    const cil = zarazene[2].slug;
    const pred = otisk();
    const prepis = zkus(`${jako("authenticated", SPRAVCE)}
      UPDATE public.knowledge_items SET title = 'přepsáno' WHERE id = '${ID(cil)}';`);
    // Bez zápisové politiky RLS řádek k úpravě nevydá (0 řádků); trigger by ho jinak odmítl.
    expect(otisk(), `pokus o přepis (kód ${prepis.kod}) nesmí změnit obsah`).toBe(pred);
    const pouziti = Number(psql(`SELECT usage_count FROM public.knowledge_items WHERE id = '${ID(cil)}'`));
    const cteni = zkus(`${jako("anon")} SELECT public.mcp_get_knowledge_item(p_item_id => '${ID(cil)}');`);
    expect(cteni.kod, cteni.chyba).toBe(0);
    expect(Number(psql(`SELECT usage_count FROM public.knowledge_items WHERE id = '${ID(cil)}'`))).toBe(pouziti + 1);
  });

  it("ruční zásah pod superuživatelem (náš slug ve vyhrazeném prostoru pod jiným id) seed odmítne nahlas; transakce se vrátí", () => {
    const cil = zarazene[0].slug;
    const skript = join(mkdtempSync(join(tmpdir(), "znalosti-db-")), "cizi.sql");
    writeFileSync(
      skript,
      `BEGIN;
DELETE FROM public.knowledge_items WHERE id = '${ID(cil)}';
INSERT INTO public.knowledge_items (id, item_type, source_type, source_slug, title, body_markdown, story_id)
VALUES (gen_random_uuid(), 'engineering_doc', 'platform_knowledge', '${cil}', 'cizí položka', 'cizí obsah', NULL);
\\i ${PLATFORM_OUTPUT_FILE}
COMMIT;
`,
    );
    const { kod, chyba } = aplikuj(skript);
    expect(kod, "seed nad cizím řádkem ve vyhrazeném prostoru musí selhat").not.toBe(0);
    expect(chyba).toContain("vyhrazený prostor znalostí nese cizí řádek");
    expect(chyba).toContain(cil);
    expect(psql(`SELECT count(*) FROM public.knowledge_items WHERE id = '${ID(cil)}'`)).toBe("1");
    expect(psql(`SELECT count(*) FROM public.knowledge_items WHERE title = 'cizí položka'`)).toBe("0");
  });

  it("ruční zásah: řádek s id položky platformy pod typem JINÉ vrstvy seed odmítne (žádné přepisování mezi vrstvami)", () => {
    const cil = zarazene[0].slug;
    const skript = join(mkdtempSync(join(tmpdir(), "znalosti-db-")), "vrstva.sql");
    writeFileSync(
      skript,
      `BEGIN;
UPDATE public.knowledge_items SET source_type = 'instance_knowledge' WHERE id = '${ID(cil)}';
\\i ${PLATFORM_OUTPUT_FILE}
COMMIT;
`,
    );
    const { kod, chyba } = aplikuj(skript);
    expect(kod).not.toBe(0);
    expect(chyba).toContain("vyhrazený prostor znalostí nese cizí řádek");
    expect(psql(`SELECT source_type FROM public.knowledge_items WHERE id = '${ID(cil)}'`)).toBe("platform_knowledge");
  });

  it("ruční zásah pod superuživatelem (řádek s naším id mimo vyhrazený zdroj) seed odmítne nahlas", () => {
    const cil = zarazene[0].slug;
    const skript = join(mkdtempSync(join(tmpdir(), "znalosti-db-")), "id.sql");
    writeFileSync(
      skript,
      `BEGIN;
DELETE FROM public.knowledge_items WHERE id = '${ID(cil)}';
INSERT INTO public.knowledge_items (id, item_type, source_type, source_slug, title, body_markdown)
VALUES ('${ID(cil)}', 'engineering_doc', 'manual', 'obsazene-id-${BEH}', 'obsazené id', 'x');
\\i ${PLATFORM_OUTPUT_FILE}
COMMIT;
`,
    );
    const { kod, chyba } = aplikuj(skript);
    expect(kod).not.toBe(0);
    expect(chyba).toContain("vyhrazený prostor znalostí nese cizí řádek");
    expect(psql(`SELECT source_type FROM public.knowledge_items WHERE id = '${ID(cil)}'`)).toBe("platform_knowledge");
  });
});
