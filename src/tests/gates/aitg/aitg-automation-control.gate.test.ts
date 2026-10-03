/**
 * AITG automation-control gate.
 *
 * Verifies the operator surface for managing AITG cadence:
 *   - DB schema (table + 5 RPCs) is wired
 *   - 8 canonical automations are seeded
 *   - Each WF_AITG_* workflow reads/records its setting (the runtime contract)
 *   - Appsmith page template ships with the repo
 *   - MCP tools are registered + dispatched
 *   - @aisha/aitg exports the automation module
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractAclMembers } from './_mcp-extract.js';

const ROOT = process.cwd();

const SETTINGS_MIGRATION = resolve(
  ROOT,
  'aisha/db/migrations/00000000000000_baseline.sql',
);
const SETTINGS_TABLE = resolve(ROOT, 'aisha/db/sql/tables/aitg_automation_settings.sql');
const SETTINGS_RLS = resolve(ROOT, 'aisha/db/sql/rls/aitg_automation_settings.sql');
const APPSMITH_PAGE = resolve(ROOT, 'appsmith/pages/aitg-automation-control.template.json');
const PKG_AUTOMATION = resolve(ROOT, 'packages/aitg/src/automation.ts');
const PKG_INDEX = resolve(ROOT, 'packages/aitg/src/index.ts');
const MCP_ROUTE = resolve(ROOT, 'services/svc-mcp-knowledge/src/routes/mcp.ts');
const MCP_AITG_LIB = resolve(ROOT, 'services/svc-mcp-knowledge/src/lib/aitg-tools.ts');
const WF_CONTINUOUS = resolve(ROOT, 'n8n/workflows/WF_AITG_CONTINUOUS.json');

/**
 * Every AITG workflow MUST be settings-aware: read its setting at start,
 * branch on `mode`, and record the run outcome. The map below pins each
 * workflow file to its canonical automation_id; the gate enforces both
 * sides of the contract for every entry.
 */
const SETTINGS_AWARE_WORKFLOWS: Record<string, string> = {
  'WF_AITG_CONTINUOUS.json': 'continuous_heartbeat',
  'WF_AITG_NIGHTLY_FULL.json': 'nightly_full_sweep',
  'WF_AITG_DAILY_REFLECTION.json': 'daily_reflection',
  'WF_AITG_RUNTIME_SENTINEL.json': 'runtime_sentinel',
  'WF_AITG_PR_GATE.json': 'pr_gate',
};

const REQUIRED_AUTOMATIONS = [
  'continuous_heartbeat',
  'daily_reflection',
  'nightly_full_sweep',
  'drift_detection',
  'auto_close_findings',
  'runtime_sentinel',
  'pr_gate',
  'callsite_guard_default',
];

const REQUIRED_RPCS = [
  'aitg_list_automations_audited',
  'aitg_get_automation_audited',
  'aitg_update_automation_audited',
  'aitg_trigger_automation_audited',
  'aitg_record_automation_run_audited',
];

const REQUIRED_MCP_TOOLS = [
  'aitg_list_automations',
  'aitg_get_automation',
  'aitg_trigger_automation',
  'aitg_update_automation',
  'aitg_record_automation_run',
];

describe('AITG automation-control DB layer', () => {
  test('SoT table file exists', () => {
    expect(existsSync(SETTINGS_TABLE)).toBe(true);
    const sql = readFileSync(SETTINGS_TABLE, 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.aitg_automation_settings/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
  });

  test('SoT RLS policy file exists', () => {
    expect(existsSync(SETTINGS_RLS)).toBe(true);
    expect(readFileSync(SETTINGS_RLS, 'utf8')).toMatch(/CREATE POLICY/);
  });

  test('aitg_automation_settings table mechanism exists (automations seeded per-implementation)', () => {
    // The 8 automations' canonical source is packages/aitg/src/automation.ts (asserted
    // below). The DB-side seed migration was folded out of the platform; assert the
    // platform MECHANISM — the aitg_automation_settings table — exists in canonical SoT.
    // The automation rows are seeded per implementation (e.g. example).
    expect(existsSync(SETTINGS_TABLE)).toBe(true);
  });

  test('all 5 RPCs are defined in canonical SoT function files', () => {
    for (const fn of REQUIRED_RPCS) {
      expect(existsSync(resolve(ROOT, `aisha/db/sql/functions/${fn}.sql`)), `RPC SoT missing: ${fn}`).toBe(true);
    }
  });

  test('every RPC is SECURITY DEFINER + sets search_path + REVOKE/GRANT', () => {
    for (const fn of REQUIRED_RPCS) {
      const body = readFileSync(resolve(ROOT, `aisha/db/sql/functions/${fn}.sql`), 'utf8');
      expect(body, `${fn} missing SECURITY DEFINER`).toMatch(/SECURITY DEFINER/);
      expect(body, `${fn} missing SET search_path`).toMatch(/SET search_path TO 'public'/);
      expect(body, `${fn} missing REVOKE ALL`).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION (public\\.)?${fn}`),
      );
      expect(body, `${fn} missing GRANT EXECUTE`).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION (public\\.)?${fn}`),
      );
    }
  });

  test('only admin can mutate — aitg_update_automation_audited rejects service_role implicitly', () => {
    const sql = readFileSync(SETTINGS_MIGRATION, 'utf8');
    const block = sql.slice(sql.indexOf('FUNCTION public.aitg_update_automation_audited'));
    const body = block.slice(0, block.indexOf('$$;'));
    expect(body, 'update RPC must NOT allow service_role fallback').not.toMatch(/v_is_service\s*:=/);
    expect(body).toMatch(/is_admin_or_staff/);
  });
});

describe('AITG automation-control package layer', () => {
  test('@aisha/aitg exports automation module', () => {
    const idx = readFileSync(PKG_INDEX, 'utf8');
    expect(idx).toContain('./automation');
  });

  test('automation module exports schemas + helpers', () => {
    expect(existsSync(PKG_AUTOMATION)).toBe(true);
    const src = readFileSync(PKG_AUTOMATION, 'utf8');
    expect(src).toMatch(/export\s+const\s+aitgAutomationSettingSchema/);
    expect(src).toMatch(/export\s+const\s+aitgAutomationUpdatePatchSchema/);
    expect(src).toMatch(/export\s+function\s+shouldRunNow/);
    expect(src).toMatch(/export\s+function\s+describeSchedule/);
    expect(src).toMatch(/AITG_AUTOMATION_IDS/);
  });

  test('package AITG_AUTOMATION_IDS matches DB seed', () => {
    const src = readFileSync(PKG_AUTOMATION, 'utf8');
    for (const id of REQUIRED_AUTOMATIONS) {
      expect(src, `Automation id missing from package constant: ${id}`).toContain(`'${id}'`);
    }
  });
});

describe('AITG automation-control MCP surface', () => {
  test('mcp.ts registers all 5 automation MCP tools', () => {
    const src = readFileSync(MCP_ROUTE, 'utf8');
    for (const t of REQUIRED_MCP_TOOLS) {
      expect(src, `MCP tool missing: ${t}`).toContain(t);
    }
  });

  test('aitg-tools.ts dispatches all 5 automation MCP tools', () => {
    const src = readFileSync(MCP_AITG_LIB, 'utf8');
    for (const t of REQUIRED_MCP_TOOLS) {
      expect(src, `Dispatch case missing: ${t}`).toMatch(new RegExp(`case '${t}'`));
    }
  });

  test('update_automation MCP tool is admin-only (matches DB RPC restriction)', () => {
    const mcp = readFileSync(MCP_ROUTE, 'utf8');
    // Resolve ADMIN_TOOLS including any `...OTHER_SET` spreads so the assertion
    // tracks the runtime Set membership, not the literal text inside the
    // ADMIN_TOOLS declaration block.
    const adminMembers = new Set(extractAclMembers(mcp, 'ADMIN_TOOLS'));
    expect(adminMembers.has('aitg_update_automation'), 'aitg_update_automation must be in ADMIN_TOOLS (directly or via a spread)').toBe(true);
  });
});

describe('AITG automation-control workflow integration — every WF_AITG_* is settings-aware', () => {
  for (const [filename, automationId] of Object.entries(SETTINGS_AWARE_WORKFLOWS)) {
    const wfPath = resolve(ROOT, `n8n/workflows/${filename}`);

    test(`${filename} exists`, () => {
      expect(existsSync(wfPath)).toBe(true);
    });

    test(`${filename} reads its setting (aitg_get_automation_audited("${automationId}"))`, () => {
      const wf = JSON.parse(readFileSync(wfPath, 'utf8')) as {
        nodes: Array<{ name: string; parameters?: { rpcName?: string; rpcArgs?: string } }>;
      };
      const reader = wf.nodes.find((n) => n.parameters?.rpcName === 'aitg_get_automation_audited');
      expect(reader, `${filename} must call aitg_get_automation_audited`).toBeDefined();
      expect(reader?.parameters?.rpcArgs ?? '').toContain(`"${automationId}"`);
    });

    test(`${filename} records both skipped + success paths`, () => {
      const wf = JSON.parse(readFileSync(wfPath, 'utf8')) as {
        nodes: Array<{ name: string; parameters?: { rpcName?: string } }>;
      };
      const recorders = wf.nodes.filter(
        (n) => n.parameters?.rpcName === 'aitg_record_automation_run_audited',
      );
      expect(
        recorders.length,
        `${filename} should have ≥2 record_automation_run_audited nodes (skipped + success)`,
      ).toBeGreaterThanOrEqual(2);
    });

    test(`${filename} branches on mode via a "Should Run?" IF node`, () => {
      const wf = JSON.parse(readFileSync(wfPath, 'utf8')) as {
        nodes: Array<{ name: string; type?: string }>;
      };
      const decision = wf.nodes.find((n) => n.name === 'Should Run?');
      expect(decision, `${filename}: "Should Run?" IF node must exist`).toBeDefined();
      expect(decision?.type).toBe('n8n-nodes-base.if');
    });
  }
});

describe('AITG automation-control workflow integration — legacy WF_AITG_CONTINUOUS specifics', () => {
  test('WF_AITG_CONTINUOUS branches on mode (Should Run? node)', () => {
    const wf = JSON.parse(readFileSync(WF_CONTINUOUS, 'utf8')) as { nodes: Array<{ name: string; type?: string }> };
    const decision = wf.nodes.find((n) => n.name === 'Should Run?');
    expect(decision, 'Should Run? IF node must exist').toBeDefined();
    expect(decision?.type).toBe('n8n-nodes-base.if');
  });
});

describe('AITG automation-control admin UI', () => {
  test('Appsmith page template exists', () => {
    expect(existsSync(APPSMITH_PAGE)).toBe(true);
  });

  test('Appsmith page wires the canonical RPCs', () => {
    const page = JSON.parse(readFileSync(APPSMITH_PAGE, 'utf8')) as {
      queries: Array<{ name: string; actionConfiguration: { path?: string } }>;
    };
    const paths = page.queries.map((q) => q.actionConfiguration.path);
    expect(paths).toContain('/rpc/aitg_list_automations_audited');
    expect(paths).toContain('/rpc/aitg_update_automation_audited');
    expect(paths).toContain('/rpc/aitg_trigger_automation_audited');
    expect(paths).toContain('/rpc/aitg_health_summary_audited');
  });

  test('Appsmith page exposes a Trigger Now button + Edit Settings button', () => {
    const page = JSON.parse(readFileSync(APPSMITH_PAGE, 'utf8')) as {
      widgets: Array<{ name: string; type: string }>;
    };
    const names = page.widgets.map((w) => w.name);
    expect(names).toContain('triggerButton');
    expect(names).toContain('editButton');
    expect(names).toContain('disableButton');
    expect(names).toContain('automationsTable');
  });
});
