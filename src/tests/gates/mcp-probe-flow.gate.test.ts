/**
 * MCP Probe Flow — Gate Tests
 *
 * Locks in the structural contract for the periodic MCP-server-probe loop:
 *   1. get_mcp_servers_due_probe SoT exists with proper auth + grants
 *   2. Migration registers the RPC with service_role-only grants
 *   3. WF_MCP_PROBE workflow exists + has all required nodes
 *   4. Workflow uses existing aisha_test_mcp_server (audit) +
 *      aisha_record_mcp_test_result (record) RPCs — does NOT duplicate them
 *
 * Without this loop, mcp_server_registry.last_tested_at stays NULL forever
 * for newly-registered servers and stale for old ones. AISHA's reflection
 * graph mcp_test node can still trigger probes on-demand, but periodic
 * autonomy requires this scheduler.
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

describe("MCP Probe Flow — structural integrity", () => {
  // ── SoT layer ──────────────────────────────────────────────────────────────
  it("SoT: get_mcp_servers_due_probe.sql exists with proper auth + grants", () => {
    const sot = readFile(
      "aisha/db/sql/functions/get_mcp_servers_due_probe.sql",
    );
    expect(sot.length, "SoT function must exist").toBeGreaterThan(100);
    expect(stripSqlComments(sot)).toMatch(/SECURITY\s+DEFINER/);
    expect(stripSqlComments(sot)).toMatch(/SET\s+search_path\s+TO\s+'public'/);
    expect(stripSqlComments(sot)).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]*?FROM\s+PUBLIC/);
    expect(stripSqlComments(sot)).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?TO\s+service_role/);
  });

  it("SoT: get_mcp_servers_due_probe excludes stdio transport (n8n can't probe stdio)", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/get_mcp_servers_due_probe.sql",
    ));
    expect(
      sot,
      "must exclude transport='stdio' — n8n can't execute stdio probes; those belong to in-process mcp_test node in reflection runner",
    ).toMatch(/transport\s*!=\s*'stdio'/);
  });

  it("SoT: get_mcp_servers_due_probe excludes rejected + deprecated status", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/get_mcp_servers_due_probe.sql",
    ));
    expect(
      sot,
      "must filter NOT IN (rejected, deprecated) — operator has retired these",
    ).toMatch(/status\s+NOT\s+IN\s*\([^)]*'rejected'/);
    expect(sot).toMatch(/status\s+NOT\s+IN\s*\([^)]*'deprecated'/);
  });

  it("SoT: get_mcp_servers_due_probe rate-limits via last_tested_at + NULLs-first order", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/get_mcp_servers_due_probe.sql",
    ));
    expect(sot).toMatch(/last_tested_at\s+IS\s+NULL|last_tested_at\s*<\s*now/);
    expect(sot).toMatch(/make_interval/);
    expect(
      sot,
      "NULLS FIRST surfaces never-tested servers on the next workflow tick",
    ).toMatch(/ORDER\s+BY\s+[^;]*last_tested_at\s+ASC\s+NULLS\s+FIRST/);
  });

  // ── Migration layer ───────────────────────────────────────────────────────
  it("SoT: get_mcp_servers_due_probe defined in canonical function file", () => {
    const mig = readFile("aisha/db/sql/functions/get_mcp_servers_due_probe.sql");
    expect(mig.length).toBeGreaterThan(100);
    expect(mig).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_mcp_servers_due_probe/);
  });

  it("SoT: get_mcp_servers_due_probe grants ONLY to service_role", () => {
    const mig = readFile("aisha/db/sql/functions/get_mcp_servers_due_probe.sql");
    const grants = mig.match(/GRANT\s+EXECUTE[\s\S]+?;/g) ?? [];
    expect(grants.length).toBeGreaterThanOrEqual(1);
    for (const grant of grants) {
      expect(grant, `must not include 'anon': ${grant.slice(0, 80)}`).not.toMatch(/\bTO\s+anon\b/);
      expect(grant, `must not include 'authenticated': ${grant.slice(0, 80)}`).not.toMatch(/\bTO\s+authenticated\b/);
    }
  });

  // ── n8n workflow layer ────────────────────────────────────────────────────
  it("WF_MCP_PROBE.json exists and is valid JSON with correct name", () => {
    const wfPath = path.join(ROOT, "n8n/workflows/WF_MCP_PROBE.json");
    expect(fs.existsSync(wfPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(wfPath, "utf-8"));
    expect(parsed.name).toBe("WF_MCP_PROBE");
  });

  it("WF_MCP_PROBE has all required nodes (trigger → list → split → audit → probe → record)", () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n/workflows/WF_MCP_PROBE.json"), "utf-8"),
    );
    const nodeNames = (wf.nodes as Array<{ name: string }>).map((n) => n.name);
    expect(nodeNames, "scheduleTrigger required").toContain("Every 5 Minutes");
    expect(nodeNames, "discovery RPC call required").toContain("List MCPs Due Probe");
    expect(nodeNames, "splitOut per MCP required").toContain("Split Per MCP");
    expect(nodeNames, "audit RPC call required").toContain("Audit Probe Intent");
    expect(nodeNames, "HTTP/SSE probe code node required").toContain("HTTP/SSE Probe");
    expect(nodeNames, "record result RPC required").toContain("Record MCP Test Result");
  });

  it("WF_MCP_PROBE all nodes have onError configured", () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n/workflows/WF_MCP_PROBE.json"), "utf-8"),
    );
    const missing: string[] = [];
    for (const node of wf.nodes as Array<{ name: string; onError?: string }>) {
      if (!node.onError) missing.push(node.name);
    }
    expect(
      missing,
      `Nodes without onError: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("WF_MCP_PROBE reuses existing aisha_test_mcp_server + aisha_record_mcp_test_result RPCs (no duplication)", () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n/workflows/WF_MCP_PROBE.json"), "utf-8"),
    );
    const auditNode = (wf.nodes as Array<{ name: string; parameters: Record<string, unknown> }>).find(
      (n) => n.name === "Audit Probe Intent",
    );
    expect(
      (auditNode!.parameters as Record<string, unknown>).url,
      "Audit Probe Intent must call existing aisha_test_mcp_server RPC (don't reimplement)",
    ).toMatch(/aisha_test_mcp_server/);

    const recordNode = (wf.nodes as Array<{ name: string; parameters: Record<string, unknown> }>).find(
      (n) => n.name === "Record MCP Test Result",
    );
    expect(
      (recordNode!.parameters as Record<string, unknown>).url,
      "Record MCP Test Result must call existing aisha_record_mcp_test_result RPC",
    ).toMatch(/aisha_record_mcp_test_result/);
  });

  it("WF_MCP_PROBE scheduleTrigger interval >= 5min (aligns with discovery RPC rate-limit)", () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n/workflows/WF_MCP_PROBE.json"), "utf-8"),
    );
    const trigger = (wf.nodes as Array<{ name: string; parameters: Record<string, unknown> }>).find(
      (n) => n.name === "Every 5 Minutes",
    );
    const rule = (trigger!.parameters as Record<string, unknown>).rule as Record<string, unknown>;
    const interval = (rule.interval as Array<Record<string, unknown>>)[0];
    expect(interval.field).toBe("minutes");
    expect(interval.minutesInterval as number).toBeGreaterThanOrEqual(5);
  });

  // ── Existing RPC contract (defended) ──────────────────────────────────────
  it("aisha_test_mcp_server still exists and is callable", () => {
    const sot = readFile("aisha/db/sql/functions/aisha_test_mcp_server.sql");
    expect(sot.length, "this PR reuses aisha_test_mcp_server — file must still exist").toBeGreaterThan(100);
    expect(sot).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.aisha_test_mcp_server/);
  });

  it("aisha_record_mcp_test_result still exists and is callable", () => {
    const sot = readFile("aisha/db/sql/functions/aisha_record_mcp_test_result.sql");
    expect(sot.length).toBeGreaterThan(100);
    expect(sot).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.aisha_record_mcp_test_result/);
  });

  // ── Exponential backoff (PR: probe_exponential_backoff) ──────────────────
  it("SoT: get_mcp_servers_due_probe applies exponential backoff CASE on test_failure_count", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/get_mcp_servers_due_probe.sql",
    ));
    expect(
      sot,
      "must drive interval from existing test_failure_count column (no new column added — MCP side already had it)",
    ).toMatch(/test_failure_count/);
    expect(
      sot,
      "must use CASE expression to scale make_interval(secs) by failure count",
    ).toMatch(/CASE[\s\S]+WHEN[\s\S]+test_failure_count[\s\S]+THEN[\s\S]+END/);
    expect(sot, "must include 3600 (1h) tier").toMatch(/3600/);
    expect(sot, "must include 21600 (6h) tier").toMatch(/21600/);
    expect(sot, "must include 86400 (24h) cap").toMatch(/86400/);
    expect(
      sot,
      "must return test_failure_count column so caller can display it",
    ).toMatch(/test_failure_count\s+int/);
  });

  it("SoT: get_mcp_servers_due_probe encodes exponential backoff (CASE on test_failure_count)", () => {
    const mig = readFile("aisha/db/sql/functions/get_mcp_servers_due_probe.sql");
    expect(mig).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_mcp_servers_due_probe[\s\S]+CASE[\s\S]+test_failure_count/,
    );
  });
});
