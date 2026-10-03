/**
 * Gate test: Phase 12 WP 1.4 — Contextual retrieval (Anthropic pattern).
 *
 * Phase 12 WP 1.4 status. The contextual-prefix generator lib +
 * fn_enrich_chunk_context_audited RPC + knowledge_chunks schema columns
 * were shipped in migration 20260518210000_contextual_retrieval.sql.
 * This gate locks the wiring + budget-aware ingestion contract so any
 * future regression (lib removed, route stops calling it, audit RPC
 * loses its SECURITY DEFINER, schema column rename) fails CI before
 * reaching production.
 *
 * Enforces:
 *   1. services/svc-mcp-knowledge/src/lib/contextual-prefix.ts exports
 *      generateContextualPrefix + PrefixResult type
 *   2. Existing unit test contextual-prefix.unit.test.ts covers happy
 *      path + graceful-degradation paths
 *   3. knowledge_chunks SoT has the 5 contextual columns:
 *      contextual_prefix, contextual_prefix_model,
 *      contextual_prefix_model_version, contextual_prefix_generated_at,
 *      contextual_prefix_token_count
 *   4. fn_enrich_chunk_context_audited RPC has SECURITY DEFINER +
 *      search_path TO 'public' + REVOKE FROM PUBLIC + GRANT EXECUTE TO
 *      service_role + audit_journal write with action
 *      'knowledge.chunk_context_enriched'
 *   5. The migration is registered (so a fresh deploy materialises the
 *      schema)
 *   6. knowledge-embeddings ingest route imports + invokes
 *      generateContextualPrefix per batch
 *   7. Cost projection runbook exists with concrete operator commands
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const LIB = path.join(
  ROOT,
  'services/svc-mcp-knowledge/src/lib/contextual-prefix.ts',
);
const LIB_TEST = path.join(
  ROOT,
  'services/svc-mcp-knowledge/src/tests/contextual-prefix.unit.test.ts',
);
const INGEST_ROUTE = path.join(
  ROOT,
  'services/svc-mcp-knowledge/src/routes/knowledge-embeddings.ts',
);
const KNOWLEDGE_CHUNKS_SOT = path.join(
  ROOT,
  'aisha/db/sql/tables/knowledge_chunks.sql',
);
const ENRICH_RPC = path.join(
  ROOT,
  'aisha/db/sql/functions/fn_enrich_chunk_context_audited.sql',
);
// The contextual-retrieval migration has been absorbed into the compiled
// baseline + archived out of aisha/db/migrations/. The canonical SoT for the
// materialised schema is the real baseline (NOT the archived migration), so we
// assert the contextual columns against the baseline directly.
const BASELINE = path.join(
  ROOT,
  'aisha/db/migrations/00000000000000_baseline.sql',
);
const REGISTRY = path.join(ROOT, 'aisha/db/migration-registry.json');
const RUNBOOK = path.join(
  ROOT,
  'docs/perf/CONTEXTUAL_RETRIEVAL_RUNBOOK.md',
);

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

describe('Phase 12 WP 1.4 — Contextual-prefix lib contract', () => {
  const src = readText(LIB);

  it('lib file exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('exports generateContextualPrefix + PrefixResult + PrefixInput types', () => {
    expect(src).toMatch(/export\s+async\s+function\s+generateContextualPrefix/);
    expect(src).toMatch(/export\s+interface\s+PrefixResult/);
    expect(src).toMatch(/export\s+interface\s+PrefixInput/);
  });

  it('PrefixInput includes the 4 required fields (item title, body, section, chunk)', () => {
    expect(src).toMatch(/item_title:\s*string/);
    expect(src).toMatch(/item_body_markdown:\s*string/);
    expect(src).toMatch(/section_title:\s*string\s*\|\s*null/);
    expect(src).toMatch(/chunk_text:\s*string/);
  });

  it('PrefixResult exposes model + model_version (reproducibility)', () => {
    expect(src).toMatch(/prefix:\s*string/);
    expect(src).toMatch(/model:\s*string/);
    expect(src).toMatch(/model_version:\s*string/);
  });

  it('uses chatCompletionWithRetry + LlmCompletionError (resilient LLM call)', () => {
    expect(src).toMatch(
      /import\s*\{[\s\S]{0,200}chatCompletionWithRetry[\s\S]{0,200}LlmCompletionError/,
    );
  });

  it('truncates body excerpt to a bounded char limit (cost guard)', () => {
    // The lib MUST bound body excerpt so prompt cost stays predictable
    // even on very long parent documents.
    expect(src).toMatch(/DEFAULT_BODY_EXCERPT_CHARS\s*=\s*\d{4,}/);
  });

  it('bounds completion tokens (cost guard on tail end)', () => {
    expect(src).toMatch(/DEFAULT_MAX_TOKENS\s*=\s*\d{1,4}/);
  });

  it('fail-loud contract: a failed/empty prefix THROWS (never silently embeds prefix-less)', () => {
    // Brick4 flipped the lib's contract: a single chunk's prefix failure no longer
    // degrades to a baseline (unprefixed) embedding — it throws, the caller marks that
    // item failed and re-queues it. The lib documents the fail-loud rule and returns a
    // non-null PrefixResult (throws on failure).
    expect(src).toMatch(/fail-loud|fail loud|THROWS|never embed/i);
    expect(src).toMatch(/Promise<PrefixResult>/);
  });
});

describe('Phase 12 WP 1.4 — Unit test coverage', () => {
  const src = readText(LIB_TEST);

  it('contextual-prefix.unit.test.ts exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('covers happy path + fail-loud (the two behaviours that matter)', () => {
    expect(src).toMatch(/happy path/i);
    expect(src).toMatch(/fail-loud/i);
  });

  it('covers prompt construction (buildPrefixPrompt)', () => {
    expect(src).toMatch(/buildPrefixPrompt/);
  });
});

describe('Phase 12 WP 1.4 — knowledge_chunks schema columns', () => {
  const src = readText(KNOWLEDGE_CHUNKS_SOT);

  it.each([
    'contextual_prefix',
    'contextual_prefix_model',
    'contextual_prefix_model_version',
    'contextual_prefix_generated_at',
    'contextual_prefix_token_count',
  ])('column %s present in SoT', (col) => {
    expect(src).toMatch(new RegExp(`\\b${col}\\b`));
  });

  it('row level security enabled (per CLAUDE.md RLS pattern)', () => {
    expect(src).toMatch(/ALTER\s+TABLE\s+public\.knowledge_chunks\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});

describe('Phase 12 WP 1.4 — fn_enrich_chunk_context_audited contract', () => {
  const src = readText(ENRICH_RPC);

  it('SoT file exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('SECURITY DEFINER + search_path TO public', () => {
    expect(src).toMatch(/SECURITY\s+DEFINER/i);
    expect(src).toMatch(/SET\s+search_path\s+TO\s+['"]public['"]/i);
  });

  it('REVOKE FROM PUBLIC + GRANT EXECUTE TO service_role only', () => {
    expect(src).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_enrich_chunk_context_audited[\s\S]{0,300}FROM\s+PUBLIC/i,
    );
    expect(src).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_enrich_chunk_context_audited[\s\S]{0,300}TO\s+service_role/i,
    );
    // explicitly NOT granted to authenticated/anon (service-role only —
    // this RPC is called only from svc-mcp-knowledge worker)
    expect(src).not.toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_enrich_chunk_context_audited[\s\S]{0,300}TO\s+(authenticated|anon)/i,
    );
  });

  it('writes audit_journal action knowledge.chunk_context_enriched', () => {
    expect(src).toMatch(
      /audit_journal[\s\S]{0,500}['"]knowledge\.chunk_context_enriched['"]/,
    );
  });

  it('invalidates embedding so the next worker pass re-embeds with prefix', () => {
    // The Step-1 contract: prefix change MUST cause re-embedding. Either
    // the RPC nulls embedding directly OR sets a needs-re-embed flag.
    // Either pattern is acceptable, both work via downstream worker.
    expect(src).toMatch(
      /(?:embedding\s*=\s*NULL|needs_re_embed|invalid)/i,
    );
  });
});

describe('Phase 12 WP 1.4 — Schema materialised in baseline (no pending migration)', () => {
  const baseline = readText(BASELINE);

  it('compiled baseline exists', () => {
    expect(baseline.length).toBeGreaterThan(0);
  });

  it('registry is baseline-only (migration absorbed + archived)', () => {
    // The contextual-retrieval migration was compiled into the baseline and
    // archived out of aisha/db/migrations/. The active registry therefore
    // declares the baseline-only state — no pending non-baseline migrations.
    expect(readText(REGISTRY)).toMatch(/Baseline-only state/i);
  });

  it('baseline materialises the 5 contextual_prefix_* columns', () => {
    // A fresh cold-start deploy applies the baseline; it MUST carry the
    // contextual schema so the wiring above has a target to write to.
    for (const col of [
      'contextual_prefix',
      'contextual_prefix_model',
      'contextual_prefix_model_version',
      'contextual_prefix_generated_at',
      'contextual_prefix_token_count',
    ]) {
      expect(baseline).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('baseline materialises fn_enrich_chunk_context_audited (deploy target)', () => {
    expect(baseline).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_enrich_chunk_context_audited/i,
    );
  });
});

describe('Phase 12 WP 1.4 — Ingest route wiring', () => {
  const src = readText(INGEST_ROUTE);

  it('imports generateContextualPrefix from the lib', () => {
    expect(src).toMatch(
      /import\s*\{[\s\S]{0,300}generateContextualPrefix[\s\S]{0,300}\}\s*from\s+["'][^"']*contextual-prefix/,
    );
  });

  it('invokes generateContextualPrefix in the chunk-processing loop', () => {
    expect(src).toMatch(/await\s+generateContextualPrefix\s*\(/);
  });

  it('passes the result into fn_enrich_chunk_context_audited (audit write)', () => {
    expect(src).toMatch(/fn_enrich_chunk_context_audited/);
  });
});

describe('Phase 12 WP 1.4 — Cost projection runbook', () => {
  const src = readText(RUNBOOK);

  it('runbook exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('documents per-chunk cost ($0.0003 context-gen + embedding fee)', () => {
    expect(src).toMatch(/\$0\.000\d/);
    expect(src).toMatch(/context.gen|prefix.gen/i);
  });

  it('provides the budget-gate thresholds ($50 approval, $500 cost review)', () => {
    expect(src).toMatch(/\$50\b/);
    expect(src).toMatch(/\$500\b/);
  });

  it('documents the rate-limit + walltime estimate', () => {
    expect(src).toMatch(/chunks?\s*\/\s*sec|chunk[\s_-]?per[\s_-]?sec/i);
    expect(src).toMatch(/walltime|wall-time|hours?|hrs?/i);
  });

  it('includes the COUNT query so operators can pre-flight cost on their corpus', () => {
    expect(src).toMatch(/SELECT\s+COUNT\(\*\)\s+FROM\s+knowledge_chunks/i);
  });

  it('documents rollback (set contextual_prefix=NULL on a per-profile basis)', () => {
    expect(src).toMatch(/Rollback/i);
    expect(src).toMatch(/contextual_prefix\s*=\s*NULL|UPDATE\s+knowledge_chunks/i);
  });

  it('cross-references related WPs (3.1 Qwen3 embedding, 3.2 injection, 1.6 RAGAS)', () => {
    expect(src).toMatch(/WP 3\.1|Qwen3/);
    expect(src).toMatch(/WP 1\.6|RAGAS/);
  });
});
