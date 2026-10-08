/**
 * Brána: uložení ZVEŘEJNĚNÉ webové stránky nejde na web — jde do konceptu.
 *
 * ⛔ CO SE NAMĚŘILO (2026-10-02, naměřeno na instanci): veřejný web čte `canvas_html` stránky
 * i sdílených útržků přímo (`get_web_page_by_slug`, `get_published_web_partials`)
 * a editor plátna ukládá 5 s po poslední změně. Každý rozpracovaný pokus tak šel
 * na web — správkyni webu se „rozsypala“ úvodní stránka. Současně verze, obnova
 * a šablona padaly správci/staffovi na RLS audit_journal (SECURITY INVOKER).
 *
 * Runtime chování měří `src/tests/db/web-stranky-koncept.runtime.test.ts` nad
 * throwaway DB pod rolí authenticated; tahle brána drží STRUKTURU (zrcadlí
 * `novinky-koncept-nejde-na-web`):
 *   • zapisovatel plátna sám nepíše do web_pages — deleguje na koncept/publish;
 *   • koncept je jeden řádek na stránku (ON CONFLICT nad částečným indexem);
 *   • zveřejnění koncept přelije, smaže a zapíše verzi 'published' na serveru;
 *   • web čte JEN web_pages (nikdy koncept);
 *   • verze/obnova/šablona jsou DEFINER (audit_journal má jen čtecí politiku);
 *   • nové SoT soubory jsou v heals, změněné podpisy mají DROP;
 *   • klient posílá razítko, hydratuje editor z konceptu a rozumí 409.
 *
 * Run: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const cti = (p: string): string => readFileSync(join(ROOT, p), "utf8");
const bezSqlKomentaru = (src: string): string => src.replace(/--[^\n]*/g, "");
const bezTsKomentaru = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const FN = "aisha/db/sql/functions";
const HEALS = "aisha/db/heals.sql";

const NOVE_SOT = [
  "sql/tables/web_page_versions.sql",
  "sql/triggers/set_web_page_versions_updated_at.sql",
  "sql/indexes/uq_web_page_versions_draft.sql",
  "sql/functions/web_page_edit_stamp.sql",
  "sql/functions/save_web_page_draft_admin.sql",
  "sql/functions/publish_web_page_admin.sql",
  "sql/functions/discard_web_page_draft_admin.sql",
  "sql/functions/create_web_page_version.sql",
  "sql/functions/restore_web_page_version.sql",
  "sql/functions/apply_web_page_template.sql",
  "sql/functions/update_web_page_canvas_admin.sql",
  "sql/functions/get_web_page_admin.sql",
  "sql/functions/get_web_page_versions.sql",
];

describe("koncept zveřejněné webové stránky nejde na web", () => {
  it("zapisovatel plátna deleguje — sám do web_pages nepíše", () => {
    const src = bezSqlKomentaru(cti(`${FN}/update_web_page_canvas_admin.sql`));
    expect(src).not.toMatch(/UPDATE\s+(public\.)?web_pages/i);
    expect(src).toMatch(/publish_web_page_admin\(/);
    expect(src).toMatch(/save_web_page_draft_admin\(/);
  });

  it("koncept: větev podle stavu stránky, jeden řádek na stránku, razítko", () => {
    const src = bezSqlKomentaru(cti(`${FN}/save_web_page_draft_admin.sql`));
    expect(src).toMatch(/IF v_p\.status IS DISTINCT FROM 'published' THEN/);
    expect(src).toMatch(/ON CONFLICT \(page_id\) WHERE kind = 'draft'/);
    expect(src, "razítko: nesedí → PT409").toMatch(/ERRCODE = 'PT409'/);
    const idx = cti("aisha/db/sql/indexes/uq_web_page_versions_draft.sql");
    expect(idx).toMatch(/UNIQUE INDEX IF NOT EXISTS uq_web_page_versions_draft[\s\S]*WHERE kind = 'draft'/);
  });

  it("zveřejnění koncept přelije, smaže a zapíše verzi 'published'", () => {
    const src = bezSqlKomentaru(cti(`${FN}/publish_web_page_admin.sql`));
    expect(src).toMatch(/UPDATE public\.web_pages SET[\s\S]*status\s*=\s*'published'/);
    expect(src).toMatch(/DELETE FROM public\.web_page_versions d[\s\S]*kind = 'draft'/);
    expect(src).toMatch(/create_web_page_version\(p_page_id, 'publish'\)/);
    expect(src).toMatch(/SET kind = 'published'/);
  });

  it("web čte jen web_pages, nikdy koncept", () => {
    for (const f of ["get_web_page_by_slug.sql", "get_published_web_partials.sql"]) {
      const src = bezSqlKomentaru(cti(`${FN}/${f}`));
      expect(src, f).toMatch(/FROM (public\.)?web_pages wp/);
      expect(src, `${f} nesmí sahat na koncept`).not.toMatch(/web_page_versions/);
      expect(src, f).toMatch(/status = 'published'/);
    }
  });

  it("verze, obnova a šablona jsou DEFINER se stráží (audit_journal má jen čtecí politiku)", () => {
    for (const f of ["create_web_page_version.sql", "restore_web_page_version.sql", "apply_web_page_template.sql"]) {
      const src = bezSqlKomentaru(cti(`${FN}/${f}`));
      expect(src, f).toMatch(/SECURITY DEFINER/);
      expect(src, f).not.toMatch(/SECURITY INVOKER/);
      expect(src, `${f} musí autorizovat sám`).toMatch(/is_admin_or_staff\(\)/);
    }
  });

  it("šablona nepřepíše otisk seedu ani roli stránky", () => {
    const src = bezSqlKomentaru(cti(`${FN}/apply_web_page_template.sql`));
    expect(src).toMatch(/- 'seed_fingerprint' - 'role'/);
  });

  it("nové SoT soubory jsou v heals a změněné podpisy mají DROP", () => {
    const heals = cti(HEALS);
    for (const f of NOVE_SOT) {
      expect(existsSync(join(ROOT, "aisha/db", f)), `${f} chybí`).toBe(true);
      expect(heals, `${f} není v heals — na běžící DB nedoteče`).toContain(`\\ir ${f}`);
    }
    for (const drop of [
      "DROP FUNCTION IF EXISTS public.update_web_page_canvas_admin(uuid, jsonb, text, text, jsonb, boolean);",
      "DROP FUNCTION IF EXISTS public.get_web_page_admin(uuid);",
    ]) {
      expect(heals, drop).toContain(drop);
    }
  });

  it("klient posílá razítko, hydratuje z konceptu, rozumí 409 a nedopisuje nahrazované plátno", () => {
    const hook = bezTsKomentaru(cti("src/hooks/useAdminWebPages.ts"));
    expect(hook).toMatch(/p_expected_stamp/);
    expect(hook).toMatch(/discard_web_page_draft_admin/);
    expect(hook, "konflikt se musí poznat").toMatch(/chybaZRpc/);
    const editor = bezTsKomentaru(cti("src/pages/admin/AdminPageEditor.tsx"));
    expect(editor, "editor musí načíst koncept, je-li").toMatch(/page\?\.draft/);
    expect(editor).toMatch(/jeKonfliktUlozeni/);
    expect(editor, "verzi zveřejnění zapisuje server, ne klient").not.toMatch(/useCreatePageVersion/);
    expect(editor, "odcházející plátno se při nahrazení nedopisuje").toMatch(/payload\.priOdchodu && nahrazujiRef\.current/);
    expect(existsSync(join(ROOT, "src/tests/db/web-stranky-koncept.runtime.test.ts"))).toBe(true);
    expect(cti("package.json")).toMatch(/"test:db:web-koncept"/);
  });
});
