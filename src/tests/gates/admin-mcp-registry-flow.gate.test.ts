/**
 * AdminMcpServerRegistry Flow — Gate Tests
 *
 * Locks in structural contract for the operator-visibility UI loop:
 *   1. SoT RPCs exist (get_mcp_registry_admin + update_mcp_status_admin)
 *      with is_admin_or_staff() gate
 *   2. update_mcp_status_admin enforces state machine transitions
 *      (operator can't do random status jumps)
 *   3. Migration registers both RPCs with proper auth/grants
 *   4. useMcpRegistry hook exists with Zod schemas + admin gate
 *   5. AdminMcpServerRegistry page exists with required UI elements
 *   6. Route registered at /admin/mcp-registry
 *   7. i18n keys present in EN + CS admin segments
 *
 * Without all pieces wired, operator can see MCP test results flowing
 * into DB (via PR #81 WF_MCP_PROBE) but has no UI to inspect or transition.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");

function readFile(rel: string): string {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return "";
  return fs.readFileSync(abs, "utf-8");
}

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("AdminMcpServerRegistry Flow — structural integrity", () => {
  // ── SoT layer ──────────────────────────────────────────────────────────────
  it("SoT: get_mcp_registry_admin.sql exists with admin gate + grants", () => {
    const sot = readFile("aisha/db/sql/functions/get_mcp_registry_admin.sql");
    expect(sot.length).toBeGreaterThan(100);
    expect(stripSqlComments(sot)).toMatch(/SECURITY\s+DEFINER/);
    expect(stripSqlComments(sot)).toMatch(/is_admin_or_staff\(\)/);
    expect(stripSqlComments(sot)).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]*?FROM\s+PUBLIC/);
    expect(stripSqlComments(sot)).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?TO\s+authenticated/);
  });

  it("SoT: get_mcp_registry_admin sorts by operational lifecycle priority", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/get_mcp_registry_admin.sql",
    ));
    // Status case expression covers all 7 states in operational-priority order
    expect(sot).toMatch(/CASE\s+m\.status[\s\S]+'in_use'[\s\S]+'enabled'[\s\S]+'tested_ok'[\s\S]+'discovered'[\s\S]+'tested_failed'[\s\S]+'deprecated'[\s\S]+'rejected'/);
  });

  it("SoT: update_mcp_status_admin enforces state machine transitions", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/update_mcp_status_admin.sql",
    ));
    // Must validate transitions, not allow any → any
    expect(
      sot,
      "must use explicit valid_transition CASE — random status jumps would break lifecycle assumptions downstream",
    ).toMatch(/v_valid_transition[\s\S]+CASE[\s\S]+WHEN\s+v_old_status\s*=/);
    // Must reject invalid transitions with RAISE EXCEPTION
    expect(sot).toMatch(/IF\s+NOT\s+v_valid_transition\s+THEN[\s\S]+RAISE\s+EXCEPTION/);
  });

  it("SoT: update_mcp_status_admin allowed transitions match docs", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/update_mcp_status_admin.sql",
    ));
    // Spot-check key transitions documented in the function header:
    //   discovered    → tested_ok / tested_failed / rejected
    //   tested_ok     → enabled / rejected / deprecated
    //   enabled       → in_use / deprecated
    //   in_use        → deprecated
    expect(sot).toMatch(/v_old_status\s*=\s*'discovered'[\s\S]+'tested_ok'[\s\S]+'tested_failed'/);
    expect(sot).toMatch(/v_old_status\s*=\s*'tested_ok'[\s\S]+'enabled'/);
    expect(sot).toMatch(/v_old_status\s*=\s*'enabled'[\s\S]+'in_use'/);
    expect(sot).toMatch(/v_old_status\s*=\s*'in_use'[\s\S]+'deprecated'/);
  });

  it("SoT: update_mcp_status_admin uses FOR UPDATE row lock + audit", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/update_mcp_status_admin.sql",
    ));
    expect(sot).toMatch(/FROM\s+mcp_server_registry[\s\S]+FOR\s+UPDATE/);
    expect(sot).toMatch(/INSERT\s+INTO\s+audit_journal[\s\S]+'MCP_STATUS_UPDATED'/);
  });

  it("SoT: update_mcp_status_admin handles no-op idempotency (same status)", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/update_mcp_status_admin.sql",
    ));
    // If operator clicks same status as current, RPC succeeds without audit/update
    expect(
      sot,
      "must return success early when old_status = new_status (no-op idempotency)",
    ).toMatch(/IF\s+v_old_status\s*=\s*p_new_status/);
  });

  // ── Migration layer ──────────────────────────────────────────────────────
  it("SoT: admin MCP registry RPCs defined in canonical function files", () => {
    const mig =
      readFile("aisha/db/sql/functions/get_mcp_registry_admin.sql") +
      "\n" +
      readFile("aisha/db/sql/functions/update_mcp_status_admin.sql");
    expect(mig.length).toBeGreaterThan(100);
    expect(mig).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_mcp_registry_admin/);
    expect(mig).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.update_mcp_status_admin/);
  });

  it("SoT: grants do NOT include 'anon' (admin-only catalog)", () => {
    const mig =
      readFile("aisha/db/sql/functions/get_mcp_registry_admin.sql") +
      "\n" +
      readFile("aisha/db/sql/functions/update_mcp_status_admin.sql");
    const grants = mig.match(/GRANT\s+EXECUTE[\s\S]+?;/g) ?? [];
    expect(grants.length).toBeGreaterThanOrEqual(2);
    for (const grant of grants) {
      expect(grant, `must NOT include 'anon': ${grant.slice(0, 80)}`).not.toMatch(/\bTO\s+anon\b/);
    }
  });

  // ── Hook layer ──────────────────────────────────────────────────────────
  it("Hook: useMcpRegistry exports query + mutation hooks + MCP_STATUSES + types", () => {
    const src = readFile("src/hooks/useMcpRegistry.ts");
    expect(src.length).toBeGreaterThan(100);
    expect(src).toMatch(/export\s+function\s+useMcpRegistry\b/);
    expect(src).toMatch(/export\s+function\s+useUpdateMcpStatus\b/);
    expect(src).toMatch(/export\s+const\s+MCP_STATUSES\b/);
    expect(src).toMatch(/export\s+type\s+McpRegistryRow\b/);
    expect(src).toMatch(/export\s+type\s+McpStatus\b/);
  });

  it("Hook: useMcpRegistry uses Zod parse + view_admin_dashboard gate", () => {
    const src = readFile("src/hooks/useMcpRegistry.ts");
    expect(src).toMatch(/z\.array\(McpRegistryRowSchema\)\.parse/);
    expect(src).toMatch(/hasPermission\(["']view_admin_dashboard["']\)/);
  });

  it("Hook: useUpdateMcpStatus invalidates ['mcp-registry'] on success", () => {
    const src = readFile("src/hooks/useMcpRegistry.ts");
    expect(src).toMatch(/invalidateQueries\(\s*\{\s*queryKey:\s*\[["']mcp-registry["']\]\s*\}\s*\)/);
  });

  // ── Page layer ─────────────────────────────────────────────────────────
  it("Page: AdminMcpServerRegistry.tsx exists with default export", () => {
    const src = readFile("src/pages/admin/AdminMcpServerRegistry.tsx");
    expect(src.length).toBeGreaterThan(100);
    expect(src).toMatch(/export\s+default\s+function\s+AdminMcpServerRegistry/);
  });

  it("Page: AdminMcpServerRegistry imports and uses both hook exports", () => {
    const src = readFile("src/pages/admin/AdminMcpServerRegistry.tsx");
    expect(src).toMatch(/useMcpRegistry/);
    expect(src).toMatch(/useUpdateMcpStatus/);
  });

  // ── Router layer ───────────────────────────────────────────────────────
  it("Router: /admin/mcp-registry route registered", () => {
    const router = readFile("src/router.tsx");
    expect(router).toMatch(/lazy\(\(\)\s*=>\s*import\(["']\.\/pages\/admin\/AdminMcpServerRegistry["']\)\)/);
    expect(router).toMatch(/path=["']mcp-registry["']/);
  });

  // ── i18n layer ─────────────────────────────────────────────────────────
  it("i18n: EN admin.json has mcpRegistry block with required keys", () => {
    const en = JSON.parse(readFile("src/i18n/segments/en/admin.json"));
    const block = en.admin?.mcpRegistry;
    expect(block, "admin.mcpRegistry block missing in EN").toBeDefined();
    const requiredKeys = [
      "title", "description",
      "total", "active", "tested", "failed", "retired",
      "filters", "transport", "statusFilter", "activeOnly",
      "servers", "slug", "status", "lastTested", "failures", "capabilityTags", "actions",
      "exposesLlm", "noServers", "statusChanged",
    ];
    for (const k of requiredKeys) {
      expect(block[k], `EN admin.mcpRegistry.${k} missing`).toBeDefined();
    }
  });

  it("i18n: CS admin.json has same mcpRegistry keys as EN", () => {
    const en = JSON.parse(readFile("src/i18n/segments/en/admin.json"));
    const cs = JSON.parse(readFile("src/i18n/segments/cs/admin.json"));
    const enKeys = Object.keys(en.admin?.mcpRegistry ?? {});
    const csKeys = Object.keys(cs.admin?.mcpRegistry ?? {});
    const missing = enKeys.filter((k) => !csKeys.includes(k));
    expect(missing, `CS missing: ${missing.join(", ")}`).toEqual([]);
  });
});
