/**
 * Gate: Brick5 cross-lingual retrieval (#26 — v3).
 *
 * Locks the SoT for the locale-aware retrieval capability:
 *   - source_concept_id column + trigger (source-node identity = COALESCE(source_id, id));
 *   - v3 p_locale as a preference-BOOST in the rerank (never a hard locale filter — the
 *     HARD invariant: cross-lingual fallback must survive);
 *   - v3 variant-dedup by source_concept_id, COALESCE-robust to a NULL concept;
 *   - heals.sql backfill for existing DBs.
 * Runtime proof lives in aisha/db/tests/schema/10_knowledge_cross_lingual.sql.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => {
  const fp = path.join(ROOT, rel);
  return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
};

const TABLE = read('aisha/db/sql/tables/knowledge_items.sql');
const TRIGFN = read('aisha/db/sql/functions/set_knowledge_source_concept_id.sql');
const TRIG = read('aisha/db/sql/triggers/trg_knowledge_source_concept_id.sql');
const V3 = read('aisha/db/sql/functions/mcp_search_knowledge_v3.sql');
const HEALS = read('aisha/db/heals.sql');
const PGTAP = read('aisha/db/tests/schema/10_knowledge_cross_lingual.sql');

describe('#26 Brick5 — cross-lingual retrieval (v3)', () => {
  it('source_concept_id column + trigger = source-node identity COALESCE(source_id, id)', () => {
    expect(TABLE).toMatch(/ADD COLUMN IF NOT EXISTS source_concept_id uuid/);
    expect(TRIGFN).toMatch(/COALESCE\(NEW\.source_id, NEW\.id\)/);
    expect(TRIG).toMatch(/BEFORE INSERT OR UPDATE OF source_id ON public\.knowledge_items/);
  });

  it('v3 takes p_locale as a rerank preference-boost (a distance term, not a hard filter)', () => {
    expect(V3).toMatch(/p_locale text DEFAULT NULL/);
    // the boost is subtracted from the cosine distance on a locale match (rerank), and it
    // lives in the s_eff_dist expression — not in a WHERE clause.
    expect(V3).toMatch(/CASE WHEN p_locale IS NOT NULL AND kc\.locale = p_locale THEN c_locale_boost ELSE 0 END AS s_eff_dist/);
  });

  it('v3 dedups by source_concept_id and is COALESCE-robust to a NULL concept', () => {
    expect(V3).toMatch(/DISTINCT ON \(s_concept\)/);
    expect(V3).toMatch(/COALESCE\(ki\.source_concept_id, ki\.id\) AS s_concept/);
  });

  it('heals.sql backfills source_concept_id for existing DBs', () => {
    expect(HEALS).toMatch(/heal brick5/);
    expect(HEALS).toMatch(/source_concept_id = COALESCE\(source_id, id\)/);
  });

  it('pgTAP proves dedup + locale boost + no-regression + NULL-robustness', () => {
    expect(PGTAP).toMatch(/SELECT plan\(5\)/);
    expect(PGTAP).toMatch(/collapse to a single winning row/);
    expect(PGTAP).toMatch(/p_locale=cs boosts the cs variant/);
  });
});
