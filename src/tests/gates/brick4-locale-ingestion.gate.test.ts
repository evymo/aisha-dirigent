/**
 * Gate test: locale-aware ingestion (Brick4).
 *
 * Brick4 threads a real `p_locale` through the ingestion writers so a content node
 * produces one knowledge_item per (source, locale), each chunk's contextual prefix
 * is written in the chunk's own language, and re-ingesting one locale never wipes
 * its sibling locales. This gate locks the SoT pieces against the committed files:
 *
 *   - upsert_story_knowledge_item_audited gains a trailing `p_locale` (10 → 11 args,
 *     old overload DROPped first) and writes COALESCE(p_locale,'global') on insert /
 *     COALESCE(p_locale,locale) on update.
 *   - clear_knowledge_item_chunks gains `p_locale` (NULL = clear-all back-compat),
 *     filtering BOTH deletes by `(p_locale IS NULL OR locale = p_locale)` — the
 *     per-locale clear that stops a single-locale re-ingest from wiping siblings.
 *   - get_knowledge_items_for_embedding surfaces `locale` (+ source_hash) so the
 *     worker threads the item's locale into chunk/embedding writes + the prefix.
 *   - the guild_db source-identity unique widens to (source_type, source_id, locale).
 *   - contextual-prefix.ts is locale-aware AND fail-loud (no hardcoded model default;
 *     throws — never silently embeds prefix-less). The worker threads item/row locale
 *     into every write and 503s when the prefix backend is unhealthy (no silent batch
 *     degrade).
 *   - the regenerated baseline carries all of the above.
 *
 * Runtime proof (coexistence, per-locale clear keeps siblings, upsert locale, FK
 * fail-loud) lives in aisha/db/tests/schema/04b_locale_ingestion.sql (cold-start gate).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const p = (rel: string) => path.join(ROOT, rel);
const read = (rel: string): string => {
  const fp = p(rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
};

const UPSERT = read('aisha/db/sql/functions/upsert_story_knowledge_item_audited.sql');
const CLEAR = read('aisha/db/sql/functions/clear_knowledge_item_chunks.sql');
const GET_EMB = read('aisha/db/sql/functions/get_knowledge_items_for_embedding.sql');
const IDX = read('aisha/db/sql/indexes/idx_knowledge_items_source_unique.sql');
const PREFIX_TS = read('services/svc-mcp-knowledge/src/lib/contextual-prefix.ts');
const WORKER_TS = read('services/svc-mcp-knowledge/src/routes/knowledge-embeddings.ts');
const BASELINE = read('aisha/db/migrations/00000000000000_baseline.sql');
const PGTAP = read('aisha/db/tests/schema/04b_locale_ingestion.sql');

describe('Brick4 — upsert_story_knowledge_item_audited threads p_locale', () => {
  it('declares a trailing p_locale text DEFAULT global and DROPs the 10-arg overload first', () => {
    expect(UPSERT.length, 'upsert SoT must exist').toBeGreaterThan(0);
    expect(UPSERT).toMatch(/p_locale\s+text DEFAULT 'global'/);
    const dropIdx = UPSERT.search(
      /DROP FUNCTION IF EXISTS public\.upsert_story_knowledge_item_audited\(\s*uuid, uuid, text, text, text, text, text, text\[\], text, text\s*\)/,
    );
    const createIdx = UPSERT.search(/CREATE OR REPLACE FUNCTION public\.upsert_story_knowledge_item_audited/);
    expect(dropIdx, 'must DROP the 10-arg overload').toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeLessThan(createIdx);
  });

  it('writes COALESCE(p_locale,...) on both the insert and the update path', () => {
    expect(UPSERT).toMatch(/COALESCE\(p_locale, 'global'\)/);
    expect(UPSERT).toMatch(/locale\s+= COALESCE\(p_locale, locale\)/);
  });

  // 2026-07-30: arita 11 → 14 (p_source_type/slug/hash). Brána drží TOTÉŽ, co
  // držela: granty se musí přeposlat na SKUTEČNÉ aritě funkce, jinak zůstanou
  // viset na podpisu, který už neexistuje, a volající dostane 42501. Pin se
  // proto posouvá s aritou — neruší se.
  it('re-issues the GRANTs at the CURRENT arity (14 args incl. source provenance)', () => {
    expect(UPSERT).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.upsert_story_knowledge_item_audited\(\s*uuid, uuid, text, text, text, text, text, text\[\], text, text, text, text, text, text\s*\) TO service_role/,
    );
  });

  it('DROPs the superseded 11-arg overload too — two variants would make every 11-arg call ambiguous', () => {
    expect(UPSERT).toMatch(
      /DROP FUNCTION IF EXISTS public\.upsert_story_knowledge_item_audited\(\s*uuid, uuid, text, text, text, text, text, text\[\], text, text, text\s*\)/,
    );
  });
});

describe('Brick4 — clear_knowledge_item_chunks is per-locale', () => {
  it('declares p_locale text DEFAULT NULL and DROPs the 1-arg overload first', () => {
    expect(CLEAR.length, 'clear SoT must exist').toBeGreaterThan(0);
    expect(CLEAR).toMatch(/clear_knowledge_item_chunks\(p_item_id uuid, p_locale text DEFAULT NULL\)/);
    const dropIdx = CLEAR.search(/DROP FUNCTION IF EXISTS public\.clear_knowledge_item_chunks\(uuid\)/);
    const createIdx = CLEAR.search(/CREATE OR REPLACE FUNCTION public\.clear_knowledge_item_chunks/);
    expect(dropIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeLessThan(createIdx);
  });

  it('filters BOTH deletes by (p_locale IS NULL OR locale = p_locale)', () => {
    const matches = CLEAR.match(/\(p_locale IS NULL OR locale = p_locale\)/g) ?? [];
    expect(matches.length, 'both the embeddings + chunks DELETE must be locale-scoped').toBe(2);
  });

  it('re-issues the GRANT at (uuid, text)', () => {
    expect(CLEAR).toMatch(/GRANT EXECUTE ON FUNCTION clear_knowledge_item_chunks\(uuid, text\) TO service_role/);
  });
});

describe('Brick4 — get_knowledge_items_for_embedding surfaces locale', () => {
  it('RETURNS TABLE carries locale + source_hash, SELECT projects ki.locale, bez DROP téže signatury', () => {
    expect(GET_EMB.length, 'get_knowledge_items_for_embedding SoT must exist').toBeGreaterThan(0);
    expect(GET_EMB).toMatch(/RETURNS TABLE\([\s\S]*item_type text, locale text, source_hash text\)/);
    expect(GET_EMB).toMatch(/ki\.locale/);
    // Soubor je v heals: DROP téže signatury (zbytek z doby, kdy přibyly sloupce) by běžel při každém
    // migrate. Návratový tvar má i nejstarší podporovaná databáze — CREATE OR REPLACE stačí.
    expect(GET_EMB).toMatch(/CREATE OR REPLACE FUNCTION public\.get_knowledge_items_for_embedding/);
    expect(GET_EMB).not.toMatch(/^\s*DROP FUNCTION/m);
  });
});

describe('Brick4 — guild_db source-identity unique widened with locale', () => {
  it('the unique index keys (source_type, source_id, locale) on the guild_db partial', () => {
    expect(IDX.length, 'index SoT must exist').toBeGreaterThan(0);
    expect(IDX).toMatch(/DROP INDEX IF EXISTS public\.idx_knowledge_items_source_unique/);
    expect(IDX).toMatch(
      /CREATE UNIQUE INDEX idx_knowledge_items_source_unique ON public\.knowledge_items USING btree \(source_type, source_id, locale\) WHERE \(source_type = 'guild_db'/,
    );
  });
});

describe('Brick4 — contextual prefix is locale-aware AND fail-loud', () => {
  it('PrefixInput carries a locale field and the prompt writes in the chunk language', () => {
    expect(PREFIX_TS.length, 'contextual-prefix.ts must exist').toBeGreaterThan(0);
    expect(PREFIX_TS).toMatch(/locale\?: string/);
    expect(PREFIX_TS).toMatch(/the chunk's language/);
  });

  it('has NO hardcoded model default and fails loud when no model resolves', () => {
    // The qwen3-30b baked-in default + the `?? DEFAULT_MODEL` fallback are gone.
    expect(PREFIX_TS, 'DEFAULT_MODEL must be removed').not.toMatch(/DEFAULT_MODEL/);
    expect(PREFIX_TS).not.toMatch(/'qwen3-30b'/);
    // Missing model is a thrown error, not a silent fallback.
    expect(PREFIX_TS).toMatch(/opts\.model is required/);
    // The return type is non-null (throws on failure, never returns null).
    expect(PREFIX_TS).toMatch(/Promise<PrefixResult>/);
  });
});

describe('Brick4 — the embedding worker threads locale + fails loud', () => {
  it('passes the item/row locale into every chunk/embedding write (not the global sentinel)', () => {
    expect(WORKER_TS.length, 'knowledge-embeddings.ts must exist').toBeGreaterThan(0);
    // clear + chunk + embedding all carry item.locale; v2 backfill carries row.locale.
    expect(WORKER_TS).toMatch(/clear_knowledge_item_chunks', \{ p_item_id: item\.id, p_locale: item\.locale \}/);
    const itemLocale = WORKER_TS.match(/p_locale: item\.locale/g) ?? [];
    expect(itemLocale.length, 'chunk + embedding writes thread item.locale').toBeGreaterThanOrEqual(2);
    expect(WORKER_TS).toMatch(/p_locale: row\.locale/);
    // The old behaviour-neutral global pins are gone from the write sites.
    expect(WORKER_TS).not.toMatch(/p_locale: 'global'/);
  });

  it('fails loud (503) when no contextual-prefix backend is healthy (no silent batch degrade)', () => {
    expect(WORKER_TS).toMatch(/No contextual-prefix backend available/);
    expect(WORKER_TS).toMatch(/no unprefixed embeddings written/);
  });
});

describe('Brick4 — regenerated baseline carries the locale-ingestion SoT', () => {
  it('baseline has the upsert p_locale, per-locale clear, widened index + surfaced locale', () => {
    expect(BASELINE.length, 'baseline must exist').toBeGreaterThan(0);
    expect(BASELINE).toMatch(/COALESCE\(p_locale, 'global'\)/);
    expect(BASELINE).toMatch(/\(p_locale IS NULL OR locale = p_locale\)/);
    expect(BASELINE).toMatch(/\(source_type, source_id, locale\) WHERE \(source_type = 'guild_db'/);
    expect(BASELINE).toMatch(/item_type text, locale text, source_hash text\)/);
  });
});

describe('Brick4 — pgTAP runtime proof exists', () => {
  it('04b_locale_ingestion.sql asserts coexistence, per-locale clear, upsert locale, FK fail-loud', () => {
    expect(PGTAP.length, 'pgTAP suite must exist').toBeGreaterThan(0);
    expect(PGTAP).toMatch(/SELECT plan\(10\)/);
    expect(PGTAP).toMatch(/p_locale/);
    // widened-unique coexistence (lives_ok) + within-locale collision (23505).
    expect(PGTAP).toMatch(/'23505'/);
    // item locale FK fail-loud.
    expect(PGTAP).toMatch(/throws_ok[\s\S]{0,400}'23503'/);
    // per-locale clear sibling survival.
    expect(PGTAP).toMatch(/clear_knowledge_item_chunks\(current_setting\('ing\.clr_item'\)::uuid, 'cs'\)/);
  });
});
