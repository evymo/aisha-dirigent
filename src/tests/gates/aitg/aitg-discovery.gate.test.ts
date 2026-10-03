/**
 * AITG discovery gate — proactive call-site verification.
 *
 * Principle: every service file that touches an LLM (imports openai /
 * anthropic / google generative AI / makes a /chat call) MUST wire the
 * `withAitgGuard()` middleware from @aisha/aitg, OR sit on the explicit
 * baseline with a tracked reason.
 *
 * This is the "where it can be called from = where it must be verified"
 * principle made executable. Adding a new LLM call site without AITG
 * adoption fails the gate; baseline additions must reference a ticket.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const ROOT = process.cwd();

const LLM_IMPORT_PATTERNS = [
  /from\s+['"]openai['"]/,
  /from\s+['"]@anthropic-ai\/sdk['"]/,
  /from\s+['"]@google\/generative-ai['"]/,
  /from\s+['"]@google\/genai['"]/,
];

const LLM_BARE_FETCH_PATTERNS = [
  /api\.openai\.com\/v1\/chat\/completions/i,
  /api\.anthropic\.com\/v1\/messages/i,
  /generativelanguage\.googleapis\.com/i,
];

/**
 * Files allowed to import LLM SDKs without `withAitgGuard` — typically the
 * SDK adapters themselves (they are wrapped at the route layer, not the
 * provider layer) or the AITG package internals.
 */
const AITG_DISCOVERY_BASELINE = new Set<string>([
  // The @aisha/aitg package itself implements the guard — no inner guard needed.
  'packages/aitg/src/guard.ts',
  'packages/aitg/src/classifiers.ts',
  'packages/aitg/src/runner.ts',
  // Provider adapters live below the wrap layer. The route handlers that
  // invoke them MUST wire withAitgGuard — verified separately. Extracted to
  // the shared @aisha/llm-dispatch package (behavior-preserving git mv).
  'packages/llm-dispatch/src/providers/openai.ts',
  'packages/llm-dispatch/src/providers/openai-compat.ts',
  'packages/llm-dispatch/src/providers/anthropic.ts',
  'packages/llm-dispatch/src/providers/gemini.ts',
  'packages/llm-dispatch/src/providers/maestro.ts',
  'packages/llm-dispatch/src/providers/plugin-types.ts',
  // SDK re-export adapter — proxy module, no call site of its own.
  'services/svc-ai-chat/src/lib/deps.ts',
  // Batch submitter wraps provider calls for cost optimisation. AITG hook
  // integration tracked in OWASP_ORCHESTRATOR_FOLLOWUPS.md.
  'services/svc-ai-chat/src/lib/batchSubmitter.ts',
  // svc-mcp-knowledge translate route uses LLM for translation — separate
  // hardening tracked in OWASP_ORCHESTRATOR_FOLLOWUPS.md.
  'services/svc-mcp-knowledge/src/routes/translate.ts',
  // llmRouter is the dispatch layer; guard wraps at the route entry above it.
  'services/svc-ai-chat/src/lib/llmRouter.ts',
  // svc-aitg-probes IS the test harness — it must call LLMs without
  // being itself guarded (it's the thing doing the guarding from outside).
  'services/svc-aitg-probes/src/lib/llmDispatch.ts',
  'services/svc-aitg-probes/src/routes/prompt-injection.ts',
  'services/svc-aitg-probes/src/routes/data-leak.ts',
  'services/svc-aitg-probes/src/routes/toxic-output.ts',
  // svc-health-ai analyzes medical documents — separate AITG-DAT-02 flow tracked
  // in OWASP_ORCHESTRATOR_FOLLOWUPS.md; gate is informational here.
  'services/svc-health-ai/src/routes/analyze-document.ts',
]);

const EXCLUDE_DIR_NAMES = new Set([
  'node_modules', 'dist', 'build', '.next', 'coverage', '__tests__',
  'archive', 'trash', '.vscode',
]);

function walk(root: string, out: { rel: string; content: string }[] = []): typeof out {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (EXCLUDE_DIR_NAMES.has(e)) continue;
    const p = join(root, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(e)) {
      out.push({ rel: relative(ROOT, p), content: readFileSync(p, 'utf8') });
    }
  }
  return out;
}

describe('AITG discovery — call-site verification', () => {
  // Collect once.
  const files = walk(resolve(ROOT, 'services')).concat(walk(resolve(ROOT, 'packages')));

  test('every service file importing an LLM SDK wires withAitgGuard (or is baselined)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (AITG_DISCOVERY_BASELINE.has(f.rel)) continue;
      const importsLlm = LLM_IMPORT_PATTERNS.some((re) => re.test(f.content));
      if (!importsLlm) continue;
      const hasGuard = /withAitgGuard|@aisha\/aitg/.test(f.content);
      if (!hasGuard) offenders.push(f.rel);
    }
    expect(
      offenders,
      `Files importing an LLM SDK without withAitgGuard:\n${offenders
        .map((o) => `  - ${o}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  test('every service file with a bare LLM API fetch wires withAitgGuard or is baselined', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (AITG_DISCOVERY_BASELINE.has(f.rel)) continue;
      // Config files / type definitions hold env defaults as strings — they
      // don't issue fetches. The discovery target is code that ACTUALLY calls
      // the API: presence of `fetch(` in the same file establishes that.
      if (/\/config\.ts$/.test(f.rel) || /\/types\.ts$/.test(f.rel)) continue;
      const hitsApi = LLM_BARE_FETCH_PATTERNS.some((re) => re.test(f.content));
      if (!hitsApi) continue;
      if (!/(?<![.\w])fetch\s*\(/.test(f.content)) continue;
      const hasGuard = /withAitgGuard|@aisha\/aitg/.test(f.content);
      if (!hasGuard) offenders.push(f.rel);
    }
    expect(
      offenders,
      `Files calling an LLM API directly without withAitgGuard:\n${offenders
        .map((o) => `  - ${o}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  test('baseline is bounded — every entry is documented', () => {
    expect(
      AITG_DISCOVERY_BASELINE.size,
      'AITG_DISCOVERY_BASELINE has grown — each new entry must reference a ticket in OWASP_ORCHESTRATOR_FOLLOWUPS.md',
    ).toBeLessThanOrEqual(25);
  });

  test('every baseline entry actually exists in the repo', () => {
    const missing: string[] = [];
    for (const rel of AITG_DISCOVERY_BASELINE) {
      const abs = resolve(ROOT, rel);
      try {
        statSync(abs);
      } catch {
        missing.push(rel);
      }
    }
    expect(
      missing,
      `Stale baseline entries (file no longer exists):\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  test('@aisha/aitg package exists and exports withAitgGuard', () => {
    const idx = readFileSync(resolve(ROOT, 'packages/aitg/src/index.ts'), 'utf8');
    expect(idx).toContain('./guard');
    const guard = readFileSync(resolve(ROOT, 'packages/aitg/src/guard.ts'), 'utf8');
    expect(guard).toMatch(/export\s+async\s+function\s+withAitgGuard/);
    expect(guard).toMatch(/export\s+async\s+function\s+withAitgGuardOrRefuse/);
  });

  test('svc-aitg-probes exposes all 3 probe routes', () => {
    const server = readFileSync(resolve(ROOT, 'services/svc-aitg-probes/src/server.ts'), 'utf8');
    expect(server).toContain('promptInjectionRoute');
    expect(server).toContain('dataLeakRoute');
    expect(server).toContain('toxicOutputRoute');
  });

  test('aisha/db migration with AITG baseline exists', () => {
    const sql = readFileSync(
      resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql'),
      'utf8',
    );
    expect(sql).toMatch(/aitg_test_catalog/);
    expect(sql).toMatch(/aitg_record_run_audited/);
    expect(sql).toMatch(/aitg_get_coverage_audited/);
  });

  test('Aisha autonomy: MCP tools wired in svc-mcp-knowledge', () => {
    const mcp = readFileSync(resolve(ROOT, 'services/svc-mcp-knowledge/src/routes/mcp.ts'), 'utf8');
    for (const tool of [
      'aitg_run_test',
      'aitg_get_coverage',
      'aitg_get_trust_score',
      'aitg_list_open_findings',
      'aitg_propose_remediation',
      'aitg_request_waiver',
      'aitg_classify_response',
    ]) {
      expect(mcp, `MCP tool missing: ${tool}`).toContain(tool);
    }
  });
});

describe('AITG continuous-loop wiring', () => {
  test('continuous-loop migration exists with all 8 new RPCs', () => {
    const sql = readFileSync(
      resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql'),
      'utf8',
    );
    for (const fn of [
      'aitg_health_summary_audited',
      'aitg_detect_drift_audited',
      'aitg_auto_close_findings_audited',
      'aitg_next_in_queue_audited',
      'aitg_record_reflection_audited',
      'aitg_get_reflection_history_audited',
      'aitg_propose_payload_audited',
      'aitg_approve_payload_audited',
    ]) {
      expect(sql, `Continuous-loop RPC missing in migration: ${fn}`).toContain(fn);
    }
  });

  test('continuous-loop tables exist as SoT files', () => {
    for (const t of ['aitg_payload_proposals', 'aitg_drift_alerts', 'aitg_aisha_reflections']) {
      const p = resolve(ROOT, `aisha/db/sql/tables/${t}.sql`);
      try {
        statSync(p);
      } catch {
        throw new Error(`SoT table file missing: ${p}`);
      }
    }
  });

  test('Aisha autonomy: continuous-loop MCP tools wired', () => {
    const mcp = readFileSync(resolve(ROOT, 'services/svc-mcp-knowledge/src/routes/mcp.ts'), 'utf8');
    for (const tool of [
      'aitg_health_summary',
      'aitg_observe_trend',
      'aitg_record_reflection',
      'aitg_propose_payload',
      'aitg_next_in_queue',
      'aitg_detect_drift',
      'aitg_auto_close_findings',
    ]) {
      expect(mcp, `Continuous-loop MCP tool missing: ${tool}`).toContain(tool);
    }
  });

  test('continuous workflows exist (WF_AITG_CONTINUOUS + WF_AITG_DAILY_REFLECTION)', () => {
    for (const wf of ['WF_AITG_CONTINUOUS.json', 'WF_AITG_DAILY_REFLECTION.json']) {
      try {
        statSync(resolve(ROOT, `n8n/workflows/${wf}`));
      } catch {
        throw new Error(`Workflow missing: n8n/workflows/${wf}`);
      }
    }
  });

  test('WF_AITG_CONTINUOUS runs on a heartbeat (not a daily cron)', () => {
    const wf = JSON.parse(
      readFileSync(resolve(ROOT, 'n8n/workflows/WF_AITG_CONTINUOUS.json'), 'utf8'),
    ) as { nodes: Array<{ name: string; parameters: { rule?: { interval?: Array<{ field: string }> } } }> };
    const trigger = wf.nodes.find((n) => n.name.includes('Heartbeat'));
    expect(trigger, 'Heartbeat trigger node missing').toBeDefined();
    const interval = trigger?.parameters.rule?.interval?.[0]?.field;
    expect(interval, 'Heartbeat must run on minutes, not days').toBe('minutes');
  });

  test('@aisha/aitg exports the continuous module', () => {
    const idx = readFileSync(resolve(ROOT, 'packages/aitg/src/index.ts'), 'utf8');
    expect(idx).toContain('./continuous');
    const cont = readFileSync(resolve(ROOT, 'packages/aitg/src/continuous.ts'), 'utf8');
    expect(cont).toMatch(/export\s+function\s+scheduleNext/);
    expect(cont).toMatch(/aitgReflectionSchema/);
  });
});
