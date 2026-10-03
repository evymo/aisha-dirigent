/**
 * Provider Health Probe Flow — Gate Tests
 *
 * Locks in the structural contract for the periodic provider-health-probe
 * autopilot loop:
 *   1. SoT RPCs exist in aisha/db/sql/functions/ (paired with migration)
 *   2. Migration registers both RPCs with proper auth/grants
 *   3. WF_PROVIDER_HEALTH_PROBE workflow exists + has all required nodes
 *   4. record_provider_health_result validates status enum
 *
 * Without all 4 pieces wired, ai_provider_registry.last_health_status stays
 * 'unknown' forever and aisha_resolve_clow_backend's scoring flies blind
 * (cannot deprioritize down/degraded providers).
 *
 * This is a STRUCTURAL test (file inspection). Runtime behavior of the
 * probe loop is exercised via local-warmup smoke + ops dashboard observation.
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

describe("Provider Health Probe Flow — structural integrity", () => {
  // ── SoT layer ──────────────────────────────────────────────────────────────
  it("SoT: get_providers_due_health_probe.sql exists with proper auth + grants", () => {
    const sot = readFile(
      "aisha/db/sql/functions/get_providers_due_health_probe.sql",
    );
    expect(sot.length, "SoT function must exist").toBeGreaterThan(100);
    expect(stripSqlComments(sot)).toMatch(/SECURITY\s+DEFINER/);
    expect(stripSqlComments(sot)).toMatch(/SET\s+search_path\s+TO\s+'public'/);
    expect(stripSqlComments(sot)).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]*?FROM\s+PUBLIC/);
    expect(stripSqlComments(sot)).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?TO\s+service_role/);
  });

  it("SoT: get_providers_due_health_probe filters by is_enabled + excludes mcp_server", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/get_providers_due_health_probe.sql",
    ));
    expect(sot, "must filter to enabled providers only").toMatch(/is_enabled\s*=\s*true/);
    expect(
      sot,
      "must exclude backend_kind='mcp_server' (those use aisha_test_mcp_server probe path)",
    ).toMatch(/backend_kind\s*!=\s*'mcp_server'/);
  });

  it("SoT: get_providers_due_health_probe rate-limits via last_health_checked_at", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/get_providers_due_health_probe.sql",
    ));
    expect(
      sot,
      "must check last_health_checked_at IS NULL OR older than interval",
    ).toMatch(/last_health_checked_at\s+IS\s+NULL|last_health_checked_at\s*<\s*now/);
    expect(sot, "must use make_interval(secs) for the rate-limit").toMatch(/make_interval/);
  });

  it("SoT: get_providers_due_health_probe orders NULLs first (never-probed = priority)", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/get_providers_due_health_probe.sql",
    ));
    expect(
      sot,
      "ORDER BY last_health_checked_at ASC NULLS FIRST — newly-added providers get probed on next tick",
    ).toMatch(/ORDER\s+BY\s+[^;]*last_health_checked_at\s+ASC\s+NULLS\s+FIRST/);
  });

  it("SoT: record_provider_health_result.sql exists with proper auth + grants", () => {
    const sot = readFile(
      "aisha/db/sql/functions/record_provider_health_result.sql",
    );
    expect(sot.length, "SoT function must exist").toBeGreaterThan(100);
    expect(stripSqlComments(sot)).toMatch(/SECURITY\s+DEFINER/);
    expect(stripSqlComments(sot)).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]*?FROM\s+PUBLIC/);
    expect(stripSqlComments(sot)).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?TO\s+service_role/);
  });

  it("SoT: record_provider_health_result validates status enum (healthy|degraded|down|unknown)", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/record_provider_health_result.sql",
    ));
    // The CHECK constraint on ai_provider_registry already enforces this,
    // but the RPC must raise EXCEPTION upfront with a friendly message
    // so n8n gets a clean 400 instead of a Postgres CHECK violation.
    expect(
      sot,
      "RPC must validate p_status against {healthy, degraded, down, unknown}",
    ).toMatch(/p_status\s+NOT\s+IN\s*\(\s*'healthy'\s*,\s*'degraded'\s*,\s*'down'\s*,\s*'unknown'\s*\)/);
  });

  it("SoT: record_provider_health_result uses FOR UPDATE row lock + writes audit", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/record_provider_health_result.sql",
    ));
    expect(sot, "row lock prevents race between concurrent probe results").toMatch(
      /FROM\s+ai_provider_registry[\s\S]+FOR\s+UPDATE/,
    );
    expect(sot, "audit row required for probe history").toMatch(
      /INSERT\s+INTO\s+audit_journal[\s\S]+'provider\.health_probed'/,
    );
  });

  it("SoT: record_provider_health_result truncates detail to fit column (max 500 chars)", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/record_provider_health_result.sql",
    ));
    expect(
      sot,
      "detail field must be truncated to fit last_health_detail column — prevent oversized error blobs",
    ).toMatch(/LEFT\(\s*COALESCE\(\s*p_detail/);
  });

  // ── Migration layer ───────────────────────────────────────────────────────
  it("SoT: provider health probe RPCs defined in canonical function files", () => {
    const mig =
      readFile("aisha/db/sql/functions/get_providers_due_health_probe.sql") +
      "\n" +
      readFile("aisha/db/sql/functions/record_provider_health_result.sql");
    expect(mig.length).toBeGreaterThan(100);
    expect(mig).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_providers_due_health_probe/);
    expect(mig).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.record_provider_health_result/);
  });

  it("SoT: both RPCs grant ONLY to service_role (not anon/authenticated)", () => {
    const mig =
      readFile("aisha/db/sql/functions/get_providers_due_health_probe.sql") +
      "\n" +
      readFile("aisha/db/sql/functions/record_provider_health_result.sql");
    const grants = mig.match(/GRANT\s+EXECUTE[\s\S]+?;/g) ?? [];
    expect(grants.length).toBeGreaterThanOrEqual(2);
    for (const grant of grants) {
      expect(grant, `must not include 'anon': ${grant.slice(0, 80)}`).not.toMatch(/\bTO\s+anon\b/);
      expect(grant, `must not include 'authenticated': ${grant.slice(0, 80)}`).not.toMatch(/\bTO\s+authenticated\b/);
    }
  });

  // ── n8n workflow layer ────────────────────────────────────────────────────
  it("WF_PROVIDER_HEALTH_PROBE.json exists and is valid JSON with correct name", () => {
    const wfPath = path.join(ROOT, "n8n/workflows/WF_PROVIDER_HEALTH_PROBE.json");
    expect(fs.existsSync(wfPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(wfPath, "utf-8"));
    expect(parsed.name).toBe("WF_PROVIDER_HEALTH_PROBE");
  });

  it("WF_PROVIDER_HEALTH_PROBE has all required nodes (trigger → list → split → resolve → probe → classify → record)", () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n/workflows/WF_PROVIDER_HEALTH_PROBE.json"), "utf-8"),
    );
    const nodeNames = (wf.nodes as Array<{ name: string }>).map((n) => n.name);
    expect(nodeNames, "scheduleTrigger node required").toContain("Every 5 Minutes");
    expect(nodeNames, "discovery RPC call required").toContain("List Providers Due Probe");
    expect(nodeNames, "splitOut per provider required").toContain("Split Per Provider");
    expect(nodeNames, "URL+auth resolution per backend_kind required").toContain("Resolve Probe Target");
    expect(nodeNames, "HTTP probe required").toContain("HTTP Probe");
    expect(nodeNames, "status classification required").toContain("Classify Probe Result");
    expect(nodeNames, "record result RPC required").toContain("Record Health Result");
  });

  it("WF_PROVIDER_HEALTH_PROBE all nodes have onError configured (no silent failures)", () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n/workflows/WF_PROVIDER_HEALTH_PROBE.json"), "utf-8"),
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

  it("WF_PROVIDER_HEALTH_PROBE HTTP Probe node uses continueErrorOutput (probe failure ≠ workflow failure)", () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n/workflows/WF_PROVIDER_HEALTH_PROBE.json"), "utf-8"),
    );
    const probe = (wf.nodes as Array<{ name: string; onError?: string }>).find(
      (n) => n.name === "HTTP Probe",
    );
    expect(
      probe!.onError,
      "HTTP Probe must continueErrorOutput so timeout/network errors flow into Classify (recorded as 'down') instead of aborting the entire iteration",
    ).toBe("continueErrorOutput");
  });

  it("WF_PROVIDER_HEALTH_PROBE record node calls record_provider_health_result RPC", () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n/workflows/WF_PROVIDER_HEALTH_PROBE.json"), "utf-8"),
    );
    const record = (wf.nodes as Array<{ name: string; parameters: Record<string, unknown> }>).find(
      (n) => n.name === "Record Health Result",
    );
    expect((record!.parameters as Record<string, unknown>).url).toMatch(
      /record_provider_health_result/,
    );
  });

  it("WF_PROVIDER_HEALTH_PROBE scheduleTrigger interval >= 5 minutes (rate limit alignment)", () => {
    const wf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "n8n/workflows/WF_PROVIDER_HEALTH_PROBE.json"), "utf-8"),
    );
    const trigger = (wf.nodes as Array<{ name: string; parameters: Record<string, unknown> }>).find(
      (n) => n.name === "Every 5 Minutes",
    );
    expect(trigger).toBeDefined();
    const rule = (trigger!.parameters as Record<string, unknown>).rule as Record<string, unknown>;
    const interval = (rule.interval as Array<Record<string, unknown>>)[0];
    expect(interval.field).toBe("minutes");
    expect(
      interval.minutesInterval as number,
      "must be >= 5min so it aligns with get_providers_due_health_probe's default p_min_interval_seconds=300",
    ).toBeGreaterThanOrEqual(5);
  });

  // ── Resolver scoring integration ──────────────────────────────────────────
  it("aisha_resolve_clow_backend SCORING uses last_health_status (probe data feeds resolver)", () => {
    const resolver = readFile("aisha/db/sql/functions/aisha_resolve_clow_backend.sql");
    expect(
      resolver,
      "Resolver must reference last_health_status in its scoring — otherwise probe data is wasted",
    ).toMatch(/last_health_status/);
  });

  // ── Exponential backoff (PR: probe_exponential_backoff) ──────────────────
  it("SoT: get_providers_due_health_probe applies exponential backoff CASE", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/get_providers_due_health_probe.sql",
    ));
    // Backoff schedule: 0-2=base, 3-4=1h, 5-7=6h, 8+=24h
    expect(
      sot,
      "must read consecutive_failure_count to drive interval",
    ).toMatch(/consecutive_failure_count/);
    expect(
      sot,
      "must use CASE expression to scale make_interval(secs) by failure count",
    ).toMatch(/CASE[\s\S]+WHEN[\s\S]+consecutive_failure_count[\s\S]+THEN[\s\S]+END/);
    expect(
      sot,
      "must include 3600 (1h) tier",
    ).toMatch(/3600/);
    expect(
      sot,
      "must include 21600 (6h) tier",
    ).toMatch(/21600/);
    expect(
      sot,
      "must include 86400 (24h) cap",
    ).toMatch(/86400/);
    expect(
      sot,
      "must return consecutive_failure_count column so callers can display it",
    ).toMatch(/consecutive_failure_count\s+int/);
  });

  it("SoT: record_provider_health_result maintains consecutive_failure_count (increment / reset)", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/record_provider_health_result.sql",
    ));
    expect(
      sot,
      "must reset counter to 0 on 'healthy' status",
    ).toMatch(/WHEN\s+p_status\s*=\s*'healthy'\s+THEN\s+0/);
    expect(
      sot,
      "must increment counter on non-healthy status",
    ).toMatch(/consecutive_failure_count\s*\+\s*1/);
  });

  it("Table: ai_provider_registry has consecutive_failure_count column", () => {
    const tbl = stripSqlComments(readFile(
      "aisha/db/sql/tables/ai_provider_registry.sql",
    ));
    expect(
      tbl,
      "column must be declared in the SoT table file (matches migration ALTER TABLE)",
    ).toMatch(/consecutive_failure_count\s+int\s+NOT\s+NULL\s+DEFAULT\s+0/);
  });

  it("SoT: failure-count column lives in table SoT + RPCs honor backoff", () => {
    const mig =
      readFile("aisha/db/sql/tables/ai_provider_registry.sql") +
      "\n" +
      readFile("aisha/db/sql/functions/record_provider_health_result.sql") +
      "\n" +
      readFile("aisha/db/sql/functions/get_providers_due_health_probe.sql") +
      "\n" +
      readFile("aisha/db/sql/functions/get_mcp_servers_due_probe.sql") +
      "\n" +
      readFile("aisha/db/sql/functions/update_provider_admin.sql");
    expect(mig.length).toBeGreaterThan(500);
    expect(mig, "consecutive_failure_count column declared in table SoT").toMatch(
      /consecutive_failure_count/,
    );
    expect(mig, "redefines record_provider_health_result").toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.record_provider_health_result/,
    );
    expect(mig, "redefines get_providers_due_health_probe").toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_providers_due_health_probe/,
    );
    expect(mig, "redefines get_mcp_servers_due_probe").toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_mcp_servers_due_probe/,
    );
    expect(mig, "extends update_provider_admin signature with p_reset_failure_count").toMatch(
      /update_provider_admin[\s\S]+p_reset_failure_count\s+boolean/,
    );
  });

  it("update_provider_admin (SoT) exposes p_reset_failure_count flag", () => {
    const sot = stripSqlComments(readFile(
      "aisha/db/sql/functions/update_provider_admin.sql",
    ));
    expect(
      sot,
      "operator must be able to clear backoff counter via admin RPC",
    ).toMatch(/p_reset_failure_count\s+boolean\s+DEFAULT\s+false/);
  });
});
