/**
 * Brána: uložení ZVEŘEJNĚNÉHO článku nejde na web — jde do konceptu.
 *
 * ⛔ CO SE NAMĚŘILO (2026-09-24): veřejná stránka čte `canvas_html` článku přímo
 * (`get_news_article_by_slug`) a editor plátna ukládá 5 s po poslední změně.
 * U zveřejněného článku tedy každá nedopsaná věta šla na web. Runtime chování
 * měří `src/tests/db/novinky-koncept-verze-runtime.test.ts` nad throwaway DB;
 * tahle brána drží STRUKTURU, která by se dala tiše rozebrat:
 *   • zapisovatel plátna sám nepíše do news_articles — deleguje na koncept/publish;
 *   • koncept je jeden řádek na článek (ON CONFLICT nad částečným indexem);
 *   • zveřejnění koncept přelije, smaže a udělá snímek 'published';
 *   • web čte JEN news_articles (nikdy koncept);
 *   • všechny nové SoT soubory jsou v heals (jinak nedotečou na běžící DB) a změněné
 *     podpisy mají DROP;
 *   • klient posílá razítko a hydratuje editor z konceptu.
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
  "sql/tables/news_article_versions.sql",
  "sql/tables/media_assets.sql",
  "sql/indexes/uq_news_article_versions_draft.sql",
  "sql/functions/news_article_edit_stamp.sql",
  "sql/functions/save_news_article_draft_admin.sql",
  "sql/functions/publish_news_article_admin.sql",
  "sql/functions/discard_news_article_draft_admin.sql",
  "sql/functions/create_news_article_version.sql",
  "sql/functions/restore_news_article_version.sql",
  "sql/functions/record_media_asset.sql",
  "sql/functions/get_media_assets_admin.sql",
];

describe("koncept zveřejněného článku nejde na web", () => {
  it("zapisovatel plátna deleguje — sám do news_articles nepíše", () => {
    const src = bezSqlKomentaru(cti(`${FN}/update_news_article_canvas_admin.sql`));
    expect(src).not.toMatch(/UPDATE\s+public\.news_articles/i);
    expect(src).toMatch(/publish_news_article_admin\(/);
    expect(src).toMatch(/save_news_article_draft_admin\(/);
  });

  it("koncept: větev podle is_published, jeden řádek na článek", () => {
    const src = bezSqlKomentaru(cti(`${FN}/save_news_article_draft_admin.sql`));
    expect(src).toMatch(/IF NOT v_a\.is_published THEN/);
    expect(src).toMatch(/ON CONFLICT \(article_id\) WHERE kind = 'draft'/);
    expect(src, "razítko: nesedí → PT409").toMatch(/ERRCODE = 'PT409'/);
    const idx = cti("aisha/db/sql/indexes/uq_news_article_versions_draft.sql");
    expect(idx).toMatch(/UNIQUE INDEX IF NOT EXISTS uq_news_article_versions_draft[\s\S]*WHERE kind = 'draft'/);
  });

  it("zveřejnění koncept přelije, smaže a udělá snímek 'published'", () => {
    const src = bezSqlKomentaru(cti(`${FN}/publish_news_article_admin.sql`));
    expect(src).toMatch(/UPDATE public\.news_articles SET[\s\S]*is_published\s*=\s*true/);
    expect(src).toMatch(/DELETE FROM public\.news_article_versions d[\s\S]*kind = 'draft'/);
    expect(src).toMatch(/create_news_article_version\(p_article_id, 'published'/);
  });

  it("web čte jen news_articles", () => {
    for (const f of ["get_news_article_by_slug.sql", "get_published_news_articles_filtered.sql"]) {
      const src = bezSqlKomentaru(cti(`${FN}/${f}`));
      expect(src, f).toMatch(/FROM public\.news_articles na/);
      expect(src, `${f} nesmí sahat na koncept`).not.toMatch(/news_article_versions/);
      expect(src, f).toMatch(/is_published = true/);
    }
  });

  it("nové SoT soubory jsou v heals a změněné podpisy mají DROP", () => {
    const heals = cti(HEALS);
    for (const f of NOVE_SOT) {
      expect(existsSync(join(ROOT, "aisha/db", f)), `${f} chybí`).toBe(true);
      expect(heals, `${f} není v heals — na běžící DB nedoteče`).toContain(`\\ir ${f}`);
    }
    for (const drop of [
      "DROP FUNCTION IF EXISTS public.update_news_article_canvas_admin(uuid, jsonb, text, text, boolean);",
      "DROP FUNCTION IF EXISTS public.get_news_articles_admin();",
      "DROP FUNCTION IF EXISTS public.get_news_article_admin(uuid);",
      "DROP FUNCTION IF EXISTS public.get_news_article_by_slug(text);",
    ]) {
      expect(heals, drop).toContain(drop);
    }
  });

  it("klient posílá razítko, hydratuje z konceptu a rozumí 409", () => {
    const canvasHook = bezTsKomentaru(cti("src/hooks/useAdminNewsArticleCanvas.ts"));
    expect(canvasHook).toMatch(/p_expected_stamp/);
    const editor = bezTsKomentaru(cti("src/pages/admin/AdminNewsArticleEditor.tsx"));
    expect(editor, "editor musí načíst koncept, je-li").toMatch(/\.draft\b/);
    const hook = bezTsKomentaru(cti("src/hooks/useAdminNewsArticles.ts"));
    expect(hook).toMatch(/save_news_article_draft_admin/);
    expect(hook).toMatch(/publish_news_article_admin/);
    expect(hook, "konflikt se musí poznat").toMatch(/PT409|409/);
    expect(existsSync(join(ROOT, "src/tests/db/novinky-koncept-verze-runtime.test.ts"))).toBe(true);
    expect(cti("package.json")).toMatch(/"test:db:novinky"/);
  });
});
