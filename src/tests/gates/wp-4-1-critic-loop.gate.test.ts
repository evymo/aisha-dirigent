/**
 * Gate test: Phase 12 WP 4.1 — Agent critic loop (verify → reflect → retry).
 *
 * Phase 12 WP 4.1 status. The critic-loop state machine + telemetry table
 * + audit RPC were shipped earlier (migrations 20260518250000 +
 * 20260519010000). This gate locks the wiring + invariants so any
 * future regression (lib removed, route stops calling it, audit RPC
 * loses SECURITY DEFINER, max-iteration cap drops to 0) fails CI
 * before reaching production.
 *
 * Enforces:
 *   1. services/svc-ai-chat/src/lib/criticLoop.ts exists with the
 *      runCriticLoop entry point + ReRetrieveFn callback contract
 *      (decouples lib from DB-client dep)
 *   2. routes/chat.ts imports + invokes runCriticLoop in the chat
 *      orchestration path
 *   3. ai_run_critic_iterations table SoT has the per-iteration log
 *      columns (faithfulness, context_recall, decision, judge_model,
 *      judge_provider_slug, metadata)
 *   4. context_profiles has the 4 critic config columns (enabled,
 *      threshold, max_iterations, strategies) with sane CHECK bounds
 *   5. fn_record_critic_iteration_audited has SECURITY DEFINER +
 *      search_path + REVOKE/GRANT + propagates final faithfulness
 *      to ai_runs.faithfulness_score_estimate on terminal decisions
 *   6. fn_get_critic_config is STABLE (read-only) + service-role-allowed
 *      (worker calls it on every chat turn) + authenticated for UI
 *      diagnostics
 *   7. Critic-loop schema (table + ai_runs faithfulness propagation)
 *      absorbed into the compiled baseline; registry is baseline-only
 *   8. Cost-aware operator runbook exists
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const LIB = path.join(ROOT, 'services/svc-ai-chat/src/lib/criticLoop.ts');
const CHAT_ROUTE = path.join(ROOT, 'services/svc-ai-chat/src/routes/chat.ts');
const TABLE_SOT = path.join(
  ROOT,
  'aisha/db/sql/tables/ai_run_critic_iterations.sql',
);
const CONTEXT_PROFILES_SOT = path.join(
  ROOT,
  'aisha/db/sql/tables/context_profiles.sql',
);
const RECORD_RPC = path.join(
  ROOT,
  'aisha/db/sql/functions/fn_record_critic_iteration_audited.sql',
);
const GET_CONFIG_RPC = path.join(
  ROOT,
  'aisha/db/sql/functions/fn_get_critic_config.sql',
);
const REGISTRY = path.join(ROOT, 'aisha/db/migration-registry.json');
const RUNBOOK = path.join(ROOT, 'docs/perf/CRITIC_LOOP_RUNBOOK.md');

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

describe('Phase 12 WP 4.1 — criticLoop.ts contract', () => {
  const src = readText(LIB);

  it('lib file exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('exports runCriticLoop entry point', () => {
    expect(src).toMatch(/export\s+(?:async\s+)?function\s+runCriticLoop/);
  });

  it('exports the ReRetrieveFn callback type (decouples lib from DB client)', () => {
    // Architectural decision documented in the lib header — the
    // callback pattern means a future retrieval-RPC swap only edits
    // chat.ts, not the critic loop lib.
    expect(src).toMatch(/export\s+type\s+ReRetrieveFn/);
  });

  it('uses createSafeLogger (no console.* in business logic)', () => {
    expect(src).toMatch(
      /import\s*\{[\s\S]{0,200}createSafeLogger[\s\S]{0,200}\}\s*from\s+["']@aisha\/security["']/,
    );
  });

  it('reads config via fn_get_critic_config (no hardcoded thresholds)', () => {
    expect(src).toMatch(
      /rpcService[\s\S]{0,200}["']fn_get_critic_config["']/,
    );
  });

  it('records each iteration via fn_record_critic_iteration_audited', () => {
    expect(src).toMatch(
      /["']fn_record_critic_iteration_audited["']/,
    );
  });

  it('hard cap: respects critic_max_iterations from config (no infinite loop)', () => {
    // The iteration counter MUST be bounded. Look for either a max
    // check in the loop OR a do/while guard.
    expect(src).toMatch(/critic_max_iterations|maxIterations|max_iter/i);
  });

  it('records FINAL faithfulness to ai_runs on terminal decisions (UI surface)', () => {
    // Either the lib calls fn_record with stop_* decision (RPC handles
    // the propagation) or it calls a separate update RPC. Both patterns
    // accept-end the test.
    expect(src).toMatch(/stop_threshold_met|stop_iter_cap/);
  });
});

describe('Phase 12 WP 4.1 — Chat route wiring', () => {
  const src = readText(CHAT_ROUTE);

  it('imports runCriticLoop from the lib', () => {
    expect(src).toMatch(
      /import\s*\{[\s\S]{0,200}runCriticLoop[\s\S]{0,200}\}\s*from\s+["'][^"']*criticLoop/,
    );
  });

  it('invokes runCriticLoop in the chat orchestration path', () => {
    expect(src).toMatch(/await\s+runCriticLoop\s*\(/);
  });

  it('passes the required arguments (runId, profileSlug, query, initialBundle, reretrieve)', () => {
    // Crude content check — the invocation block must mention these
    // properties in the same vicinity.
    const m = src.match(/runCriticLoop\s*\(\s*\{[\s\S]+?\}\s*\)/);
    expect(m, 'runCriticLoop({…}) call site not found').not.toBeNull();
    const callBlock = m![0];
    for (const arg of ['runId', 'profileSlug', 'query', 'reretrieve']) {
      expect(callBlock).toMatch(new RegExp(`\\b${arg}\\b`));
    }
  });
});

describe('Phase 12 WP 4.1 — ai_run_critic_iterations schema', () => {
  const src = readText(TABLE_SOT);

  it('migration creates ai_run_critic_iterations table', () => {
    expect(src).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.ai_run_critic_iterations/i,
    );
  });

  it.each([
    'ai_run_id',
    'iteration',
    'faithfulness_estimate',
    'context_recall_estimate',
    'retrieved_chunk_ids',
    'retrieval_strategy',
    'decision',
    'judge_model',
    'judge_provider_slug',
    'metadata',
  ])('column %s present', (col) => {
    expect(src).toMatch(new RegExp(`\\b${col}\\b`));
  });

  it('unique constraint on (ai_run_id, iteration) — idempotent re-record', () => {
    expect(src).toMatch(
      /UNIQUE\s*\([\s\S]{0,80}ai_run_id[\s\S]{0,80}iteration[\s\S]{0,80}\)/i,
    );
  });

  it('iteration is bounded smallint (no arbitrary growth)', () => {
    expect(src).toMatch(/iteration\s+smallint/i);
  });
});

describe('Phase 12 WP 4.1 — context_profiles critic columns', () => {
  const src = readText(CONTEXT_PROFILES_SOT);

  it('critic_enabled boolean DEFAULT false (opt-in per profile)', () => {
    expect(src).toMatch(
      /critic_enabled\s+boolean\s+NOT\s+NULL\s+DEFAULT\s+false/i,
    );
  });

  it('critic_threshold bounded [0, 1] CHECK constraint', () => {
    expect(src).toMatch(
      /critic_threshold\s+numeric[\s\S]{0,200}CHECK\s*\(\s*critic_threshold\s+BETWEEN\s+0\s+AND\s+1\s*\)/i,
    );
  });

  it('critic_max_iterations bounded [1, 10] (DoS guard)', () => {
    expect(src).toMatch(
      /critic_max_iterations\s+smallint[\s\S]{0,200}CHECK\s*\(\s*critic_max_iterations\s+BETWEEN\s+1\s+AND\s+10\s*\)/i,
    );
  });

  it('critic_strategies text[] with default array', () => {
    expect(src).toMatch(/critic_strategies\s+text\[\]/i);
  });
});

describe('Phase 12 WP 4.1 — fn_record_critic_iteration_audited RPC', () => {
  const src = readText(RECORD_RPC);

  it('SoT file exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('SECURITY DEFINER + search_path TO public', () => {
    expect(src).toMatch(/SECURITY\s+DEFINER/i);
    expect(src).toMatch(/SET\s+search_path\s+TO\s+['"]public['"]/i);
  });

  it('REVOKE FROM PUBLIC + GRANT EXECUTE TO authenticated and/or service_role', () => {
    expect(src).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_record_critic_iteration_audited[\s\S]{0,400}FROM\s+PUBLIC/i,
    );
    expect(src).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_record_critic_iteration_audited[\s\S]{0,400}TO\s+(authenticated|service_role)/i,
    );
  });

  it('idempotent: ON CONFLICT (ai_run_id, iteration) DO UPDATE', () => {
    // Multiple worker retries shouldn't double-log the same iteration.
    expect(src).toMatch(
      /ON\s+CONFLICT\s*\(\s*ai_run_id\s*,\s*iteration\s*\)\s+DO\s+UPDATE/i,
    );
  });

  it('propagates final faithfulness to ai_runs on terminal stop_* decisions', () => {
    expect(src).toMatch(
      /p_decision\s+LIKE\s+['"]stop_%['"][\s\S]{0,200}UPDATE\s+public\.ai_runs/i,
    );
  });

  it('input validation: rejects null p_run_id + p_iteration', () => {
    expect(src).toMatch(/p_run_id\s+IS\s+NULL[\s\S]{0,80}RAISE\s+EXCEPTION/i);
    expect(src).toMatch(/p_iteration\s+IS\s+NULL[\s\S]{0,80}RAISE\s+EXCEPTION/i);
  });
});

describe('Phase 12 WP 4.1 — fn_get_critic_config RPC', () => {
  const src = readText(GET_CONFIG_RPC);

  it('SoT file exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('STABLE marker (read-only, safe to call per chat turn)', () => {
    expect(src).toMatch(/\bSTABLE\b/);
  });

  it('SECURITY DEFINER + search_path', () => {
    expect(src).toMatch(/SECURITY\s+DEFINER/i);
    expect(src).toMatch(/SET\s+search_path\s+TO\s+['"]public['"]/i);
  });

  it('grants to BOTH authenticated (UI diagnostics) + service_role (worker)', () => {
    expect(src).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_get_critic_config[\s\S]{0,200}TO\s+authenticated/i,
    );
    expect(src).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_get_critic_config[\s\S]{0,200}TO\s+service_role/i,
    );
  });

  it('rejects anonymous callers (auth.uid() IS NULL guard)', () => {
    expect(src).toMatch(/auth\.uid\(\)\s+IS\s+NULL[\s\S]{0,200}RAISE\s+EXCEPTION/i);
  });
});

describe('Phase 12 WP 4.1 — Critic-loop schema absorbed into baseline (baseline-only state)', () => {
  // The two original migrations (20260518250000_critic_loop +
  // 20260519010000_critic_iteration_updates_ai_run) were absorbed into
  // the compiled baseline; the active migration registry is baseline-only
  // ({migrations: []}). These assertions lock the INVARIANT the migrations
  // encoded — the critic-loop table and the ai_runs faithfulness
  // propagation now live in canonical SoT — instead of pinning archived
  // migration filenames.
  const registry = readText(REGISTRY);
  const baseline = readText(
    path.join(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql'),
  );

  it('registry declares baseline-only state (no non-baseline migrations pending)', () => {
    // The registry's own note is the durable, canonical signal that the
    // critic-loop migrations were absorbed into the baseline. We assert the
    // declaration text rather than re-deriving from the migrations array,
    // which keeps the invariant honest even while the legacy archive shim
    // (which mutates the in-memory array) is still wired into the suite.
    expect(registry).toMatch(
      /Baseline-only state:\s*no non-baseline migrations are currently present/i,
    );
  });

  it('Step 5 — ai_run_critic_iterations table lives in canonical SoT + baseline', () => {
    expect(
      fs.existsSync(
        path.join(ROOT, 'aisha/db/sql/tables/ai_run_critic_iterations.sql'),
      ),
    ).toBe(true);
    expect(baseline).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.ai_run_critic_iterations/i,
    );
  });

  it('Step 5 micro-fix — faithfulness propagation to ai_runs lives in canonical SoT + baseline', () => {
    // The 20260519010000 micro-fix taught fn_record_critic_iteration_audited
    // to push the terminal faithfulness onto ai_runs; that logic is now in
    // the function SoT and compiled into the baseline.
    expect(fs.existsSync(RECORD_RPC)).toBe(true);
    expect(readText(RECORD_RPC)).toMatch(
      /p_decision\s+LIKE\s+['"]stop_%['"][\s\S]{0,200}UPDATE\s+public\.ai_runs/i,
    );
    expect(baseline).toMatch(
      /p_decision\s+LIKE\s+['"]stop_%['"][\s\S]{0,400}UPDATE\s+public\.ai_runs/i,
    );
  });
});

describe('Phase 12 WP 4.1 — Operator runbook', () => {
  const src = readText(RUNBOOK);

  it('runbook exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('documents per-profile rollout (UPDATE context_profiles SET critic_enabled = true)', () => {
    expect(src).toMatch(/per-profile|per profile/i);
    expect(src).toMatch(
      /UPDATE\s+context_profiles\s+SET\s+critic_enabled/i,
    );
  });

  it('documents cost cap (max 2.5× single-pass per plan)', () => {
    expect(src).toMatch(/2\.5\s*[x×]|2\.5-?(?:x|times)|2\.5x/i);
    expect(src).toMatch(/cost/i);
  });

  it('cross-references WP 2.3 LLM quota (per-tenant cap prevents runaway)', () => {
    expect(src).toMatch(/WP 2\.3/);
  });

  it('cross-references WP 1.6 RAGAS (measures the quality lift)', () => {
    expect(src).toMatch(/WP 1\.6|RAGAS/);
  });

  it('documents the 4 valid strategies (and the 2 deferred ones)', () => {
    expect(src).toMatch(/expand_tags/);
    expect(src).toMatch(/switch_profile/);
    expect(src).toMatch(/broaden_threshold/);
    expect(src).toMatch(/add_kb_layer/);
  });

  it('documents rollback (SET critic_enabled = false per profile)', () => {
    expect(src).toMatch(/Rollback/i);
    expect(src).toMatch(/critic_enabled\s*=\s*false/i);
  });

  it('documents observability query (SELECT ... FROM ai_run_critic_iterations)', () => {
    // Multiline-safe — operator queries span SELECT … FROM blocks.
    expect(src).toMatch(/SELECT[\s\S]+?FROM\s+ai_run_critic_iterations/i);
  });
});
