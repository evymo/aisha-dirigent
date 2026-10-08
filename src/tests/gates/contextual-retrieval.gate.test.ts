/**
 * Contextual retrieval gate (Step 1 of retrieval optimization plan 2026).
 *
 * Static verification that the Anthropic contextual retrieval pattern is
 * wired end-to-end:
 *   - Migration creates contextual_prefix + 4 metadata columns + partial idx
 *   - fn_enrich_chunk_context_audited has canonical security + audit pattern
 *     AND invalidates the existing embedding (DELETE FROM knowledge_embeddings
 *     WHERE chunk_id = …) so the next embed pass uses the prefix as input
 *   - fn_get_chunks_needing_context provides the worker pickup queue
 *   - SoT mirror files exist (rpc-sql-mapping gate compliance)
 *   - svc-mcp-knowledge worker generates prefix in Phase A before Phase B embed
 *   - n8n WF_CHUNK_CONTEXT_BACKFILL workflow scheduled + service-role auth
 *
 * Runtime measurement (faithfulness delta vs Step 0 baseline) is enforced by
 * src/tests/regression/rag_baseline.regression.test.ts once a baseline is
 * pinned post-Step-0 nightly batches.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ⛔ PŘEPSÁNO 2026-09-19: servisní autentizace uzlu je POVĚŘENÍ „AISHA Gateway
 * (Service Role)" (Authorization: Bearer POSTGREST_SERVICE_TOKEN, zakládá ho
 * provision-credentials), ne `$env.POSTGREST_SERVICE_TOKEN` v hlavičce — to n8n
 * neslo jako tajemství v prostém env a uzel s autentizací bez pověření padal na
 * „Credentials not found" (brána n8n-uzly-autentizace-pres-povereni).
 */
function uzelVolaSeServisnimPoverenim(raw: string, cesta: RegExp): boolean {
  const wf = JSON.parse(raw) as { nodes: Array<{ parameters?: { url?: unknown }; credentials?: Record<string, { name?: string }> }> };
  return wf.nodes.some(
    (n) => cesta.test(String(n.parameters?.url ?? "")) && n.credentials?.httpHeaderAuth?.name === "AISHA Gateway (Service Role)",
  );
}

const ROOT = process.cwd();

const MIGRATION       = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const SOT_GET         = resolve(ROOT, 'aisha/db/sql/functions/fn_get_chunks_needing_context.sql');
const SOT_ENRICH      = resolve(ROOT, 'aisha/db/sql/functions/fn_enrich_chunk_context_audited.sql');
const PREFIX_LIB      = resolve(ROOT, 'services/svc-mcp-knowledge/src/lib/contextual-prefix.ts');
const WORKER_ROUTE    = resolve(ROOT, 'services/svc-mcp-knowledge/src/routes/knowledge-embeddings.ts');
const BACKFILL_WF     = resolve(ROOT, 'n8n/workflows/WF_CHUNK_CONTEXT_BACKFILL.json');

describe('Contextual retrieval gate (Step 1)', () => {

  describe('Migration', () => {
    test('migration file exists', () => {
      expect(existsSync(MIGRATION), `Missing migration: ${MIGRATION}`).toBe(true);
    });

    test('knowledge_chunks SoT declares the 5 contextual_prefix tracking columns', () => {
      // The migration's ALTER…ADD COLUMNs were folded into the table SoT's final
      // CREATE TABLE (chronological end-state). Assert the columns persist there.
      const sql = readFileSync(resolve(ROOT, 'aisha/db/sql/tables/knowledge_chunks.sql'), 'utf-8');
      expect(sql).toMatch(/contextual_prefix\s+text/);
      expect(sql).toMatch(/contextual_prefix_model\s+text/);
      expect(sql).toMatch(/contextual_prefix_model_version\s+text/);
      expect(sql).toMatch(/contextual_prefix_generated_at\s+timestamp/);
      expect(sql).toMatch(/contextual_prefix_token_count\s+integer/);
    });

    test('SoT declares the partial backfill index (WHERE contextual_prefix IS NULL)', () => {
      const sql = readFileSync(resolve(ROOT, 'aisha/db/sql/indexes/idx_knowledge_chunks_needs_prefix.sql'), 'utf-8');
      expect(sql).toMatch(/CREATE INDEX\s+(CONCURRENTLY\s+)?(IF NOT EXISTS\s+)?idx_knowledge_chunks_needs_prefix/);
      expect(sql).toMatch(/WHERE\s*\(?\s*contextual_prefix IS NULL/);
    });

    test('creates fn_get_chunks_needing_context with security pattern', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_get_chunks_needing_context/);
      // Hlavička TÉTO funkce (po `AS $$`), ne celá baseline — tu by splnila kterákoli jiná funkce.
      // Tvar cesty hlídá domovská brána definer-search-path; tady jen to, že cesta připnutá JE.
      const hlavicka = (sql.split(/CREATE OR REPLACE FUNCTION public\.fn_get_chunks_needing_context/)[1] ?? '').split(/\nAS \$\$/)[0];
      expect(hlavicka).toMatch(/SECURITY DEFINER/);
      expect(hlavicka).toMatch(/SET search_path TO /);
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fn_get_chunks_needing_context.*FROM PUBLIC/);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_get_chunks_needing_context.*TO service_role/);
    });

    test('creates fn_enrich_chunk_context_audited with security + audit pattern', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_enrich_chunk_context_audited/);
      expect(sql).toMatch(/SECURITY DEFINER/);
      expect(sql).toMatch(/SET search_path TO 'public'/);
      expect(sql).toMatch(/INSERT INTO public\.audit_journal/);
      expect(sql).toMatch(/'knowledge\.chunk_context_enriched'/);
    });

    test('fn_enrich_chunk_context_audited INVALIDATES the existing embedding', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      // Contract: when prefix changes, the cached embedding (computed without
      // the prefix) is wrong. Migration must delete the orphan so the next
      // embedding worker pass recomputes over {prefix} {chunk_text}.
      expect(sql).toMatch(/DELETE FROM public\.knowledge_embeddings\s+WHERE chunk_id = p_chunk_id/);
    });

    test('RPCs enforce auth + reject anon (no anon GRANT)', () => {
      const sql = readFileSync(MIGRATION, 'utf-8');
      const authChecks = (sql.match(/auth\.uid\(\) IS NULL AND current_setting\('role', true\) != 'service_role'/g) || []).length;
      expect(authChecks, 'every RPC must guard against unauthenticated callers').toBeGreaterThanOrEqual(2);
      // No anon GRANTs — contextual prefix work is service-role only
      expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_(get_chunks_needing_context|enrich_chunk_context_audited)[^;]*TO anon/);
    });
  });

  describe('SoT mirror files (rpc-sql-mapping gate compliance)', () => {
    test('fn_get_chunks_needing_context SoT exists', () => {
      expect(existsSync(SOT_GET), `Missing SoT: ${SOT_GET}`).toBe(true);
    });
    test('fn_enrich_chunk_context_audited SoT exists', () => {
      expect(existsSync(SOT_ENRICH), `Missing SoT: ${SOT_ENRICH}`).toBe(true);
    });
  });

  describe('Worker integration (Phase A: prefix → Phase B: embed)', () => {
    test('contextual-prefix.ts lib exists', () => {
      expect(existsSync(PREFIX_LIB), `Missing lib: ${PREFIX_LIB}`).toBe(true);
    });

    test('lib uses deterministic generation (temperature=0)', () => {
      const code = readFileSync(PREFIX_LIB, 'utf-8');
      expect(code).toMatch(/temperature:\s*0/);
    });

    test('lib returns null on LLM failure (caller falls back to raw chunk_text)', () => {
      const code = readFileSync(PREFIX_LIB, 'utf-8');
      expect(code).toMatch(/return null/);
      // The graceful-degradation contract is part of the API doc
      expect(code).toMatch(/LlmCompletionError/);
    });

    test('worker imports generateContextualPrefix and feeds it into embedding input', () => {
      const code = readFileSync(WORKER_ROUTE, 'utf-8');
      expect(code).toMatch(/import \{[^}]*generateContextualPrefix[^}]*\} from ['"]\.\.\/lib\/contextual-prefix\.js['"]/);
      // Phase B: embedding input must use the prefix when present
      expect(code).toMatch(/\$\{p\.prefix\} \$\{c\.chunk_text\}/);
    });

    test('worker calls fn_enrich_chunk_context_audited (audited persist of prefix)', () => {
      const code = readFileSync(WORKER_ROUTE, 'utf-8');
      expect(code).toMatch(/fn_enrich_chunk_context_audited/);
    });

    test('worker honors RAG_PREFIX_ENABLED env hatch (graceful disable)', () => {
      const code = readFileSync(WORKER_ROUTE, 'utf-8');
      expect(code).toMatch(/RAG_PREFIX_ENABLED/);
    });

    test('worker exposes /embeddings/contextual-backfill route', () => {
      const code = readFileSync(WORKER_ROUTE, 'utf-8');
      expect(code).toMatch(/['"]\/embeddings\/contextual-backfill['"]/);
    });
  });

  describe('n8n WF_CHUNK_CONTEXT_BACKFILL', () => {
    test('workflow file exists', () => {
      expect(existsSync(BACKFILL_WF), `Missing workflow: ${BACKFILL_WF}`).toBe(true);
    });

    test('runs on weekly schedule', () => {
      const json = JSON.parse(readFileSync(BACKFILL_WF, 'utf-8'));
      const trigger = json.nodes.find((n: { type: string }) => n.type === 'n8n-nodes-base.scheduleTrigger');
      expect(trigger, 'workflow must have schedule trigger').toBeTruthy();
      expect(trigger.parameters?.rule?.interval?.[0]?.field).toBe('weeks');
    });

    test('calls /embeddings/contextual-backfill with service-role auth', () => {
      const raw = readFileSync(BACKFILL_WF, 'utf-8');
      expect(raw).toMatch(/embeddings\/contextual-backfill/);
      expect(uzelVolaSeServisnimPoverenim(raw, /embeddings\/contextual-backfill/)).toBe(true);
    });

    test('emits audit via log_integration_action with knowledge.context_backfill_completed', () => {
      const raw = readFileSync(BACKFILL_WF, 'utf-8');
      expect(raw).toMatch(/rpc\/log_integration_action/);
      expect(raw).toMatch(/knowledge\.context_backfill_completed/);
    });
  });
});
