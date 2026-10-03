/**
 * News Content-Node Canvas Gate
 *
 * News articles become GrapesJS content nodes: they carry a canvas
 * (canvas_data/html/css) authored in the SAME shared editor as web_pages, and
 * the public detail renders that canvas (multilingual via data-i18n-key), a
 * zděděné tělo z `content_key` se vydá jako OŠETŘENÉ HTML. This gate locks the contract so it can't
 * silently regress — the schema, the admin RPC security shape, the shared editor
 * reuse (no duplicated GrapesJS editor), and the multilingual render path.
 *
 * Run: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string): string => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");

const NEWS = read("aisha/db/sql/tables/news_articles.sql");
const CANVAS_RPC = read("aisha/db/sql/functions/update_news_article_canvas_admin.sql");
const ADMIN_RPC = read("aisha/db/sql/functions/get_news_article_admin.sql");
const BY_SLUG = read("aisha/db/sql/functions/get_news_article_by_slug.sql");
const BASELINE = read("aisha/db/migrations/00000000000000_baseline.sql");
const CANVAS_EDITOR = read("src/components/admin/page-builder/CanvasEditor.tsx");
const PAGE_EDITOR = read("src/pages/admin/AdminPageEditor.tsx");
const ARTICLE_EDITOR = read("src/pages/admin/AdminNewsArticleEditor.tsx");
const DETAIL = read("src/pages/NewsArticleDetail.tsx");

describe("news_articles is a GrapesJS content node", () => {
  it("carries the canvas columns (same model as web_pages)", () => {
    expect(NEWS).toMatch(/canvas_data jsonb/);
    expect(NEWS).toMatch(/canvas_html text/);
    expect(NEWS).toMatch(/canvas_css\s+text/);
  });
  it("folds canvas + RPCs into the regenerated baseline", () => {
    expect(BASELINE).toContain("update_news_article_canvas_admin");
    expect(BASELINE).toContain("get_news_article_admin");
    expect(BASELINE).toMatch(/news_articles[\s\S]*?canvas_data/);
  });
});

describe("the canvas admin RPCs are secure", () => {
  it("update_news_article_canvas_admin: DEFINER + admin guard + audited + REVOKE/GRANT", () => {
    expect(CANVAS_RPC).toMatch(/SECURITY DEFINER/);
    expect(CANVAS_RPC).toMatch(/is_admin_or_staff/);
    expect(CANVAS_RPC).toMatch(/write_audit_journal/);
    expect(CANVAS_RPC).toMatch(/REVOKE ALL ON FUNCTION public\.update_news_article_canvas_admin/);
  });
  it("get_news_article_admin: admin-guarded, returns the canvas + draft state", () => {
    expect(ADMIN_RPC).toMatch(/SECURITY DEFINER/);
    expect(ADMIN_RPC).toMatch(/is_admin_or_staff/);
    expect(ADMIN_RPC).toMatch(/canvas_data jsonb/);
    expect(ADMIN_RPC).toMatch(/REVOKE ALL ON FUNCTION public\.get_news_article_admin/);
  });
  it("the public by-slug read returns the canvas for rendering", () => {
    expect(BY_SLUG).toMatch(/canvas_html text/);
    expect(BY_SLUG).toMatch(/canvas_css text/);
  });
});

describe("one shared GrapesJS editor — pages + articles, no duplication", () => {
  it("the shared CanvasEditor owns the editor lifecycle + i18n string-extraction-on-save", () => {
    expect(CANVAS_EDITOR).toMatch(/extractI18nFromCanvas/);
    expect(CANVAS_EDITOR).toMatch(/upsertTranslations/);
    expect(CANVAS_EDITOR).toMatch(/GjsEditor/);
  });
  it("BOTH the page editor and the article editor reuse the shared core", () => {
    expect(PAGE_EDITOR).toMatch(/CanvasEditor/);
    expect(ARTICLE_EDITOR).toMatch(/CanvasEditor/);
    expect(ARTICLE_EDITOR).toMatch(/useUpdateNewsArticleCanvas/);
  });
});

describe("the article body renders the canvas (multilingual); zděděné tělo je ošetřené HTML", () => {
  it("uses the shared PageRenderer for the canvas", () => {
    expect(DETAIL).toMatch(/PageRenderer/);
    expect(DETAIL).toMatch(/canvasHtml=\{article\.canvas_html\}/);
  });

  /**
   * ⛔ ZMĚNA TVRZENÍ, NE ÚSTUPEK (2026-09-21). Do teď se tu žádalo
   * `renderContent` — „jednoduchý markdown", který tělo dělil na odstavce,
   * obaloval je do `<p>` a každý nový řádek měnil na `<br />`.
   *
   * Naměřeno nad `translations` na instanci: 226 z 226 těl je HTML (226× `<p`,
   * 119× `<h3`, 175× `<a `, 120× `<img`) a 0 těl je markdown. Ta větev tedy
   * netrefila nic — zato vkládala blokové prvky dovnitř `<p>` (neplatné vnoření)
   * a `<br />` mezi značky. Tělo se proto vydává v jednom kuse, přes DOMPurify.
   *
   * Co brána drží dál a proč: sanitizace je NOSNÁ (tělo pochází z importu, ne
   * od nás), takže `dangerouslySetInnerHTML` bez `DOMPurify.sanitize` je červená.
   */
  it("zděděné tělo jde přes DOMPurify a bez markdownových přepisů", () => {
    expect(DETAIL).toMatch(/DOMPurify\.sanitize/);
    const kod = DETAIL.replace(/\/\*[\s\S]*?\*\//g, " ");
    const surove = [...kod.matchAll(/dangerouslySetInnerHTML=\{\{\s*__html:\s*([^}]*)\}\}/g)];
    expect(surove.length, "tělo článku se musí vydávat právě jedním místem").toBe(1);
    expect(surove[0][1], "obsah MUSÍ projít sanitizací").toMatch(/DOMPurify\.sanitize/);
    expect(
      /\$1<\/strong>|<br \/>/.test(kod),
      "markdownové přepisy (**tučně**, \\n → <br />) v datech nic netrefí a HTML rozbíjejí",
    ).toBe(false);
  });
});
