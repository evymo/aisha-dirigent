/**
 * Gate test: RAG eval measurability foundation (Brick0/1).
 *
 * The RAG eval scorer can only measure retrieval quality if (a) the golden set is
 * actually labelled with expected source slugs, (b) the labels match retrieved slugs
 * robustly, and (c) the authoritative corpus the questions ask about is actually
 * retrievable. This gate locks all three against the committed SoT:
 *
 *   - rag_eval_golden seed carries non-empty expected_chunk_slugs on a meaningful
 *     subset (the all-'{}' default made every eval unscored / insufficient_data).
 *   - the set-based scorer matches item-level labels (a bare source_slug counts for
 *     any of its chunks) — robust to re-chunking, not brittle chunk-index equality.
 *   - the expert_rules → knowledge_items mirror fires on CREATE (AFTER INSERT OR
 *     UPDATE) and its upsert conflict target matches the locale-widened unique index
 *     — two stacked bugs that kept 27 authoritative rules out of the RAG corpus.
 *
 * Runtime proof that the mirror actually populates lives in the pgTAP suite
 * aisha/db/tests/schema/08_expert_rule_mirror.sql (cold-start gate).
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

const GOLDEN = read('aisha/db/seed/core/31_rag_eval_golden.sql');
const KNOWLEDGE = read('aisha/db/seed/core/21_aisha_knowledge.sql');
const SCORER = read('services/svc-mcp-knowledge/src/lib/rag-eval-judges.ts');
const METRICS = read('services/svc-mcp-knowledge/src/lib/rag-retrieval-metrics.ts');
const TRIGGER = read('aisha/db/sql/triggers/trg_sync_expert_rule_to_knowledge.sql');
const SYNC = read('aisha/db/sql/functions/sync_expert_rule_to_knowledge_item.sql');
const BASELINE = read('aisha/db/migrations/00000000000000_baseline.sql');
const PGTAP = read('aisha/db/tests/schema/08_expert_rule_mirror.sql');

describe('Brick0/1 — rag_eval_golden is labelled (not all-empty)', () => {
  it('labels 20 of 24 rows with expected_chunk_slugs; exactly 4 (judge-only) stay empty', () => {
    expect(GOLDEN.length, 'golden seed must exist').toBeGreaterThan(0);
    // label arrays point at real corpus slugs (all 'aisha-…'); tag arrays do not — so
    // counting ARRAY['aisha-…'] isolates the expected_chunk_slugs labels from tag arrays.
    const labelled = (GOLDEN.match(/ARRAY\['aisha-/g) ?? []).length;
    expect(labelled, 'labels must not regress below the 20 set-based rows').toBeGreaterThanOrEqual(20);
    // the only rows allowed to stay empty are the 4 planning_heavy judge-only questions.
    const empties = (GOLDEN.match(/'\{\}'::text\[\]/g) ?? []).length;
    expect(empties, 'only the 4 judge-only planning_heavy rows may be empty').toBe(4);
  });

  it('the labelled rows reference real seeded slugs (spot-check the rule mappings)', () => {
    // These slugs must be present as labels (they are real expert_rule / engineering-doc
    // source_slugs; the runtime orphan check lives in the pgTAP).
    for (const slug of [
      'aisha-rpc-only-pattern',
      'aisha-hooks-patterns',
      'aisha-migration-workflow',
      'aisha-security-definer-pattern',
      'aisha-audit-journal-pattern',
      'aisha-enterprise-source-onboarding',
      // platform docs (cl-*) + existing rules the es-* rows now point at
      'aisha-platform-overview',
      'aisha-deploy-flow-overview',
      'aisha-code-hygiene',
      'aisha-commit-workflow',
    ]) {
      expect(GOLDEN, `golden should label a question with ${slug}`).toContain(`'${slug}'`);
    }
  });

  it('documents the judge-only rows + every label resolves to a real corpus item', () => {
    // The 4 remaining empties are planning_heavy judge-only by design, documented in-file.
    expect(GOLDEN).toMatch(/LABEL COVERAGE STATUS/);
    expect(GOLDEN).toMatch(/JUDGE-ONLY/);
    // Label↔corpus consistency: every platform doc a cl-* row points at MUST exist in the
    // corpus seed. An orphan label (one retrieval can never satisfy) is worse than an
    // honest empty — it would make a question permanently unscorable while looking covered.
    for (const slug of [
      'aisha-platform-overview',
      'aisha-story-concept',
      'aisha-agents-vs-rules',
      'aisha-deploy-flow-overview',
    ]) {
      expect(KNOWLEDGE, `corpus seed must contain the labelled doc ${slug}`).toContain(`'${slug}'`);
    }
  });
});

describe('Brick0/1 — scorer does item-level set-based matching', () => {
  // ⛔ 2026-09-13: definice slugMatches se přesunula do rag-retrieval-metrics.ts, protože
  // rank-aware skóre (scoreRetrieval → nDCG, podle kterého fn_compare_rag_embedding_models
  // vybírá vítěze) porovnávalo PŘESNĚ a v3 chunk_slug `<položka>:<index>` s labelem položky
  // nikdy neshodlo (nDCG 0 pro každý model). Jedna definice pro obě metriky; tvrzení
  // zůstává stejné, jen míří tam, kde definice žije, a přidává druhého konzumenta.
  it('defines slugMatches once and routes set-based AND rank-aware metrics through it', () => {
    expect(SCORER.length, 'scorer SoT must exist').toBeGreaterThan(0);
    expect(METRICS.length, 'retrieval metrics SoT must exist').toBeGreaterThan(0);
    expect(METRICS).toMatch(/export function slugMatches\(retrievedSlug: string, expectedSlug: string\): boolean/);
    // item-level: split on the last ':' and compare the source part.
    expect(METRICS).toMatch(/lastIndexOf\(':'\)/);
    // the judges module keeps exporting it (existing imports) — from the single definition.
    expect(SCORER).toMatch(/import \{ slugMatches \} from '\.\/rag-retrieval-metrics\.js';/);
    expect(SCORER).toMatch(/export \{ slugMatches \};/);
    expect(SCORER, 'no second definition').not.toMatch(/function slugMatches\(/);
    // both set-based metrics use the matcher, not raw Set.has on the full slug.
    expect(SCORER).toMatch(/expectedSlugs\.some\(\(e\) => slugMatches\(r, e\)\)/);
    expect(SCORER).toMatch(/retrievedSlugs\.some\(\(r\) => slugMatches\(r, e\)\)/);
    // rank-aware scoring matches through it too (not expected.has(slug) on the chunk slug).
    expect(METRICS).toMatch(/const slug = matchExpected\(retrievedSlug, expected\);/);
    expect(METRICS).toMatch(/if \(slugMatches\(retrieved, e\)\) return e;/);
  });
});

describe('Brick0/1 — expert_rules reach the RAG corpus (the corpus fix)', () => {
  it('the sync trigger fires on CREATE as well as edit (AFTER INSERT OR UPDATE)', () => {
    expect(TRIGGER.length, 'trigger SoT must exist').toBeGreaterThan(0);
    expect(TRIGGER).toMatch(/AFTER INSERT OR UPDATE ON public\.expert_rules/);
    // the old INSERT-blind form must be gone.
    expect(TRIGGER).not.toMatch(/AFTER UPDATE ON public\.expert_rules\b/);
  });

  it("the upsert conflict target matches the locale-widened unique (Brick4 regression fix)", () => {
    expect(SYNC.length, 'sync fn SoT must exist').toBeGreaterThan(0);
    expect(SYNC).toMatch(/ON CONFLICT \(source_type, source_id, locale\) WHERE source_type = 'guild_db'/);
    // the row carries a locale so the conflict key has a value.
    expect(SYNC).toMatch(/'global',\s*--/);
  });

  it('the regenerated baseline carries both fixes', () => {
    expect(BASELINE.length, 'baseline must exist').toBeGreaterThan(0);
    expect(BASELINE).toMatch(/AFTER INSERT OR UPDATE ON public\.expert_rules/);
    expect(BASELINE).toMatch(/ON CONFLICT \(source_type, source_id, locale\) WHERE source_type = 'guild_db'/);
  });
});

describe('Brick0/1 — pgTAP runtime proof exists', () => {
  it('08_expert_rule_mirror.sql proves an inserted expert_rule mirrors into the corpus', () => {
    expect(PGTAP.length, 'pgTAP suite must exist').toBeGreaterThan(0);
    expect(PGTAP).toMatch(/SELECT plan\(\d+\)/);
    expect(PGTAP).toMatch(/INSERT INTO public\.expert_rules/);
    expect(PGTAP).toMatch(/item_type = 'expert_rule'/);
  });
});
