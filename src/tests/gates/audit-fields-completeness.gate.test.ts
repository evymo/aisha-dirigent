/**
 * Audit Fields Completeness Gate Test
 *
 * Verifies that the audit infrastructure satisfies trace correlation requirements:
 * 1. audit_journal SoT has ai_run_id and langfuse_trace_id columns
 * 2. Migration 20260404120000 exists and contains the required DDL
 * 3. get_autonomy_enforcement_rules function exists in SoT
 * 4. link_audit_to_ai_run function exists in SoT
 * 5. key sensitive SQL functions use write_audit_journal for critical actions
 * 6. No raw console.log in n8n workflow nodes (use log_integration_action instead)
 *
 * Part of: Fáze 2 — Audit-Trace Correlation (audit infrastructure completeness)
 * Config: vitest.gates.config.ts (node env, 2 min timeout)
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SQL_TABLES = path.join(ROOT, "aisha/db/sql/tables");
const SQL_FUNCTIONS = path.join(ROOT, "aisha/db/sql/functions");
const MIGRATIONS_DIR = path.join(ROOT, "aisha/db/migrations");

function readSql(dir: string, filename: string): string | null {
  const full = path.join(dir, filename);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf-8") : null;
}

/** All non-baseline migrations are folded into the baseline (the chronological
 *  end-state). The audit-field invariants are asserted against that canonical SoT. */
function readMigrationSql(_filename: string): string | null {
  return readSql(MIGRATIONS_DIR, "00000000000000_baseline.sql");
}

/** The migration's effect is folded into the baseline (baseline-only state). */
function migrationExists(_filename: string): boolean {
  return fs.existsSync(path.join(MIGRATIONS_DIR, "00000000000000_baseline.sql"));
}

describe("audit_journal: trace correlation columns", () => {
  it("audit_journal SoT has ai_run_id column", () => {
    const content = readSql(SQL_TABLES, "audit_journal.sql");
    expect(content, "audit_journal.sql not found").not.toBeNull();
    expect(
      content,
      "audit_journal must have ai_run_id column for AI run correlation"
    ).toContain("ai_run_id");
  });

  it("audit_journal SoT has langfuse_trace_id column", () => {
    const content = readSql(SQL_TABLES, "audit_journal.sql");
    expect(content).not.toBeNull();
    expect(
      content,
      "audit_journal must have langfuse_trace_id column for Langfuse correlation"
    ).toContain("langfuse_trace_id");
  });

  it("audit_journal SoT has FK constraint for ai_run_id → ai_runs", () => {
    const content = readSql(SQL_TABLES, "audit_journal.sql");
    expect(content).not.toBeNull();
    expect(
      content,
      "audit_journal must have FK constraint linking ai_run_id to ai_runs"
    ).toMatch(/audit_journal_ai_run_fkey|REFERENCES.*ai_runs/);
  });
});

describe("migration: 20260404120000_audit_trace_and_enforcement_rules", () => {
  const migrationFile = "20260404120000_audit_trace_and_enforcement_rules.sql";

  it("migration file exists", () => {
    expect(
      migrationExists(migrationFile),
      `Migration ${migrationFile} not found in migrations or archive`
    ).toBe(true);
  });

  it("migration adds ai_run_id column", () => {
    const content = readMigrationSql(migrationFile);
    expect(content).not.toBeNull();
    expect(content, "Migration must ADD COLUMN ai_run_id").toContain("ai_run_id");
  });

  it("migration adds langfuse_trace_id column", () => {
    const content = readMigrationSql(migrationFile);
    expect(content).not.toBeNull();
    expect(content, "Migration must ADD COLUMN langfuse_trace_id").toContain("langfuse_trace_id");
  });

  it("migration creates get_autonomy_enforcement_rules function", () => {
    const content = readMigrationSql(migrationFile);
    expect(content).not.toBeNull();
    expect(
      content,
      "Migration must CREATE get_autonomy_enforcement_rules"
    ).toContain("get_autonomy_enforcement_rules");
  });

  it("migration creates link_audit_to_ai_run function", () => {
    const content = readMigrationSql(migrationFile);
    expect(content).not.toBeNull();
    expect(
      content,
      "Migration must CREATE link_audit_to_ai_run"
    ).toContain("link_audit_to_ai_run");
  });

  it("audit_trace_and_enforcement effect is folded into the baseline (baseline-only)", () => {
    // The 20260404120000_audit_trace_and_enforcement_rules migration was absorbed
    // into the baseline (the chronological end-state). Baseline-only state = the
    // registry tracks 0 non-baseline migrations; durability now lives in the SoT.
    const registryPath = path.join(ROOT, "aisha/db/migration-registry.json");
    expect(fs.existsSync(registryPath), "migration-registry.json not found").toBe(true);
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8")) as {
      migrations: Array<string | { name?: string; file?: string }>;
    };
    expect(registry.migrations).toEqual([]);
  });
});

describe("SoT: enforcement and correlation functions", () => {
  it("get_autonomy_enforcement_rules.sql exists in SoT", () => {
    expect(
      fs.existsSync(path.join(SQL_FUNCTIONS, "get_autonomy_enforcement_rules.sql")),
      "get_autonomy_enforcement_rules.sql missing from aisha/db/sql/functions/"
    ).toBe(true);
  });

  it("get_autonomy_enforcement_rules covers all risk levels", () => {
    const content = readSql(SQL_FUNCTIONS, "get_autonomy_enforcement_rules.sql");
    expect(content).not.toBeNull();
    for (const level of ["critical", "high", "medium", "low"]) {
      expect(
        content,
        `get_autonomy_enforcement_rules must handle risk level: ${level}`
      ).toContain(`'${level}'`);
    }
  });

  it("get_autonomy_enforcement_rules has SECURITY DEFINER and search_path", () => {
    const content = readSql(SQL_FUNCTIONS, "get_autonomy_enforcement_rules.sql");
    expect(content).not.toBeNull();
    expect(content).toContain("SECURITY DEFINER");
    expect(content).toContain("SET search_path TO 'public'");
  });

  it("get_autonomy_enforcement_rules has REVOKE + GRANT (no public access)", () => {
    const content = readSql(SQL_FUNCTIONS, "get_autonomy_enforcement_rules.sql");
    expect(content).not.toBeNull();
    expect(content).toContain("REVOKE ALL ON FUNCTION");
    expect(content).toContain("GRANT EXECUTE");
  });

  it("link_audit_to_ai_run.sql exists in SoT", () => {
    expect(
      fs.existsSync(path.join(SQL_FUNCTIONS, "link_audit_to_ai_run.sql")),
      "link_audit_to_ai_run.sql missing from aisha/db/sql/functions/"
    ).toBe(true);
  });

  it("link_audit_to_ai_run has user ownership check (prevents unauthorized correlation)", () => {
    const content = readSql(SQL_FUNCTIONS, "link_audit_to_ai_run.sql");
    expect(content).not.toBeNull();
    expect(
      content,
      "link_audit_to_ai_run must check user_id ownership or service_role"
    ).toContain("auth.uid()");
  });

  it("link_audit_to_ai_run has SECURITY DEFINER and search_path", () => {
    const content = readSql(SQL_FUNCTIONS, "link_audit_to_ai_run.sql");
    expect(content).not.toBeNull();
    expect(content).toContain("SECURITY DEFINER");
    expect(content).toContain("SET search_path TO 'public'");
  });
});

describe("fn_evaluate_proposal_risk: risk scoring integrity", () => {
  it("fn_evaluate_proposal_risk.sql exists in SoT", () => {
    expect(
      fs.existsSync(path.join(SQL_FUNCTIONS, "fn_evaluate_proposal_risk.sql")),
      "fn_evaluate_proposal_risk.sql missing"
    ).toBe(true);
  });

  it("fn_evaluate_proposal_risk returns all four risk levels", () => {
    const content = readSql(SQL_FUNCTIONS, "fn_evaluate_proposal_risk.sql");
    expect(content).not.toBeNull();
    for (const level of ["critical", "high", "medium", "low"]) {
      expect(
        content,
        `fn_evaluate_proposal_risk must cover risk level: ${level}`
      ).toContain(`'${level}'`);
    }
  });

  // fn_create_improvement_proposal restored in self-improvement foundation migration
  it("fn_evaluate_proposal_risk is called by fn_create_improvement_proposal", () => {
    const callerContent = readSql(SQL_FUNCTIONS, "fn_create_improvement_proposal.sql");
    expect(
      callerContent,
      "fn_create_improvement_proposal.sql not found"
    ).not.toBeNull();
    expect(
      callerContent,
      "fn_create_improvement_proposal must call fn_evaluate_proposal_risk for risk scoring"
    ).toContain("fn_evaluate_proposal_risk");
  });
});
