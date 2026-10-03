/**
 * Playwright QA dashboard gate.
 *
 * Mirrors the AITG automation-control gate. Verifies the operator surface for
 * the Playwright runner:
 *  - DB layer: SoT + migration + every RPC is SECURITY DEFINER + REVOKE/GRANT
 *  - Production-integration RPCs accept the new optional params (story_id, app_name)
 *  - Appsmith page wires the canonical RPCs + carries the buttons/modals the operator needs
 *  - Operator runbook ships beside the page
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

const MIGRATION_RUNNER = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const MIGRATION_PROD = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const MIGRATION_DASH = resolve(ROOT, 'aisha/db/migrations/00000000000000_baseline.sql');
const SOT_TABLE = resolve(ROOT, 'aisha/db/sql/tables/playwright_runs.sql');
const SOT_LIST = resolve(ROOT, 'aisha/db/sql/functions/list_playwright_runs.sql');
const SOT_HEALTH = resolve(ROOT, 'aisha/db/sql/functions/get_playwright_runs_health_summary.sql');
const SOT_RESOLVE = resolve(ROOT, 'aisha/db/sql/functions/resolve_deployed_url.sql');
const SOT_START = resolve(ROOT, 'aisha/db/sql/functions/start_playwright_run.sql');
const SOT_RECORD = resolve(ROOT, 'aisha/db/sql/functions/record_playwright_result.sql');
const SOT_APPROVE = resolve(ROOT, 'aisha/db/sql/functions/approve_playwright_run.sql');
const APPSMITH_PAGE = resolve(ROOT, 'appsmith/pages/playwright-qa.template.json');

const DASHBOARD_RPCS = ['list_playwright_runs', 'get_playwright_runs_health_summary'];

describe('Playwright QA — DB layer', () => {
  test('SoT table file gained the production-integration columns', () => {
    expect(existsSync(SOT_TABLE)).toBe(true);
    const sql = readFileSync(SOT_TABLE, 'utf8');
    expect(sql).toMatch(/app_name text/);
    expect(sql).toMatch(/active_slot text CHECK \(active_slot IN \('blue', 'green'\)\)/);
    expect(sql).toMatch(/story_id uuid REFERENCES public\.partner_stories/);
    expect(sql).toMatch(/triggered_rollback_id uuid REFERENCES public\.rollback_history/);
  });

  test('all three migrations exist (runner + production integration + dashboard)', () => {
    expect(existsSync(MIGRATION_RUNNER)).toBe(true);
    expect(existsSync(MIGRATION_PROD)).toBe(true);
    expect(existsSync(MIGRATION_DASH)).toBe(true);
  });

  test('production-integration migration adds resolve_deployed_url + rewires the 3 lifecycle RPCs', () => {
    const sql = readFileSync(MIGRATION_PROD, 'utf8');
    expect(sql).toContain('FUNCTION public.resolve_deployed_url(p_app_name text)');
    expect(sql).toContain('FUNCTION public.start_playwright_run');
    expect(sql).toContain('p_story_id uuid');
    expect(sql).toContain('p_app_name text');
    expect(sql).toContain('FUNCTION public.record_playwright_result');
    expect(sql).toContain('request_rollback');
    expect(sql).toContain('FUNCTION public.approve_playwright_run');
    expect(sql).toContain('Segregation of duties');
  });

  test('start_playwright_run captures active_slot when app_name is passed', () => {
    const sql = readFileSync(SOT_START, 'utf8');
    expect(sql).toMatch(/resolve_deployed_url/);
    expect(sql).toMatch(/v_active_slot/);
  });

  test('record_playwright_result updates {slot}_health on app-linked runs', () => {
    const sql = readFileSync(SOT_RECORD, 'utf8');
    expect(sql).toMatch(/UPDATE public\.coolify_app_slots SET %I/);
    expect(sql).toMatch(/_health/);
  });

  test('record_playwright_result auto-calls request_rollback on staging_auto failure', () => {
    const sql = readFileSync(SOT_RECORD, 'utf8');
    expect(sql).toMatch(/v_run\.trigger_kind\s*=\s*'staging_auto'/);
    expect(sql).toMatch(/request_rollback/);
    expect(sql).toMatch(/triggered_rollback_id/);
  });

  test('approve_playwright_run enforces segregation of duties (approver != requester)', () => {
    const sql = readFileSync(SOT_APPROVE, 'utf8');
    expect(sql).toMatch(/requested_by\s*=\s*auth\.uid\(\)/);
    expect(sql).toMatch(/Segregation of duties/);
  });

  test('story-linked runs emit qa_playwright_* entries on every transition', () => {
    const start = readFileSync(SOT_START, 'utf8');
    const record = readFileSync(SOT_RECORD, 'utf8');
    const approve = readFileSync(SOT_APPROVE, 'utf8');
    expect(start).toMatch(/'qa_playwright_requested'/);
    expect(approve).toMatch(/'qa_playwright_approved'/);
    expect(record).toMatch(/'qa_playwright_passed'/);
    expect(record).toMatch(/'qa_playwright_failed'/);
  });

  test('dashboard migration defines both RPCs and gates them admin/staff', () => {
    const sql = readFileSync(MIGRATION_DASH, 'utf8');
    for (const fn of DASHBOARD_RPCS) {
      expect(sql, `dashboard RPC missing: ${fn}`).toContain(fn);
    }
    expect(sql).toMatch(/is_admin_or_staff/);
  });

  test('every dashboard RPC is SECURITY DEFINER + sets search_path + REVOKE/GRANT', () => {
    const sql = readFileSync(MIGRATION_DASH, 'utf8');
    for (const fn of DASHBOARD_RPCS) {
      const startIdx = sql.indexOf(`FUNCTION public.${fn}`);
      const bodyEnd = sql.indexOf('$$;', startIdx);
      const body = sql.slice(startIdx, bodyEnd);
      expect(body, `${fn} missing SECURITY DEFINER`).toMatch(/SECURITY DEFINER/);
      expect(body, `${fn} missing SET search_path`).toMatch(/SET search_path TO 'public'/);
      const tail = sql.slice(bodyEnd, bodyEnd + 1500);
      expect(tail, `${fn} missing REVOKE ALL`).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}`),
      );
      expect(tail, `${fn} missing GRANT EXECUTE`).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}`),
      );
    }
  });

  test('resolve_deployed_url SoT file ships beside the migration', () => {
    expect(existsSync(SOT_RESOLVE)).toBe(true);
    expect(existsSync(SOT_LIST)).toBe(true);
    expect(existsSync(SOT_HEALTH)).toBe(true);
  });
});

describe('Playwright QA — Appsmith surface', () => {
  test('Appsmith page template exists', () => {
    expect(existsSync(APPSMITH_PAGE)).toBe(true);
  });

  test('Appsmith page wires the canonical RPCs', () => {
    const page = JSON.parse(readFileSync(APPSMITH_PAGE, 'utf8')) as {
      queries: Array<{ name: string; actionConfiguration: { path?: string } }>;
    };
    const paths = page.queries.map((q) => q.actionConfiguration.path);
    expect(paths).toContain('/rpc/list_playwright_runs');
    expect(paths).toContain('/rpc/get_playwright_runs_health_summary');
    expect(paths).toContain('/rpc/start_playwright_run');
    expect(paths).toContain('/rpc/approve_playwright_run');
    // Audit-on-view (the iframe is rendered against the storage REST endpoint
    // directly using the operator's session — no signed URL dance).
    expect(paths).toContain('/rpc/log_integration_action');
  });

  test('Appsmith page carries the buttons the runbook references', () => {
    const page = JSON.parse(readFileSync(APPSMITH_PAGE, 'utf8')) as {
      widgets: Array<{ name: string; type: string }>;
    };
    const names = page.widgets.map((w) => w.name);
    expect(names).toContain('runsTable');
    expect(names).toContain('triggerRunButton');
    expect(names).toContain('approveButton');
    expect(names).toContain('viewReportButton');
    expect(names).toContain('openStoryButton');
    expect(names).toContain('triggerRunModal');
    expect(names).toContain('reportModal');
  });

  test('Approve button is disabled when requester == current user (segregation of duties)', () => {
    const page = readFileSync(APPSMITH_PAGE, 'utf8');
    expect(page).toMatch(/requested_by\s*===\s*appsmith\.user\.id/);
  });

  test('Trigger Run modal defaults to "Resolve URL from coolify_app_slots"', () => {
    const page = readFileSync(APPSMITH_PAGE, 'utf8');
    expect(page).toMatch(/use_app_lookup/);
    expect(page).toMatch(/'auto'/);
  });
});
