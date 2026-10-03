/**
 * Dynamic capability resolution gate (Step 1.5).
 *
 * AISHA-architecture invariant: RAG-layer LLM calls MUST go through the
 * capability-resolver (which reads ai_provider_registry + health + benchmarks
 * via aisha_resolve_clow_backend RPC). Hardcoded model ids (qwen3-30b,
 * gpt-4o-mini) are permitted ONLY in the resolver's env-fallback path
 * (developer-local + first-boot) and in test fixtures — never in the
 * production worker code paths.
 *
 * This gate proves the wire-up by static inspection:
 *   - capability-resolver.ts exposes resolveRagBackend + summarizeForAudit
 *   - rag-eval.ts calls resolveRagBackend('rag.eval_answer') and
 *     'rag.eval_judge' before each batch, refuses 503 when both null
 *   - knowledge-embeddings.ts calls resolveRagBackend('rag.contextual_prefix')
 *     for the inline path AND the contextual-backfill path
 *   - contextual-prefix.ts threads base_url/api_key through to llm-completion
 *   - resolved_provider_slug + resolved_model_id appear in eval metadata
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const RESOLVER       = resolve(ROOT, 'services/svc-mcp-knowledge/src/lib/capability-resolver.ts');
const PREFIX_LIB     = resolve(ROOT, 'services/svc-mcp-knowledge/src/lib/contextual-prefix.ts');
const EVAL_ROUTE     = resolve(ROOT, 'services/svc-mcp-knowledge/src/routes/rag-eval.ts');
const EMB_ROUTE      = resolve(ROOT, 'services/svc-mcp-knowledge/src/routes/knowledge-embeddings.ts');
const JUDGES_LIB     = resolve(ROOT, 'services/svc-mcp-knowledge/src/lib/rag-eval-judges.ts');

describe('Dynamic capability resolution gate (Step 1.5)', () => {

  describe('capability-resolver.ts', () => {
    test('lib exists', () => {
      expect(existsSync(RESOLVER), `Missing: ${RESOLVER}`).toBe(true);
    });

    test('exports resolveRagBackend + summarizeForAudit + clearCapabilityCache', () => {
      const code = readFileSync(RESOLVER, 'utf-8');
      expect(code).toMatch(/export\s+async\s+function\s+resolveRagBackend/);
      expect(code).toMatch(/export\s+function\s+summarizeForAudit/);
      expect(code).toMatch(/export\s+function\s+clearCapabilityCache/);
    });

    test('calls aisha_resolve_clow_backend RPC (uses existing AISHA primitive)', () => {
      const code = readFileSync(RESOLVER, 'utf-8');
      expect(code).toMatch(/['"]aisha_resolve_clow_backend['"]/);
    });

    test('defines all 5 RAG purposes (current + reserved for future steps)', () => {
      const code = readFileSync(RESOLVER, 'utf-8');
      for (const purpose of [
        'rag.contextual_prefix',
        'rag.eval_answer',
        'rag.eval_judge',
        'rag.critic_judge',
        'rag.graph_extract',
      ]) {
        expect(code, `Missing purpose ${purpose}`).toMatch(new RegExp(purpose));
      }
    });

    test('returns null gracefully (never throws) when RPC fails', () => {
      const code = readFileSync(RESOLVER, 'utf-8');
      // The try/catch around the RPC call MUST swallow and set result=null,
      // not re-throw. Verified by presence of catch block + return null.
      expect(code).toMatch(/catch[\s\S]*?result\s*=\s*null/);
    });

    test('emits resolved_via field with documented values', () => {
      const code = readFileSync(RESOLVER, 'utf-8');
      expect(code).toMatch(/'clow_resolver'/);
      expect(code).toMatch(/'env_fallback'/);
    });
  });

  describe('rag-eval.ts integration', () => {
    test('imports resolveRagBackend + summarizeForAudit', () => {
      const code = readFileSync(EVAL_ROUTE, 'utf-8');
      expect(code).toMatch(/import \{[^}]*resolveRagBackend[^}]*\}/);
      expect(code).toMatch(/summarizeForAudit/);
    });

    test('resolves answer + judge backends BEFORE the per-row loop', () => {
      const code = readFileSync(EVAL_ROUTE, 'utf-8');
      expect(code).toMatch(/resolveRagBackend\(['"]rag\.eval_answer['"]\)/);
      expect(code).toMatch(/resolveRagBackend\(['"]rag\.eval_judge['"]\)/);
    });

    test('returns 503 when neither resolver nor body override yields a model', () => {
      const code = readFileSync(EVAL_ROUTE, 'utf-8');
      expect(code).toMatch(/503/);
      expect(code).toMatch(/No LLM backend available/);
    });

    test('threads base_url + api_key from resolved backend into chat completion', () => {
      const code = readFileSync(EVAL_ROUTE, 'utf-8');
      expect(code).toMatch(/base_url:\s*answerResolved\?\.endpoint_url/);
      expect(code).toMatch(/apiKeyFor\(answerResolved\)/);
    });

    test('persists resolved_provider + resolved_model in audit metadata', () => {
      const code = readFileSync(EVAL_ROUTE, 'utf-8');
      expect(code).toMatch(/answer_resolution:\s*summarizeForAudit/);
      expect(code).toMatch(/judge_resolution:\s*summarizeForAudit/);
    });
  });

  describe('contextual-prefix lib integration', () => {
    test('PrefixOptions accepts base_url + api_key (resolver passthrough)', () => {
      const code = readFileSync(PREFIX_LIB, 'utf-8');
      expect(code).toMatch(/base_url\?:\s*string/);
      expect(code).toMatch(/api_key\?:\s*string/);
    });

    test('chatCompletionWithRetry is called with opts.base_url + opts.api_key', () => {
      const code = readFileSync(PREFIX_LIB, 'utf-8');
      expect(code).toMatch(/base_url:\s*opts\.base_url/);
      expect(code).toMatch(/api_key:\s*opts\.api_key/);
    });
  });

  describe('rag-eval-judges integration (judge LLM endpoint override)', () => {
    test('JudgeInput accepts judge_base_url + judge_api_key', () => {
      const code = readFileSync(JUDGES_LIB, 'utf-8');
      expect(code).toMatch(/judge_base_url\?:\s*string/);
      expect(code).toMatch(/judge_api_key\?:\s*string/);
    });

    test('runJudge passes baseUrl + apiKey to chatCompletionWithRetry', () => {
      const code = readFileSync(JUDGES_LIB, 'utf-8');
      expect(code).toMatch(/base_url:\s*baseUrl/);
      expect(code).toMatch(/api_key:\s*apiKey/);
    });
  });

  describe('knowledge-embeddings.ts integration', () => {
    test('imports resolveRagBackend + ResolvedBackend type', () => {
      const code = readFileSync(EMB_ROUTE, 'utf-8');
      expect(code).toMatch(/import \{[^}]*resolveRagBackend[^}]*ResolvedBackend[^}]*\}/);
    });

    test('inline path resolves rag.contextual_prefix once before per-item loop', () => {
      const code = readFileSync(EMB_ROUTE, 'utf-8');
      expect(code).toMatch(/resolveRagBackend\(['"]rag\.contextual_prefix['"]\)/);
    });

    test('inline path threads resolved model + endpoint + api_key into generateContextualPrefix', () => {
      const code = readFileSync(EMB_ROUTE, 'utf-8');
      expect(code).toMatch(/model:\s*prefixBackend\.model_id/);
      expect(code).toMatch(/base_url:\s*prefixBackend\.endpoint_url/);
      expect(code).toMatch(/api_key:\s*prefixApiKey/);
    });

    test('inline path FAILS LOUD (503) when no prefix backend is healthy (Brick4: no silent batch degrade)', () => {
      const code = readFileSync(EMB_ROUTE, 'utf-8');
      // Brick4: RAG_PREFIX_ENABLED=false still embeds raw (explicit operator opt-out),
      // but with the prefix enabled + no healthy backend the worker 503s instead of
      // silently embedding the whole batch unprefixed.
      expect(code).toMatch(/prefixBackend !== null/);
      expect(code).toMatch(/No contextual-prefix backend available/);
      expect(code).toMatch(/no unprefixed embeddings written/);
    });

    test('contextual-backfill route also resolves backend + returns 503 on null', () => {
      const code = readFileSync(EMB_ROUTE, 'utf-8');
      expect(code).toMatch(/backfillBackend\s*=\s*await\s+resolveRagBackend\(['"]rag\.contextual_prefix['"]\)/);
      expect(code).toMatch(/No contextual-prefix backend available/);
    });
  });

  describe('No hardcoded production models', () => {
    test('rag-eval.ts does not bake in a default model id (only resolver-derived)', () => {
      const code = readFileSync(EVAL_ROUTE, 'utf-8');
      // Tolerated forms: fallback chain ending in `?? answerResolved?.model_id`.
      // Forbidden: literal `?? 'gpt-4o-mini'` as the last fallback (Step 1.5
      // intentionally removed this so 503 surfaces instead of silent default).
      expect(code).not.toMatch(/\?\?\s*['"]gpt-4o-mini['"]/);
      expect(code).not.toMatch(/\?\?\s*['"]qwen3-30b['"]/);
    });

    test('knowledge-embeddings.ts does not pass a hardcoded prefix model (resolver supplies it)', () => {
      const code = readFileSync(EMB_ROUTE, 'utf-8');
      // generateContextualPrefix without opts arg would default to qwen3-30b
      // env fallback. With Step 1.5 wire-up, opts.model must come from
      // resolved backend.
      expect(code).toMatch(/model:\s*prefixBackend\.model_id/);
      expect(code).toMatch(/model:\s*backfillBackend\.model_id/);
    });
  });
});
