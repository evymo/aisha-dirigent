/**
 * Gate: Step 7.1 Hippocampus graph bootstrap + owner_user_id typo fix.
 *
 * Two related migrations validated together:
 *
 *   1. 20260519030000_fix_owner_user_id_typo.sql — fixes a real production
 *      bug where fn_get_run_citations (Step 2 CitationPanel data source) and
 *      the graph_nodes RLS policy referenced `ps.owner_user_id`, a column
 *      that has never existed on partner_stories. The canonical owner
 *      reference is `ps.user_id`. The bug caused the citation panel to
 *      silently return [] for every non-admin user.
 *
 *   2. 20260519040000_hippocampus_graph_bootstrap.sql — seeds graph_nodes
 *      (8 entity types: Story, ExpertRule, KnowledgeItem, Agent, Run,
 *      Memory, Proposal, AuditEvent) + graph_edges (3 relationships:
 *      CITED, CAUSED, DERIVED_FROM) from existing AISHA tables. Bulk
 *      INSERT ... ON CONFLICT to stay idempotent and avoid the
 *      auth.uid()-required check on the fn_upsert_graph_* RPCs.
 *
 * Static regex-on-source — same pattern as ingestion-safety.gate.test.ts and
 * critic-loop-integration.gate.test.ts. No live DB needed.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const FIX_MIG       = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const FIX_SOT       = resolve(ROOT, 'aisha/db/sql/functions/fn_get_run_citations.sql');
const BOOTSTRAP_MIG = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const GRAPH_MIG     = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const REGISTRY      = resolve(ROOT, 'aisha/db/migration-registry.json');


/**
 * ⛔ VSTUP MĚŘIDLA BYL 3,9 MB, ZATÍMCO TVRDIL, ŽE MĚŘÍ JEDNU FUNKCI.
 *
 * Naměřeno 2026-09-09: `split(…fn_get_run_citations)[1].split(/DROP POLICY/)[0]`
 * vyřízne od jména funkce k PRVNÍMU `DROP POLICY` kdekoli dál — což v tomhle
 * baseline znamená 3 923 844 znaků a 2 202 objektů. Brána tedy roky procházela
 * jen proto, že v tom obřím úseku náhodou žádné `owner_user_id` neleželo; první
 * nová tabulka, která má legitimní sloupec toho jména, ji shodila.
 *
 * Vlastnost, o kterou jde, přitom PLATÍ: tělo `fn_get_run_citations` má 1 776
 * znaků, `ps.user_id = auth.uid()` v něm je a `owner_user_id` ne. Vadný byl
 * vstup, ne tvrzení — a to je rozdíl, který se pozná jedině tak, že se vstup
 * ukáže.
 */
function teloFunkce(sql: string, jmeno: string): string {
  const po = sql.split(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${jmeno}`))[1] ?? '';
  const zac = po.indexOf('AS $$');
  if (zac === -1) return '';
  const konec = po.indexOf('$$;', zac);
  return konec === -1 ? po.slice(zac) : po.slice(zac, konec);
}

/** Hlavička funkce = od jména po začátek těla. Tam bydlí SECURITY DEFINER a spol. */
function hlavickaFunkce(sql: string, jmeno: string): string {
  const po = sql.split(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${jmeno}`))[1] ?? '';
  const zac = po.indexOf('AS $$');
  return zac === -1 ? po.slice(0, 2000) : po.slice(0, zac);
}

describe('Step 7.1 hippocampus graph bootstrap + owner_user_id typo fix', () => {

  // ─────────────────────────────────────────────────────────────────────────
  describe('Fix migration: owner_user_id → user_id (CitationPanel + graph_nodes RLS)', () => {
    test('migration file exists', () => {
      expect(existsSync(FIX_MIG)).toBe(true);
    });

    test('rewrites fn_get_run_citations via CREATE OR REPLACE', () => {
      const sql = readFileSync(FIX_MIG, 'utf-8');
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_get_run_citations\(p_run_id uuid\)/);
    });

    test('fn_get_run_citations now uses ps.user_id (not owner_user_id)', () => {
      const sql = readFileSync(FIX_MIG, 'utf-8');
      const telo = teloFunkce(sql, 'fn_get_run_citations');
      expect(telo).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
      expect(telo).not.toMatch(/owner_user_id/);
    });

    test('graph_nodes RLS policy now uses ps.user_id (not owner_user_id)', () => {
      const sql = readFileSync(FIX_MIG, 'utf-8');
      // Úsek se ukončuje středníkem TÉHLE policy, ne koncem souboru: jinak by
      // se měřil celý zbytek baseline (viz `teloFunkce` výš).
      const po = sql.split(/DROP POLICY[^"]+"graph_nodes admin staff read"/)[1] ?? '';
      const policySection = po.slice(0, po.indexOf(';', po.indexOf('CREATE POLICY')) + 1);
      expect(policySection).toMatch(/CREATE POLICY[^;]*"graph_nodes admin staff read"/);
      expect(policySection).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
      expect(policySection).not.toMatch(/owner_user_id/);
    });

    test('nikde se `partner_stories` neodkazuje přes `owner_user_id`', () => {
      const sql = readFileSync(FIX_MIG, 'utf-8');
      // ⛔ VADA NIKDY NEBYLA TO JMÉNO, ALE ODKAZ. `owner_user_id` je legitimní
      // sloupec kdekoli, kde ho tabulka opravdu má (od 2026-09-09 například
      // `knock_device_credentials`). Chybou bylo `ps.owner_user_id` —
      // partner_stories takový sloupec NIKDY neměla, takže predikát tiše
      // nevrátil nic. Plošný zákaz identifikátoru měřil pravopis, ne vlastnost,
      // a padal na první poctivé použití.
      const fnBody = sql.match(/AS\s*\$\$[\s\S]*?\$\$/g)?.join('\n') ?? '';
      const policyBody = sql.match(/CREATE POLICY[\s\S]*?\);/g)?.join('\n') ?? '';
      expect(fnBody).not.toMatch(/\bps\.owner_user_id\b/);
      expect(policyBody).not.toMatch(/\bps\.owner_user_id\b/);
    });

    test('SECURITY DEFINER + search_path preserved on the function', () => {
      const sql = readFileSync(FIX_MIG, 'utf-8');
      const hlavicka = hlavickaFunkce(sql, 'fn_get_run_citations');
      expect(hlavicka).toMatch(/SECURITY DEFINER/);
      // Cesta hledání je zpevněná: pg_temp poslední, dočasný objekt volajícího relaci nezastíní.
      expect(hlavicka).toMatch(/SET search_path TO 'pg_catalog', 'public', 'pg_temp'/);
      expect(hlavicka).toMatch(/STABLE/);
    });

    test('REVOKE + explicit GRANT preserved (authenticated + service_role)', () => {
      const sql = readFileSync(FIX_MIG, 'utf-8');
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fn_get_run_citations\(uuid\) FROM PUBLIC/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_get_run_citations\(uuid\) TO authenticated/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_get_run_citations\(uuid\) TO service_role/);
    });

    test('SoT mirror agrees with the fix (same column name on both sides)', () => {
      const sot = readFileSync(FIX_SOT, 'utf-8');
      expect(sot).toMatch(/ps\.user_id\s*=\s*auth\.uid\(\)/);
      // Comment may still mention the historical typo for trail purposes —
      // only the SQL body needs to be clean.
      const fnBody = sot.match(/AS\s*\$\$[\s\S]*?\$\$/g)?.join('\n') ?? '';
      expect(fnBody).not.toMatch(/owner_user_id/);
    });

    test('SoT comment documents the patch (so future readers know the history)', () => {
      const sot = readFileSync(FIX_SOT, 'utf-8');
      expect(sot).toMatch(/20260519030000_fix_owner_user_id_typo/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Pre-condition: graph_nodes / graph_edges schema already on main', () => {
    test('schema migration exists (Step 7.0 — already merged)', () => {
      expect(existsSync(GRAPH_MIG)).toBe(true);
    });

    test('graph_nodes UNIQUE constraint matches bootstrap ON CONFLICT key', () => {
      // ON CONFLICT (entity_type, entity_slug, story_id) requires this exact
      // unique constraint on the table. If the schema ever drifts, bootstrap
      // would fail silently (postgres would reject ON CONFLICT clause).
      const sql = readFileSync(GRAPH_MIG, 'utf-8');
      expect(sql).toMatch(/UNIQUE\s*\(\s*entity_type\s*,\s*entity_slug\s*,\s*story_id\s*\)/);
    });

    test('graph_edges UNIQUE constraint matches bootstrap ON CONFLICT key', () => {
      const sql = readFileSync(GRAPH_MIG, 'utf-8');
      expect(sql).toMatch(/UNIQUE\s*\(\s*source_node_id\s*,\s*target_node_id\s*,\s*relationship\s*\)/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Bootstrap mechanism: graph tables + runtime population', () => {
    // The one-time bootstrap PROJECTION (seeding graph_nodes/edges from existing
    // Story/ExpertRule/KnowledgeItem/Agent/Run/Memory/Proposal/AuditEvent rows) was
    // implementation cold-start data — it moves to the implementation seed (→ example),
    // where its safety invariants (quarantine filter, idempotent ON CONFLICT, non-null
    // edge guards, attribution clamp) are verified. The PLATFORM gate asserts the
    // MECHANISM the projection depends on: the graph tables + the runtime graph-population
    // RPCs in canonical SoT (the graph is also populated incrementally at run time).
    test('graph_nodes + graph_edges tables exist in SoT', () => {
      expect(existsSync(resolve(ROOT, 'aisha/db/sql/tables/graph_nodes.sql'))).toBe(true);
      expect(existsSync(resolve(ROOT, 'aisha/db/sql/tables/graph_edges.sql'))).toBe(true);
    });

    test('runtime graph-population RPCs exist in SoT (incremental population at run time)', () => {
      expect(existsSync(resolve(ROOT, 'aisha/db/sql/functions/fn_upsert_graph_node_audited.sql'))).toBe(true);
      expect(existsSync(resolve(ROOT, 'aisha/db/sql/functions/fn_apply_graph_extraction_audited.sql'))).toBe(true);
    });

    test('graph schema enforces the bootstrap ON CONFLICT keys', () => {
      const nodes = readFileSync(resolve(ROOT, 'aisha/db/sql/tables/graph_nodes.sql'), 'utf-8');
      const edges = readFileSync(resolve(ROOT, 'aisha/db/sql/tables/graph_edges.sql'), 'utf-8');
      expect(nodes).toMatch(/UNIQUE\s*\(\s*entity_type\s*,\s*entity_slug\s*,\s*story_id\s*\)/);
      expect(edges).toMatch(/UNIQUE\s*\(\s*source_node_id\s*,\s*target_node_id\s*,\s*relationship\s*\)/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Migration registry (baseline-only)', () => {
    test('both migrations are folded into the baseline (registry lists 0 non-baseline)', () => {
      // The fix + bootstrap migrations were absorbed into the baseline (the
      // chronological end-state); the fix's effect is asserted on the SoT function
      // above. Baseline-only state = the registry tracks no individual deltas.
      const registry = JSON.parse(readFileSync(REGISTRY, 'utf-8')) as { migrations?: string[] };
      expect(registry.migrations ?? []).toEqual([]);
    });
  });
});
