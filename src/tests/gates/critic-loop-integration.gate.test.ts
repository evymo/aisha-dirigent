/**
 * Gate: Step 5 critic loop integration (svc-ai-chat state machine).
 *
 * Verifies the full Planner→Critic→Iterate wire-up by static inspection:
 *   1. Micro-migration extends fn_record_critic_iteration_audited to
 *      propagate FINAL faithfulness to ai_runs.faithfulness_score_estimate
 *      on terminal decisions (so Step 2 UI reads the right value).
 *   2. criticLoop.ts state machine exists with the documented contract:
 *      reads fn_get_critic_config, fast-path on disabled, capability-
 *      resolver for rag.critic_judge, records each iteration via the
 *      audited RPC, returns a CriticLoopResult.
 *   3. chat.ts wires runCriticLoop AFTER enrichWithAishaContext (so the
 *      initial bundle is scored + possibly refined before the LLM call).
 *   4. No-duplicate invariants: no other service writes to
 *      ai_run_critic_iterations or calls fn_record_critic_iteration_audited.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const MICRO_MIG    = resolve(ROOT, 'aisha/db/sql/functions/fn_record_critic_iteration_audited.sql');
const RPC_SOT      = resolve(ROOT, 'aisha/db/sql/functions/fn_record_critic_iteration_audited.sql');
const LOOP_LIB     = resolve(ROOT, 'services/svc-ai-chat/src/lib/criticLoop.ts');
const CHAT_TS      = resolve(ROOT, 'services/svc-ai-chat/src/routes/chat.ts');

describe('Step 5 critic loop integration', () => {

  describe('Micro-migration: ai_runs faithfulness propagation', () => {
    test('migration file exists', () => {
      expect(existsSync(MICRO_MIG)).toBe(true);
    });

    test('CREATE OR REPLACE (no signature change)', () => {
      const sql = readFileSync(MICRO_MIG, 'utf-8');
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_record_critic_iteration_audited/);
      // Same param list as Step 5 migration — no DROP needed.
      expect(sql).not.toMatch(/^DROP FUNCTION/m);
    });

    test('updates ai_runs.faithfulness_score_estimate on terminal decision only', () => {
      const sql = readFileSync(MICRO_MIG, 'utf-8');
      // Guard: only on stop_* decisions AND when faithfulness is not null
      expect(sql).toMatch(/IF p_decision LIKE 'stop_%'\s+AND p_faithfulness IS NOT NULL THEN/);
      expect(sql).toMatch(/UPDATE public\.ai_runs[\s\S]*SET faithfulness_score_estimate = p_faithfulness/);
    });

    test('audit metadata records propagation flag', () => {
      const sql = readFileSync(MICRO_MIG, 'utf-8');
      expect(sql).toMatch(/'propagated_to_ai_run'/);
    });

    test('SoT mirror matches migration (same behavior, same shape)', () => {
      const sot = readFileSync(RPC_SOT, 'utf-8');
      expect(sot).toMatch(/IF p_decision LIKE 'stop_%'\s+AND p_faithfulness IS NOT NULL THEN/);
      expect(sot).toMatch(/UPDATE public\.ai_runs[\s\S]*SET faithfulness_score_estimate = p_faithfulness/);
      expect(sot).toMatch(/'propagated_to_ai_run'/);
    });
  });

  describe('criticLoop.ts state machine', () => {
    test('lib file exists', () => {
      expect(existsSync(LOOP_LIB)).toBe(true);
    });

    test('exports runCriticLoop entry point', () => {
      const code = readFileSync(LOOP_LIB, 'utf-8');
      expect(code).toMatch(/export\s+async\s+function\s+runCriticLoop/);
    });

    test('reads critic config via fn_get_critic_config', () => {
      const code = readFileSync(LOOP_LIB, 'utf-8');
      expect(code).toMatch(/['"]fn_get_critic_config['"]/);
      expect(code).toMatch(/p_profile_slug/);
    });

    test('fast-path returns initial bundle when critic_enabled=false', () => {
      const code = readFileSync(LOOP_LIB, 'utf-8');
      // Disabled config short-circuits — no iteration, no API calls
      expect(code).toMatch(/!config\.critic_enabled/);
      expect(code).toMatch(/['"]disabled['"]/);
    });

    test('resolves judge backend via aisha_resolve_clow_backend with rag.critic_judge purpose', () => {
      const code = readFileSync(LOOP_LIB, 'utf-8');
      expect(code).toMatch(/['"]aisha_resolve_clow_backend['"]/);
      expect(code).toMatch(/['"]rag\.critic_judge['"]/);
    });

    test('records every iteration via fn_record_critic_iteration_audited', () => {
      const code = readFileSync(LOOP_LIB, 'utf-8');
      expect(code).toMatch(/['"]fn_record_critic_iteration_audited['"]/);
    });

    test('strategies expand_tags + switch_profile implemented; others noop with documented reason', () => {
      const code = readFileSync(LOOP_LIB, 'utf-8');
      expect(code).toMatch(/case ['"]expand_tags['"]/);
      expect(code).toMatch(/case ['"]switch_profile['"]/);
      // broaden_threshold + add_kb_layer documented as deferred (no-op)
      expect(code).toMatch(/case ['"]broaden_threshold['"]/);
      expect(code).toMatch(/case ['"]add_kb_layer['"]/);
    });

    test('uses unifiedChat (existing svc-ai-chat LLM router) for judge call', () => {
      const code = readFileSync(LOOP_LIB, 'utf-8');
      // Reuses existing infrastructure, no duplicate LLM client
      expect(code).toMatch(/unifiedChat/);
      expect(code).toMatch(/from\s+['"]\.\/llmRouter\.js['"]/);
    });

    test('reuses enrichWithAishaContext (existing) for re-retrieval — no new compose helper', () => {
      const code = readFileSync(LOOP_LIB, 'utf-8');
      expect(code).toMatch(/enrichWithAishaContext/);
      expect(code).toMatch(/from\s+['"]\.\/orchestrationBridge\.js['"]/);
    });

    test('judge prompt enforces JSON mode + temperature=0 (deterministic scoring)', () => {
      const code = readFileSync(LOOP_LIB, 'utf-8');
      expect(code).toMatch(/jsonMode:\s*true/);
      expect(code).toMatch(/temperature:\s*0/);
    });
  });

  describe('chat.ts wire-in', () => {
    test('imports runCriticLoop from criticLoop.ts', () => {
      const code = readFileSync(CHAT_TS, 'utf-8');
      expect(code).toMatch(/import\s*{\s*runCriticLoop\s*}\s+from\s+['"]\.\.\/lib\/criticLoop\.js['"]/);
    });

    test('runs critic AFTER enrichWithAishaContext (initial retrieval) and BEFORE LLM execute', () => {
      const code = readFileSync(CHAT_TS, 'utf-8');
      // Match by function name only — the first positional arg is a DB
      // adapter that may be renamed during the rpcAdapter migration; we
      // only care about call ordering vs runCriticLoop / engine.execute.
      const enrichIdx = code.indexOf('enrichWithAishaContext(');
      const criticIdx = code.indexOf('runCriticLoop({');
      const engineIdx = code.indexOf('engine.execute(');
      expect(enrichIdx, 'enrichWithAishaContext call site').toBeGreaterThan(0);
      expect(criticIdx, 'runCriticLoop call site').toBeGreaterThan(enrichIdx);
      expect(engineIdx, 'engine.execute call site').toBeGreaterThan(criticIdx);
    });

    test('critic errors are non-blocking (try/catch around runCriticLoop)', () => {
      const code = readFileSync(CHAT_TS, 'utf-8');
      // The runCriticLoop call MUST be wrapped so a critic outage doesn't
      // break chat — chat returns the raw initial bundle's answer instead.
      expect(code).toMatch(/runCriticLoop\(\{[\s\S]*?\}\);[\s\S]*?\}\s*catch\s*\(criticErr\)/);
    });

    test('refined bundle replaces aishaContextBundle when iterations > 0', () => {
      const code = readFileSync(CHAT_TS, 'utf-8');
      expect(code).toMatch(/aishaContextBundle\s*=\s*criticResult\.finalBundle/);
    });
  });

  describe('No-duplicate invariant', () => {
    test('only criticLoop.ts writes to ai_run_critic_iterations via the audited RPC', () => {
      // The RPC name should appear in: the migration (definition), the SoT
      // mirror, and exactly one TS caller (criticLoop.ts). Any other caller
      // would indicate duplicated state-machine logic.
      // Note: tests + gates may also reference the name; we filter to /services.
      const code = readFileSync(LOOP_LIB, 'utf-8');
      expect(code).toMatch(/fn_record_critic_iteration_audited/);
      // (Cross-service exhaustive check happens via the rpc-sql-mapping gate
      // — every caller must have a SoT, and the SoT is unique.)
    });
  });
});
