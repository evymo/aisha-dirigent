/**
 * Gate: knowledge_items (source_slug, locale) structural dedup (#33).
 *
 * The chat-delegation x17 class (#547) was possible because manual items (NULL
 * source_id) escaped the guild_db-only source unique, and NULL never collides under a
 * (source_type, source_id) key. This gate locks the structural fix against the SoT:
 *   - a partial UNIQUE (source_slug, locale) index (NOT a bare UNIQUE(source_slug),
 *     which would forbid Brick4 locale variants);
 *   - an existing-DB dup-collapse heal in heals.sql that runs BEFORE the unique (else
 *     CREATE UNIQUE INDEX would fail on a pre-#547 dirty DB);
 *   - the regenerated baseline carrying the index.
 * Runtime enforcement proof lives in aisha/db/tests/schema/09_knowledge_source_slug_unique.sql.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => {
  const fp = path.join(ROOT, rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
};

const INDEX = read('aisha/db/sql/indexes/idx_knowledge_items_source_slug_locale_unique.sql');
const HEALS = read('aisha/db/heals.sql');
const BASELINE = read('aisha/db/migrations/00000000000000_baseline.sql');
const PGTAP = read('aisha/db/tests/schema/09_knowledge_source_slug_unique.sql');

describe('#33 — knowledge_items (source_slug, locale) structural dedup', () => {
  it('the SoT index is a partial UNIQUE on (source_slug, locale) WHERE source_slug IS NOT NULL', () => {
    expect(INDEX.length, 'index SoT file must exist').toBeGreaterThan(0);
    expect(INDEX).toMatch(/CREATE UNIQUE INDEX idx_knowledge_items_source_slug_locale_unique/);
    expect(INDEX).toMatch(/\(source_slug, locale\)/);
    expect(INDEX).toMatch(/WHERE \(source_slug IS NOT NULL\)/);
    // must NOT be a bare UNIQUE(source_slug) — that would forbid legitimate Brick4 locale variants
    expect(INDEX).not.toMatch(/USING btree \(source_slug\)\s+WHERE/);
  });

  it('heals.sql collapses pre-existing (source_slug, locale) dups BEFORE creating the unique', () => {
    const healIdx = HEALS.indexOf('heal #33');
    expect(healIdx, 'heal #33 block present in heals.sql').toBeGreaterThan(0);
    const collapseIdx = HEALS.indexOf('PARTITION BY source_slug, locale', healIdx);
    const irIdx = HEALS.indexOf('idx_knowledge_items_source_slug_locale_unique', healIdx);
    expect(collapseIdx, 'dup-collapse present').toBeGreaterThan(healIdx);
    expect(irIdx, 'index applied AFTER the collapse').toBeGreaterThan(collapseIdx);
    // FK-ordered delete: embeddings -> chunks -> items (no orphan dependents)
    const e = HEALS.indexOf('DELETE FROM public.knowledge_embeddings', healIdx);
    const c = HEALS.indexOf('DELETE FROM public.knowledge_chunks', healIdx);
    const i = HEALS.indexOf('DELETE FROM public.knowledge_items', healIdx);
    expect(e, 'deletes embeddings first').toBeGreaterThan(healIdx);
    expect(c, 'then chunks').toBeGreaterThan(e);
    expect(i, 'then items').toBeGreaterThan(c);
  });

  it('the regenerated baseline carries the unique index', () => {
    expect(BASELINE).toMatch(/CREATE UNIQUE INDEX idx_knowledge_items_source_slug_locale_unique/);
  });

  it('the pgTAP runtime contract exists (reject dup / allow locale variant / allow NULL slug)', () => {
    expect(PGTAP).toMatch(/SELECT plan\(4\)/);
    expect(PGTAP).toMatch(/throws_ok/);
    expect(PGTAP).toMatch(/locale variant/);
  });
});
