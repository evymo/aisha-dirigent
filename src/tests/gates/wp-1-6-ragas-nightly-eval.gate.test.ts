/**
 * Gate test: Phase 12 WP 1.6 — RAGAS nightly eval pipeline.
 *
 * Enforces:
 *   1. fn_detect_rag_baseline_regression SoT + migration exist
 *   2. RPC has SECURITY DEFINER + search_path + service-role-only grant
 *   3. RPC returns severity {ok,warning,critical} with sane defaults
 *      (warn 0.02 / 2.5 %, crit 0.05 / 5 % per plan SLO)
 *   4. WF_RAG_EVAL_NIGHTLY workflow has the new regression-detection +
 *      alert sub-flow (Detect Regressions → Classify → Alert IF → Send
 *      Alert) chained after Log Results
 *   5. Workflow still triggers at 02:00 UTC + still calls Run Eval Batch
 *      against /rag/eval/run + still writes audit row
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const SOT_RPC = path.join(
  ROOT,
  'aisha/db/sql/functions/fn_detect_rag_baseline_regression.sql',
);
const MIGRATION = path.join(
  ROOT,
  'aisha/db/migrations/00000000000000_baseline.sql',
);
const REGISTRY = path.join(ROOT, 'aisha/db/migration-registry.json');
const WORKFLOW = path.join(
  ROOT,
  'n8n/workflows/WF_RAG_EVAL_NIGHTLY.json',
);

interface N8nNode {
  id: string;
  name: string;
  type: string;
  parameters?: Record<string, unknown>;
}

interface N8nConnections {
  [node: string]: { main: Array<Array<{ node: string; type: string; index: number }>> };
}

interface N8nWorkflow {
  name: string;
  nodes: N8nNode[];
  connections: N8nConnections;
}

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function readWorkflow(): N8nWorkflow {
  return JSON.parse(readText(WORKFLOW)) as N8nWorkflow;
}

describe('Phase 12 WP 1.6 — SoT RPC fn_detect_rag_baseline_regression', () => {
  it('SoT file exists', () => {
    expect(fs.existsSync(SOT_RPC)).toBe(true);
  });

  it('uses SECURITY DEFINER (CLAUDE.md SECURITY DEFINER pattern)', () => {
    expect(readText(SOT_RPC)).toMatch(/SECURITY\s+DEFINER/i);
  });

  it("sets search_path TO 'public' (mandatory per CLAUDE.md)", () => {
    expect(readText(SOT_RPC)).toMatch(/SET\s+search_path\s+TO\s+'public'/i);
  });

  it('REVOKE ALL ... FROM PUBLIC before any GRANT', () => {
    const src = readText(SOT_RPC);
    expect(src).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_detect_rag_baseline_regression[\s\S]*?FROM\s+PUBLIC/i,
    );
  });

  it('GRANT EXECUTE TO service_role only (no anon / authenticated)', () => {
    const src = readText(SOT_RPC);
    expect(src).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_detect_rag_baseline_regression[\s\S]*?TO\s+service_role/i,
    );
    expect(src).not.toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_detect_rag_baseline_regression[\s\S]*?TO\s+(anon|authenticated)\b/i,
    );
  });

  it('default warn/crit thresholds match plan SLO (warn 0.02, crit 0.05)', () => {
    const src = readText(SOT_RPC);
    expect(src).toMatch(/p_warn_drop[^)]*DEFAULT\s+0\.02\b/);
    expect(src).toMatch(/p_crit_drop[^)]*DEFAULT\s+0\.05\b/);
  });

  it('default relative-drop thresholds (warn 2.5 %, crit 5 %)', () => {
    const src = readText(SOT_RPC);
    expect(src).toMatch(/p_warn_pct[^)]*DEFAULT\s+0\.025\b/);
    expect(src).toMatch(/p_crit_pct[^)]*DEFAULT\s+0\.05\b/);
  });

  it('returns severity verdict {ok,warning,critical}', () => {
    const src = readText(SOT_RPC);
    expect(src).toMatch(/'critical'/);
    expect(src).toMatch(/'warning'/);
    expect(src).toMatch(/'ok'/);
  });

  it('joins rag_eval_baselines + filters by lookback hours', () => {
    const src = readText(SOT_RPC);
    expect(src).toMatch(/FROM\s+public\.rag_eval_baselines/);
    expect(src).toMatch(/p_lookback_hours/);
  });

  it('checks auth.uid() OR service_role current_setting', () => {
    const src = readText(SOT_RPC);
    expect(src).toMatch(/auth\.uid\(\)\s+IS\s+NULL[\s\S]*?service_role/i);
  });

  it('validates p_crit_drop >= p_warn_drop (no nonsense thresholds)', () => {
    expect(readText(SOT_RPC)).toMatch(
      /p_crit_drop[\s\S]{0,80}<\s*p_warn_drop[\s\S]{0,80}RAISE\s+EXCEPTION/i,
    );
  });
});

describe('Phase 12 WP 1.6 — Migration registered', () => {
  it('migration file exists', () => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
  });

  it('migration registered in aisha/db/migration-registry.json', () => {
    expect(readText(REGISTRY)).toMatch(/Baseline-only state/i); // migration absorbed into baseline + archived; active registry is baseline-only
  });

  it('migration uses CREATE OR REPLACE (idempotent re-run)', () => {
    expect(readText(MIGRATION)).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_detect_rag_baseline_regression/i,
    );
  });
});

describe('Phase 12 WP 1.6 — n8n workflow chain', () => {
  it('workflow file exists + parses', () => {
    expect(() => readWorkflow()).not.toThrow();
  });

  it('triggers at 02:00 UTC daily', () => {
    const wf = readWorkflow();
    const cron = wf.nodes.find((n) => n.id === 'rag-eval-cron');
    expect(cron).toBeDefined();
    const interval = (cron!.parameters as { rule?: { interval?: Array<{ triggerAtHour: number }> } }).rule?.interval?.[0];
    expect(interval?.triggerAtHour).toBe(2);
  });

  it('still calls /rag/eval/run service endpoint', () => {
    const src = readText(WORKFLOW);
    expect(src).toMatch(/\/rag\/eval\/run/);
  });

  it('includes 4 new nodes for regression detection + alert', () => {
    const wf = readWorkflow();
    const names = wf.nodes.map((n) => n.name);
    expect(names).toContain('Detect Regressions');
    expect(names).toContain('Classify Regression');
    expect(names).toContain('Alert if Warn or Critical');
    expect(names).toContain('Send Alert (Matrix/Slack)');
  });

  it('Detect Regressions node POSTs to /rpc/fn_detect_rag_baseline_regression', () => {
    const wf = readWorkflow();
    const detect = wf.nodes.find((n) => n.name === 'Detect Regressions')!;
    expect(detect.type).toBe('n8n-nodes-base.httpRequest');
    expect((detect.parameters as { url: string }).url).toMatch(
      /\/rpc\/fn_detect_rag_baseline_regression/,
    );
  });

  it('Alert gate is an IF node comparing severity != info', () => {
    const wf = readWorkflow();
    const gate = wf.nodes.find((n) => n.name === 'Alert if Warn or Critical')!;
    expect(gate.type).toBe('n8n-nodes-base.if');
    const src = JSON.stringify(gate.parameters);
    expect(src).toMatch(/regression_top_severity/);
    expect(src).toMatch(/notEquals/);
  });

  it('Send Alert posts to Matrix/Slack webhook env', () => {
    const wf = readWorkflow();
    const send = wf.nodes.find((n) => n.name === 'Send Alert (Matrix/Slack)')!;
    expect(send.type).toBe('n8n-nodes-base.httpRequest');
    const url = (send.parameters as { url: string }).url;
    expect(url).toMatch(/MATRIX_WEBHOOK_URL|OPS_ALERT_WEBHOOK_URL/);
  });

  it('Audit Log still records regression-counts metadata', () => {
    const src = readText(WORKFLOW);
    expect(src).toMatch(/regression_critical_count/);
    expect(src).toMatch(/regression_warning_count/);
    expect(src).toMatch(/rag_eval\.nightly_batch_completed/);
  });

  it('connection graph: Log Results → Detect Regressions → Classify → IF', () => {
    const wf = readWorkflow();
    const c = wf.connections;
    const downstream = (name: string) =>
      (c[name]?.main?.[0] ?? []).map((x) => x.node);
    expect(downstream('Log Results')).toContain('Detect Regressions');
    expect(downstream('Detect Regressions')).toContain('Classify Regression');
    expect(downstream('Classify Regression')).toContain('Alert if Warn or Critical');
    expect(downstream('Alert if Warn or Critical')).toContain(
      'Send Alert (Matrix/Slack)',
    );
  });

  it('Classify Regression fans out to BOTH Alert IF and Audit Log', () => {
    const wf = readWorkflow();
    const downstream =
      wf.connections['Classify Regression']?.main?.[0]?.map((x) => x.node) ?? [];
    expect(downstream).toContain('Alert if Warn or Critical');
    expect(downstream).toContain('Audit Log');
  });
});
