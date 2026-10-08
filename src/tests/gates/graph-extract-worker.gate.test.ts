/**
 * Gate: Step 7.2 Hippocampus graph extraction worker.
 *
 * Validates the 4-piece feature locks in cleanly:
 *
 *   1. Migration 20260520040000_graph_extraction_worker.sql exposes the
 *      3 expected RPCs with correct signatures, SECURITY DEFINER, search_path,
 *      REVOKE/GRANT pattern.
 *
 *   2. SoT mirrors exist in aisha/db/sql/functions/ for all 3 RPCs.
 *
 *   3. Lib services/svc-mcp-knowledge/src/lib/graph-extract.ts exports
 *      the prompt + parser + relationship enum and the parser is strict.
 *
 *   4. Route services/svc-mcp-knowledge/src/routes/graph-extract.ts:
 *      service-role guard, capability-resolver call for rag.graph_extract,
 *      uses fn_apply_graph_extraction_audited.
 *
 *   5. n8n workflow WF_GRAPH_EXTRACT_NIGHTLY.json: 03:30 cron, hits
 *      /graph/extract/run, writes audit via log_integration_action.
 *
 * Static regex-on-source (same pattern as ingestion-safety.gate.test.ts).
 * No live DB, no live LLM, no live n8n.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseGraphExtractJson,
  ALLOWED_RELATIONSHIPS,
  buildGraphExtractUserPrompt,
  GRAPH_EXTRACT_SYSTEM,
} from '../../../services/svc-mcp-knowledge/src/lib/graph-extract.js';

const ROOT = process.cwd();
const MIG       = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const SOT_DISCO = resolve(ROOT, 'aisha/db/sql/functions/fn_get_runs_needing_graph_extract.sql');
const SOT_CTX   = resolve(ROOT, 'aisha/db/sql/functions/fn_get_run_extract_context.sql');
const SOT_APPLY = resolve(ROOT, 'aisha/db/sql/functions/fn_apply_graph_extraction_audited.sql');
const LIB       = resolve(ROOT, 'services/svc-mcp-knowledge/src/lib/graph-extract.ts');
const ROUTE     = resolve(ROOT, 'services/svc-mcp-knowledge/src/routes/graph-extract.ts');
const SERVER    = resolve(ROOT, 'services/svc-mcp-knowledge/src/server.ts');
const N8N       = resolve(ROOT, 'n8n/workflows/WF_GRAPH_EXTRACT_NIGHTLY.json');
const REGISTRY  = resolve(ROOT, 'aisha/db/migration-registry.json');
const GRAPH_MIG = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');

describe('Step 7.2 graph extraction worker', () => {

  // ─────────────────────────────────────────────────────────────────────────
  describe('Migration: 3 RPCs with correct contract', () => {
    test('graph extraction worker is folded into the baseline (baseline-only)', () => {
      expect(existsSync(MIG)).toBe(true);
      const registry = JSON.parse(readFileSync(REGISTRY, 'utf-8')) as { migrations?: string[] };
      expect(registry.migrations ?? []).toEqual([]);
    });

    const RPCS: Array<[name: string, sigSuffix: string]> = [
      ['fn_get_runs_needing_graph_extract',     '(integer, integer)'],
      ['fn_get_run_extract_context',            '(uuid)'],
      ['fn_apply_graph_extraction_audited',     '(uuid, jsonb, text)'],
    ];

    for (const [fn, sig] of RPCS) {
      test(`${fn}: CREATE OR REPLACE present`, () => {
        const sql = readFileSync(MIG, 'utf-8');
        const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`);
        expect(sql, `${fn} CREATE OR REPLACE not found`).toMatch(re);
      });

      test(`${fn}: SECURITY DEFINER + search_path 'public'`, () => {
        const sql = readFileSync(MIG, 'utf-8');
        // Slice the section between this function's CREATE and the next REVOKE/GRANT block.
        const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`);
        const next  = sql.indexOf(`REVOKE ALL ON FUNCTION public.${fn}`, start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(next).toBeGreaterThan(start);
        const section = sql.slice(start, next);
        expect(section).toMatch(/SECURITY DEFINER/);
        // Tady jen to, že cesta hledání JE připnutá. Její tvar (pg_temp poslední) má jeden
        // domov — bránu definer-search-path; starý tvar tu vyžadovat nesmí žádná brána.
        expect(section).toMatch(/SET search_path TO /);
      });

      test(`${fn}: REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO service_role`, () => {
        const sql = readFileSync(MIG, 'utf-8');
        const escSig = sig.replace(/[()]/g, (c) => `\\${c}`);
        const revoke = new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}${escSig} FROM PUBLIC`);
        const grant  = new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}${escSig} TO service_role`);
        expect(sql, `${fn} REVOKE missing`).toMatch(revoke);
        expect(sql, `${fn} GRANT missing`).toMatch(grant);
      });
    }

    test('apply RPC enforces only Concept entity_type (not other 8 types)', () => {
      const sql = readFileSync(MIG, 'utf-8');
      const fnSection = sql.split(/CREATE OR REPLACE FUNCTION public\.fn_apply_graph_extraction_audited/)[1] ?? '';
      // Looking for: CONTINUE WHEN v_entity_type IS DISTINCT FROM 'Concept';
      expect(fnSection).toMatch(/CONTINUE WHEN v_entity_type IS DISTINCT FROM 'Concept'/);
    });

    test('apply RPC writes exactly one audit_journal row with action graph.extraction_completed', () => {
      // Scoped to the function's own SoT file (splitting the whole baseline would
      // count every platform function's audit writes).
      const fnSection = readFileSync(resolve(ROOT, 'aisha/db/sql/functions/fn_apply_graph_extraction_audited.sql'), 'utf-8');
      const inserts = (fnSection.match(/INSERT INTO public\.audit_journal/g) ?? []).length;
      expect(inserts).toBe(1);
      expect(fnSection).toMatch(/'graph\.extraction_completed'/);
    });

    test('apply RPC clamps confidence to [0,1] (defensive against LLM)', () => {
      const sql = readFileSync(MIG, 'utf-8');
      expect(sql).toMatch(/GREATEST\(0\.0, LEAST\(1\.0,/);
    });

    test('discovery RPC filters by graph.extraction_completed audit (idempotency anchor)', () => {
      const sql = readFileSync(MIG, 'utf-8');
      const fnSection = sql.split(/CREATE OR REPLACE FUNCTION public\.fn_get_runs_needing_graph_extract/)[1] ?? '';
      expect(fnSection).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM public\.audit_journal aj[\s\S]*action = 'graph\.extraction_completed'/);
    });

    test('discovery RPC caps batch_size to 1..200 (DoS protection)', () => {
      const sql = readFileSync(MIG, 'utf-8');
      expect(sql).toMatch(/LIMIT GREATEST\(1, LEAST\(200, p_batch_size\)\)/);
    });

    test('apply RPC honors graph_edges relationship CHECK enum via skip-on-violation', () => {
      // The apply RPC wraps the edge INSERT in EXCEPTION WHEN check_violation
      // to gracefully skip relationship values not in the enum, rather than
      // failing the whole extraction. Keeps the worker tolerant.
      const sql = readFileSync(MIG, 'utf-8');
      expect(sql).toMatch(/EXCEPTION WHEN check_violation THEN/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('SoT mirrors: all 3 RPCs have a SoT file', () => {
    test('discovery SoT exists with matching signature', () => {
      expect(existsSync(SOT_DISCO)).toBe(true);
      const sot = readFileSync(SOT_DISCO, 'utf-8');
      expect(sot).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_get_runs_needing_graph_extract\(/);
      expect(sot).toMatch(/SECURITY DEFINER/);
      expect(sot).toMatch(/SET search_path TO 'public'/);
    });

    test('context SoT exists with matching signature', () => {
      expect(existsSync(SOT_CTX)).toBe(true);
      const sot = readFileSync(SOT_CTX, 'utf-8');
      expect(sot).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_get_run_extract_context\(p_run_id uuid\)/);
    });

    test('apply SoT exists with matching signature + body parity with migration', () => {
      expect(existsSync(SOT_APPLY)).toBe(true);
      const sot = readFileSync(SOT_APPLY, 'utf-8');
      expect(sot).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_apply_graph_extraction_audited\(/);
      // Same key contract assertions as the migration.
      expect(sot).toMatch(/CONTINUE WHEN v_entity_type IS DISTINCT FROM 'Concept'/);
      expect(sot).toMatch(/'graph\.extraction_completed'/);
      expect(sot).toMatch(/EXCEPTION WHEN check_violation THEN/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Lib graph-extract.ts: prompt + strict parser', () => {
    test('exports system prompt + user prompt builder + parser', () => {
      expect(typeof GRAPH_EXTRACT_SYSTEM).toBe('string');
      expect(GRAPH_EXTRACT_SYSTEM.length).toBeGreaterThan(200);
      expect(GRAPH_EXTRACT_SYSTEM).toMatch(/entity_type/);
      expect(GRAPH_EXTRACT_SYSTEM).toMatch(/Concept/);
      expect(buildGraphExtractUserPrompt({ run: { id: 'x' } })).toMatch(/Run context:/);
    });

    test('ALLOWED_RELATIONSHIPS matches graph_edges CHECK enum (Step 7 schema migration)', () => {
      // The graph_edges CHECK constraint enumerates the allowed relationships.
      // If schema changes, lib must follow.
      const schemaSql = readFileSync(GRAPH_MIG, 'utf-8');
      const checkMatch = schemaSql.match(/relationship\s+text\s+NOT\s+NULL\s+CHECK\s*\(relationship\s+IN\s*\(([^)]+)\)/);
      expect(checkMatch, 'graph_edges CHECK enum not found in schema migration').toBeTruthy();
      const enumLiteral = checkMatch![1];
      const fromSchema = new Set(
        Array.from(enumLiteral.matchAll(/'([A-Z_]+)'/g)).map((m) => m[1] as string),
      );
      // Lib must be a subset of (or equal to) the schema. New schema values
      // showing up later won't break the lib — but the lib emitting a value
      // not in the schema would.
      for (const rel of ALLOWED_RELATIONSHIPS) {
        expect(fromSchema.has(rel), `Lib allows ${rel} which is not in schema CHECK enum`).toBe(true);
      }
    });

    test('parser rejects non-string input', () => {
      expect(parseGraphExtractJson('')).toBeNull();
      // @ts-expect-error — test non-string input path
      expect(parseGraphExtractJson(undefined)).toBeNull();
    });

    test('parser rejects non-JSON gibberish', () => {
      expect(parseGraphExtractJson('hello world')).toBeNull();
      expect(parseGraphExtractJson('{not valid')).toBeNull();
    });

    test('parser strips markdown code fences', () => {
      const out = parseGraphExtractJson('```json\n{"nodes":[],"edges":[]}\n```');
      expect(out).toEqual({ nodes: [], edges: [] });
    });

    test('parser rejects unknown entity_type', () => {
      const out = parseGraphExtractJson(JSON.stringify({
        nodes: [{ entity_type: 'Plugin', entity_slug: 'foo', entity_label: 'Foo' }],
        edges: [],
      }));
      expect(out).toBeNull();
    });

    test('parser rejects non-kebab-case slug', () => {
      const out = parseGraphExtractJson(JSON.stringify({
        nodes: [{ entity_type: 'Concept', entity_slug: 'CamelCase', entity_label: 'X' }],
        edges: [],
      }));
      expect(out).toBeNull();
    });

    test('parser rejects too-short slug (<3 chars)', () => {
      const out = parseGraphExtractJson(JSON.stringify({
        nodes: [{ entity_type: 'Concept', entity_slug: 'ab', entity_label: 'X' }],
        edges: [],
      }));
      expect(out).toBeNull();
    });

    test('parser rejects edge relationship not in ALLOWED set', () => {
      const out = parseGraphExtractJson(JSON.stringify({
        nodes: [],
        edges: [{
          from_type: 'Run', from_slug: 'x', to_type: 'Concept', to_slug: 'y',
          relationship: 'BANANA',
        }],
      }));
      expect(out).toBeNull();
    });

    test('parser deduplicates concept slugs within the payload', () => {
      const out = parseGraphExtractJson(JSON.stringify({
        nodes: [
          { entity_type: 'Concept', entity_slug: 'foo', entity_label: 'Foo' },
          { entity_type: 'Concept', entity_slug: 'foo', entity_label: 'Foo Again' },
        ],
        edges: [],
      }));
      expect(out?.nodes.length).toBe(1);
    });

    test('parser clamps confidence to [0,1]', () => {
      const out = parseGraphExtractJson(JSON.stringify({
        nodes: [],
        edges: [{
          from_type: 'Run', from_slug: 'x', to_type: 'Concept', to_slug: 'y',
          relationship: 'REFERENCES', confidence: 3.5,
        }],
      }));
      expect(out?.edges[0].confidence).toBe(1);
    });

    test('parser caps payload size (>20 nodes rejected)', () => {
      const nodes = Array.from({ length: 21 }, (_, i) => ({
        entity_type: 'Concept', entity_slug: `slug-${i}`, entity_label: `Label ${i}`,
      }));
      const out = parseGraphExtractJson(JSON.stringify({ nodes, edges: [] }));
      expect(out).toBeNull();
    });

    test('parser accepts a well-formed minimal payload', () => {
      const out = parseGraphExtractJson(JSON.stringify({
        nodes: [{ entity_type: 'Concept', entity_slug: 'retry-backoff', entity_label: 'Retry backoff' }],
        edges: [{
          from_type: 'Run', from_slug: 'abc', to_type: 'Concept', to_slug: 'retry-backoff',
          relationship: 'REFERENCES', confidence: 0.85,
        }],
      }));
      expect(out).toEqual({
        nodes: [{
          entity_type: 'Concept', entity_slug: 'retry-backoff', entity_label: 'Retry backoff',
          metadata: undefined,
        }],
        edges: [{
          from_type: 'Run', from_slug: 'abc', to_type: 'Concept', to_slug: 'retry-backoff',
          relationship: 'REFERENCES', confidence: 0.85, metadata: undefined,
        }],
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Route /graph/extract/run', () => {
    test('route file exists + registered in server.ts', () => {
      expect(existsSync(ROUTE)).toBe(true);
      const server = readFileSync(SERVER, 'utf-8');
      expect(server).toMatch(/import \{ graphExtractRoutes \} from '\.\/routes\/graph-extract\.js'/);
      expect(server).toMatch(/app\.register\(graphExtractRoutes\)/);
    });

    test('service-role guarded (verifyServiceRole)', () => {
      const src = readFileSync(ROUTE, 'utf-8');
      expect(src).toMatch(/verifyServiceRole\(req\.headers\.authorization\)/);
    });

    test('uses capability-resolver rag.graph_extract (no hardcoded model)', () => {
      const src = readFileSync(ROUTE, 'utf-8');
      expect(src).toMatch(/resolveRagBackend\(['"]rag\.graph_extract['"]\)/);
    });

    test('returns 503 + resolver summary when no LLM backend available', () => {
      const src = readFileSync(ROUTE, 'utf-8');
      expect(src).toMatch(/reply\.code\(503\)/);
      expect(src).toMatch(/summarizeForAudit\(resolved\)/);
    });

    test('calls fn_get_runs_needing_graph_extract + fn_get_run_extract_context + fn_apply_graph_extraction_audited', () => {
      const src = readFileSync(ROUTE, 'utf-8');
      expect(src).toMatch(/fn_get_runs_needing_graph_extract/);
      expect(src).toMatch(/fn_get_run_extract_context/);
      expect(src).toMatch(/fn_apply_graph_extraction_audited/);
    });

    test('uses json_mode: true for LLM call', () => {
      const src = readFileSync(ROUTE, 'utf-8');
      expect(src).toMatch(/json_mode:\s*true/);
    });

    test('soft-fails per run (continue) — does not abort batch on individual failures', () => {
      const src = readFileSync(ROUTE, 'utf-8');
      // Looking for: failures.push + continue inside the for-loop branches.
      expect(src).toMatch(/failures\.push/);
      expect(src).toMatch(/continue;/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('n8n workflow WF_GRAPH_EXTRACT_NIGHTLY', () => {
    test('workflow file exists with parseable JSON', () => {
      expect(existsSync(N8N)).toBe(true);
      const wf = JSON.parse(readFileSync(N8N, 'utf-8')) as { name?: string; nodes?: unknown[] };
      expect(wf.name).toBe('WF_GRAPH_EXTRACT_NIGHTLY');
      expect(Array.isArray(wf.nodes)).toBe(true);
    });

    test('cron triggers daily at 03:30 UTC (after RAG eval 02:00 + chunk backfill 03:00)', () => {
      const wf = JSON.parse(readFileSync(N8N, 'utf-8')) as { nodes?: Array<Record<string, unknown>> };
      const cron = wf.nodes?.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
      expect(cron, 'scheduleTrigger node missing').toBeTruthy();
      const params = cron!.parameters as { rule?: { interval?: Array<{ triggerAtHour?: number; triggerAtMinute?: number }> } };
      expect(params.rule?.interval?.[0]?.triggerAtHour).toBe(3);
      expect(params.rule?.interval?.[0]?.triggerAtMinute).toBe(30);
    });

    test('POSTs to /graph/extract/run', () => {
      const wf = readFileSync(N8N, 'utf-8');
      expect(wf).toMatch(/\/graph\/extract\/run/);
    });

    test('writes log_integration_action audit (graph.extract_nightly_completed)', () => {
      const wf = readFileSync(N8N, 'utf-8');
      expect(wf).toMatch(/log_integration_action/);
      expect(wf).toMatch(/graph\.extract_nightly_completed/);
    });
  });
});
