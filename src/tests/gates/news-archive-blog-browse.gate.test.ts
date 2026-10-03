/**
 * News Archive/Blog Browse Gate
 *
 * Published articles are browsable via a PARAMETERIZED listing — the news-browser
 * runtime block's config sets WHAT to list (search / tags / sort), and the
 * matching articles are pulled DYNAMICALLY from the backend
 * (get_published_news_articles_filtered). Articles are never manually placed.
 * This gate locks the contract: the tags column, the filtered listing + tag
 * catalog RPCs (public, search over TRANSLATED text), and the block/hook wiring.
 *
 * Run: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string): string => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");

const NEWS = read("aisha/db/sql/tables/news_articles.sql");
const FILTERED = read("aisha/db/sql/functions/get_published_news_articles_filtered.sql");
const TAGS_RPC = read("aisha/db/sql/functions/get_news_tags.sql");
const BASELINE = read("aisha/db/migrations/00000000000000_baseline.sql");
const BLOCK = read("src/components/web/blocks/NewsBrowserBlock.tsx");
const HOOK = read("src/hooks/useNewsArticles.ts");

describe("articles carry tags + a GIN index", () => {
  it("news_articles.tags + GIN index in the baseline", () => {
    expect(NEWS).toMatch(/tags text\[\]/);
    expect(BASELINE).toMatch(/idx_news_articles_tags/);
  });
});

describe("the filtered listing is config-driven, public, searches TRANSLATED text", () => {
  it("get_published_news_articles_filtered: search/tags/sort, anon-granted, dynamic tag overlap", () => {
    expect(FILTERED).toMatch(/get_published_news_articles_filtered/);
    expect(FILTERED).toMatch(/p_search text/);
    expect(FILTERED).toMatch(/p_tags\s+text\[\]/);
    expect(FILTERED).toMatch(/na\.tags && p_tags/);
    // articles use i18n keys, so search joins the translated text, not the raw key
    expect(FILTERED).toMatch(/translations tr/);
    expect(FILTERED).toMatch(/GRANT EXECUTE[\s\S]*?TO anon/);
  });
  it("get_news_tags: dynamic in-use tag catalog (no hardcoded taxonomy)", () => {
    expect(TAGS_RPC).toMatch(/get_news_tags/);
    expect(TAGS_RPC).toMatch(/unnest\(na\.tags\)/);
    expect(TAGS_RPC).toMatch(/is_published = true/);
  });
  it("baseline-only: both RPCs folded in", () => {
    expect(BASELINE).toContain("get_published_news_articles_filtered");
    expect(BASELINE).toContain("get_news_tags");
  });
});

describe("the GrapesJS browser block drives the dynamic RPC (no manual placement)", () => {
  it("the hook talks to the backend-filtered RPC + the tag catalog", () => {
    expect(HOOK).toMatch(/get_published_news_articles_filtered/);
    expect(HOOK).toMatch(/get_news_tags/);
  });
  it("the block is a parameterized, URL-synced browser over that hook", () => {
    expect(BLOCK).toMatch(/useNewsArticlesBrowser/);
    expect(BLOCK).toMatch(/useNewsTags/);
    expect(BLOCK).toMatch(/useSearchParams/);
    // config sets WHAT to list (pin a tag / toggle the filter bar)
    expect(BLOCK).toMatch(/config\?\.tag/);
    expect(BLOCK).toMatch(/showFilters/);
  });
});
