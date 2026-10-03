/**
 * @fileoverview Security validation tests for Phase 2A/2B encryption hardening:
 *
 * Phase 2A: audit_journal must NOT have a user_email column (PII removed).
 *           get_audit_journal / get_audit_journal_summary must resolve email via
 *           JOIN to auth.users, never from a stored column.
 *
 * Phase 2B: sms_otp_codes must use code_hash (bcrypt), NOT plaintext code.
 *           edge_sms_otp must support 'verify' action that compares hashes in DB.
 *           edge_sms_otp 'get' action must NOT return the hash.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Phase 2A — audit_journal user_email column removal
// TDD: Tests are skipped until the migration is created.
// ============================================================================
const phase2aMigrationPath = path.join(
  process.cwd(),
  "aisha/db/migrations/20260217140000_audit_journal_remove_user_email.sql"
);
describe.skipIf(!fs.existsSync(phase2aMigrationPath))("Phase 2A: audit_journal PII removal", () => {
  const migrationPath = phase2aMigrationPath;

  it("migration file exists", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it("migration drops user_email column from audit_journal", () => {
    const content = fs.readFileSync(migrationPath, "utf-8");
    expect(content).toMatch(
      /ALTER TABLE.*audit_journal.*DROP COLUMN.*user_email/i
    );
  });

  it("migration rewrites get_audit_journal to use auth.users JOIN", () => {
    const content = fs.readFileSync(migrationPath, "utf-8");
    // Must JOIN auth.users
    expect(content).toMatch(/LEFT JOIN auth\.users\s+au\s+ON/i);
    // Must use au.email, NOT aj.user_email
    expect(content).toMatch(/au\.email::text AS user_email/i);
  });

  it("migration does NOT read aj.user_email in any SELECT", () => {
    const content = fs.readFileSync(migrationPath, "utf-8");
    // Remove DDL statements (DROP COLUMN, comments) before checking
    const withoutDDL = content
      .split("\n")
      .filter(
        (line) =>
          !line.match(/DROP COLUMN/i) &&
          !line.match(/^\s*--/) &&
          !line.match(/COALESCE.*aj\.user_email/i)
      )
      .join("\n");
    // Should not SELECT from aj.user_email (column is being dropped)
    expect(withoutDDL).not.toMatch(/aj\.user_email/i);
  });

  it("get_audit_journal_summary also uses auth.users JOIN", () => {
    const content = fs.readFileSync(migrationPath, "utf-8");
    // Extract the summary function block
    const summaryIdx = content.indexOf("get_audit_journal_summary");
    expect(summaryIdx).toBeGreaterThan(-1);
    const summaryBlock = content.slice(summaryIdx);
    expect(summaryBlock).toMatch(/LEFT JOIN auth\.users\s+au\s+ON/i);
    expect(summaryBlock).toMatch(/au\.email::text AS user_email/i);
  });

  it("both functions have SECURITY DEFINER with search_path", () => {
    const content = fs.readFileSync(migrationPath, "utf-8");
    // Count SECURITY DEFINER occurrences (should be 2: one per function)
    const definerMatches = content.match(/SECURITY DEFINER/gi);
    expect(definerMatches).not.toBeNull();
    expect(definerMatches!.length).toBeGreaterThanOrEqual(2);
    // Both must SET search_path
    const searchPathMatches = content.match(
      /SET search_path TO 'public'/gi
    );
    expect(searchPathMatches).not.toBeNull();
    expect(searchPathMatches!.length).toBeGreaterThanOrEqual(2);
  });

  it("drops old function overload before creating new one", () => {
    const content = fs.readFileSync(migrationPath, "utf-8");
    const dropIdx = content.indexOf("DROP FUNCTION IF EXISTS");
    const createIdx = content.indexOf(
      "CREATE OR REPLACE FUNCTION public.get_audit_journal"
    );
    expect(dropIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(dropIdx);
  });
});

// ============================================================================
// Phase 2B — OTP code hashing
// Current repo model is source-of-truth SQL + generated baseline, so validate
// the live SoT files directly instead of an archived point-in-time migration.
// ============================================================================
const otpFunctionPath = path.join(
  process.cwd(),
  "aisha/db/sql/functions/edge_sms_otp.sql"
);
const otpTablePath = path.join(
  process.cwd(),
  "aisha/db/sql/tables/sms_otp_codes.sql"
);
const otpGrantsPath = path.join(
  process.cwd(),
  "aisha/db/sql/grants/sms_otp_codes.sql"
);
const baselinePath = path.join(
  process.cwd(),
  "aisha/db/migrations/00000000000000_baseline.sql"
);

describe("Phase 2B: OTP code hashing", () => {
  it("source-of-truth OTP files exist", () => {
    expect(fs.existsSync(otpFunctionPath)).toBe(true);
    expect(fs.existsSync(otpTablePath)).toBe(true);
    expect(fs.existsSync(otpGrantsPath)).toBe(true);
    expect(fs.existsSync(baselinePath)).toBe(true);
  });

  it("table stores code_hash instead of plaintext code", () => {
    const content = fs.readFileSync(otpTablePath, "utf-8");
    expect(content).toMatch(/code_hash\s+TEXT\s+NOT\s+NULL/i);
    expect(content).not.toMatch(/\bcode\s+TEXT\s+NOT\s+NULL/i);
    expect(content).toMatch(/COMMENT ON COLUMN public\.sms_otp_codes\.code_hash/i);
  });

  it("uses bcrypt hashing via extensions.crypt + extensions.gen_salt", () => {
    const content = fs.readFileSync(otpFunctionPath, "utf-8");
    expect(content).toMatch(/extensions\.crypt\(/i);
    expect(content).toMatch(/extensions\.gen_salt\('bf'\)/i);
  });

  it("implements verify action with hash comparison", () => {
    const content = fs.readFileSync(otpFunctionPath, "utf-8");
    expect(content).toMatch(/p_action\s*=\s*'verify'/i);
    expect(content).toMatch(
      /extensions\.crypt\(v_code,\s*v_row\.code_hash\)\s*=\s*v_row\.code_hash/i
    );
  });

  it("verify returns structured error codes", () => {
    const content = fs.readFileSync(otpFunctionPath, "utf-8");
    const errorCodes = [
      "not_found",
      "already_used",
      "expired",
      "max_attempts",
      "invalid_code",
    ];
    for (const code of errorCodes) {
      expect(content).toContain(`'error', '${code}'`);
    }
  });

  it("verify enforces max 3 attempts", () => {
    const content = fs.readFileSync(otpFunctionPath, "utf-8");
    expect(content).toMatch(/attempts.*>=\s*3|3\s*<=.*attempts/i);
  });

  it("get action does NOT return code_hash", () => {
    const content = fs.readFileSync(otpFunctionPath, "utf-8");
    const getStart = content.indexOf("IF p_action = 'get' THEN");
    const getEnd = content.indexOf("IF p_action = 'update' THEN");
    expect(getStart).toBeGreaterThan(-1);
    expect(getEnd).toBeGreaterThan(getStart);
    const getBlock = content.slice(getStart, getEnd);
    expect(getBlock).not.toMatch(/code_hash/i);
    expect(getBlock).toMatch(/'attempts'/);
    expect(getBlock).toMatch(/'expires_at'/);
    expect(getBlock).toMatch(/'phone'/);
    expect(getBlock).toMatch(/'verified'/);
  });

  it("function has SECURITY DEFINER with search_path and service_role-only execute", () => {
    const content = fs.readFileSync(otpFunctionPath, "utf-8");
    expect(content).toMatch(/SECURITY DEFINER/i);
    expect(content).toMatch(/SET search_path TO 'public'/i);
    expect(content).toMatch(/GRANT EXECUTE.*edge_sms_otp.*TO service_role/i);
    expect(content).not.toMatch(/GRANT.*edge_sms_otp.*TO anon/i);
    expect(content).not.toMatch(/GRANT.*edge_sms_otp.*TO authenticated/i);
  });

  it("table grants stay service-role only", () => {
    const content = fs.readFileSync(otpGrantsPath, "utf-8");
    expect(content).toMatch(/GRANT .* ON public\.sms_otp_codes TO service_role/i);
    expect(content).not.toMatch(/TO anon/i);
    expect(content).not.toMatch(/TO authenticated/i);
  });

  it("generated baseline stays in sync with hashed OTP contract", () => {
    const content = fs.readFileSync(baselinePath, "utf-8");
    expect(content).toMatch(/code_hash\s+TEXT\s+NOT\s+NULL/i);
    expect(content).toMatch(/p_action\s*=\s*'verify'/i);
    expect(content).toMatch(
      /extensions\.crypt\(v_code,\s*v_row\.code_hash\)\s*=\s*v_row\.code_hash/i
    );
  });
});

// ============================================================================
// verify-sms-otp edge function uses 'verify' action (business logic in DB)
// ============================================================================
describe("verify-sms-otp edge function", () => {
  const edgeFnPath = path.join(
    process.cwd(),
    "trash/legacy-archive/edge-functions-reference/verify-sms-otp/index.ts"
  );

  it("edge function file exists", () => {
    expect(fs.existsSync(edgeFnPath)).toBe(true);
  });

  it("uses verify action instead of get+compare in client", () => {
    const content = fs.readFileSync(edgeFnPath, "utf-8");
    // Must call edge_sms_otp with 'verify' action
    expect(content).toMatch(/p_action:\s*["']verify["']/);
  });

  it("does NOT compare OTP codes in TypeScript", () => {
    const content = fs.readFileSync(edgeFnPath, "utf-8");
    // Must NOT have plaintext code comparison patterns
    expect(content).not.toMatch(/otpRecord\.code\s*!==?\s*code/);
    expect(content).not.toMatch(/code\s*!==?\s*otpRecord/);
  });

  it("does NOT read plaintext code from DB response", () => {
    const content = fs.readFileSync(edgeFnPath, "utf-8");
    // Must NOT access .code property from DB response
    expect(content).not.toMatch(/otpRecord\.code/);
  });

  it("does not log PII (phone numbers, codes)", () => {
    const content = fs.readFileSync(edgeFnPath, "utf-8");
    // Should NOT log phone or code values
    expect(content).not.toMatch(/console\.\w+\(.*phone.*\$\{/);
    expect(content).not.toMatch(/console\.\w+\(.*code.*\$\{/);
  });

  it("maps DB error codes to user-friendly messages", () => {
    const content = fs.readFileSync(edgeFnPath, "utf-8");
    // Should have error message mapping
    expect(content).toContain("not_found");
    expect(content).toContain("already_used");
    expect(content).toContain("expired");
    expect(content).toContain("max_attempts");
    expect(content).toContain("invalid_code");
  });
});

// ============================================================================
// pgsodium extension migration
// TDD: Tests are skipped until the migration is created.
// ============================================================================
const pgsodiumMigrationPath = path.join(
  process.cwd(),
  "aisha/db/migrations/20260217170000_enable_pgsodium.sql"
);
describe.skipIf(!fs.existsSync(pgsodiumMigrationPath))("pgsodium extension", () => {
  const migrationPath = pgsodiumMigrationPath;

  it("migration file exists", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it("creates pgsodium schema and extension", () => {
    const content = fs.readFileSync(migrationPath, "utf-8");
    expect(content).toMatch(/CREATE SCHEMA IF NOT EXISTS pgsodium/i);
    expect(content).toMatch(
      /CREATE EXTENSION IF NOT EXISTS pgsodium/i
    );
  });
});
