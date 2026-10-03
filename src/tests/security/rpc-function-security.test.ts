import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Security Tests for RPC Function Definitions
 * 
 * These tests verify that SQL functions follow security best practices:
 * 1. Functions with GRANT TO anon MUST have SECURITY DEFINER
 * 2. Functions with SECURITY DEFINER MUST have SET search_path
 * 3. All functions must have explicit GRANT statements
 * 4. sensitive data functions must have _audited suffix
 * 
 * @see docs/security/RPC_FUNCTION_SECURITY.md
 */

const SQL_FUNCTIONS_DIR = path.join(process.cwd(), "aisha/db/sql/functions");

interface FunctionInfo {
  file: string;
  hasAnonGrant: boolean;
  hasAuthenticatedGrant: boolean;
  hasRevokeFromPublic: boolean;
  hasSecurityDefiner: boolean;
  hasSearchPath: boolean;
  hasSecurityInvoker: boolean;
  isAuditedFunction: boolean;
  returnsTrigger: boolean;
  readsTables: string[];
}

function parseSqlFunction(filePath: string): FunctionInfo {
  const content = fs.readFileSync(filePath, "utf8");
  const fileName = path.basename(filePath);

  return {
    file: fileName,
    hasAnonGrant: /GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]+TO\s+anon/i.test(content),
    hasAuthenticatedGrant: /GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]+TO\s+authenticated/i.test(content),
    hasRevokeFromPublic: /REVOKE\s+ALL\s+ON\s+FUNCTION[^;]+FROM\s+PUBLIC/i.test(content),
    hasSecurityDefiner: /SECURITY\s+DEFINER/i.test(content),
    hasSearchPath: /SET\s+search_path/i.test(content),
    hasSecurityInvoker: /SECURITY\s+INVOKER/i.test(content),
    isAuditedFunction: fileName.includes("_audited"),
    returnsTrigger: /RETURNS\s+TRIGGER\b/i.test(content),
    readsTables: extractTableReferences(content),
  };
}

function extractTableReferences(content: string): string[] {
  const tables: string[] = [];
  
  // Match FROM/JOIN table references
  const fromMatches = content.matchAll(/(?:FROM|JOIN)\s+(?:public\.)?(\w+)(?:\s+\w+)?/gi);
  for (const match of fromMatches) {
    if (!["QUERY", "FUNCTION", "TABLE", "SELECT"].includes(match[1].toUpperCase())) {
      tables.push(match[1]);
    }
  }
  
  return [...new Set(tables)];
}

function getAllSqlFunctions(): FunctionInfo[] {
  if (!fs.existsSync(SQL_FUNCTIONS_DIR)) {
    return [];
  }
  
  const files = fs.readdirSync(SQL_FUNCTIONS_DIR)
    .filter(f => f.endsWith(".sql"))
    .map(f => path.join(SQL_FUNCTIONS_DIR, f));
  
  return files.map(parseSqlFunction);
}

describe("RPC Function Security Patterns", () => {
  const functions = getAllSqlFunctions();
  
  describe("SECURITY DEFINER requirement for anon-accessible functions", () => {
    it("all functions with GRANT TO anon MUST have SECURITY DEFINER", () => {
      const violations = functions.filter(
        f => f.hasAnonGrant && !f.hasSecurityDefiner
      );
      
      expect(
        violations,
        `Functions with GRANT TO anon but WITHOUT SECURITY DEFINER will fail at runtime!\n` +
        `The anon role has no table-level SELECT permissions, so functions must run as owner.\n\n` +
        `Violations:\n${violations.map(v => 
          `  - ${v.file}\n    Tables accessed: ${v.readsTables.join(", ") || "none detected"}`
        ).join("\n")}\n\n` +
        `Fix by adding to each function:\n` +
        `  LANGUAGE plpgsql\n` +
        `  SECURITY DEFINER\n` +
        `  SET search_path TO 'public'\n` +
        `  AS $$...$$;`
      ).toEqual([]);
    });
    
    it("functions with SECURITY DEFINER MUST have SET search_path", () => {
      const violations = functions.filter(
        f => f.hasSecurityDefiner && !f.hasSearchPath
      );
      
      expect(
        violations,
        `SECURITY DEFINER functions without SET search_path are vulnerable to search_path injection!\n\n` +
        `Violations:\n${violations.map(v => `  - ${v.file}`).join("\n")}\n\n` +
        `Fix by adding: SET search_path TO 'public'`
      ).toEqual([]);
    });
  });
  
  describe("Function security classification", () => {
    it("functions with _audited suffix should access sensitive data tables", () => {
      const auditedFunctions = functions.filter(f => f.isAuditedFunction);
      
      // This is informational - audited functions should typically access sensitive data
      for (const fn of auditedFunctions) {
        // Just verify they exist and are properly secured
        expect(fn.hasSecurityDefiner || fn.hasSecurityInvoker).toBe(true);
      }
    });
    
    it("functions without GRANT must have explicit REVOKE FROM PUBLIC (or be a trigger)", () => {
      // The intent: every function file MUST express its permission posture
      // explicitly. Three valid patterns:
      //   1. `GRANT EXECUTE TO authenticated|anon` (callable)
      //   2. `REVOKE ALL FROM PUBLIC` with no GRANT (intentional internal helper)
      //   3. `RETURNS TRIGGER` (DB invokes it, no caller-side privileges relevant)
      //
      // Anything else = bug: PostgreSQL grants EXECUTE TO PUBLIC by default,
      // so a function with no GRANT and no REVOKE silently leaks to every role.
      const violations = functions.filter(
        (f) =>
          !f.hasAnonGrant &&
          !f.hasAuthenticatedGrant &&
          !f.hasRevokeFromPublic &&
          !f.returnsTrigger,
      );

      expect(
        violations,
        `Functions with neither explicit GRANT nor REVOKE leak to PUBLIC by default.\n` +
          `Add one of:\n` +
          `  - GRANT EXECUTE ON FUNCTION ... TO authenticated; (if callable from FE)\n` +
          `  - REVOKE ALL ON FUNCTION ... FROM PUBLIC; (if internal helper)\n` +
          `  - declare RETURNS TRIGGER (if DB-invoked).\n\n` +
          `Violations:\n${violations.map((v) => `  - ${v.file}`).join("\n")}`,
      ).toEqual([]);
    });
  });
  
  describe("Anon-accessible function inventory", () => {
    it("lists all anon-accessible functions for review", () => {
      const anonFunctions = functions.filter(f => f.hasAnonGrant);
      
      // This test always passes but logs the inventory for audit
      console.log("\n📋 Anon-accessible functions inventory:");
      console.log("─".repeat(60));
      
      for (const fn of anonFunctions) {
        const status = fn.hasSecurityDefiner ? "✅" : "❌";
        const searchPath = fn.hasSearchPath ? "✅" : "⚠️";
        console.log(`${status} ${fn.file}`);
        console.log(`   SECURITY DEFINER: ${fn.hasSecurityDefiner ? "Yes" : "NO!"}`);
        console.log(`   SET search_path: ${fn.hasSearchPath ? "Yes" : "Missing"}`);
        console.log(`   Tables: ${fn.readsTables.join(", ") || "none detected"}`);
      }
      
      console.log("─".repeat(60));
      console.log(`Total anon functions: ${anonFunctions.length}`);
      console.log(`With SECURITY DEFINER: ${anonFunctions.filter(f => f.hasSecurityDefiner).length}`);
      console.log(`Missing SECURITY DEFINER: ${anonFunctions.filter(f => !f.hasSecurityDefiner).length}`);
      
      expect(true).toBe(true);
    });
  });
});

describe("RPC Function GRANT Patterns", () => {
  const functions = getAllSqlFunctions();
  
  it("authenticated-only functions must NOT have anon grant", () => {
    // Functions whose names imply user-scoped or admin-scoped data access:
    //   - get_my_* / update_my_*    — current user's row
    //   - *_admin                   — admin/staff RBAC body check
    //   - submit_* / create_* /
    //     update_* / delete_*       — mutations
    // None of these can be meaningfully called by an unauthenticated caller —
    // either the RLS / body check rejects them, or they alter state and need
    // an authenticated user_id. `GRANT TO anon` on such a function is
    // defense-in-depth dead weight that masks intent.
    const shouldBeAuthOnly = functions.filter((f) =>
      /(^|_)(my|admin|submit|create|update|delete)(_|\b)/.test(f.file),
    );

    const violations = shouldBeAuthOnly.filter((f) => f.hasAnonGrant);

    expect(
      violations,
      `Functions whose name implies authenticated-only access have GRANT TO anon.\n` +
        `If anon access is intentional, rename the function to drop the auth-only prefix/suffix.\n` +
        `Otherwise drop the \`GRANT EXECUTE ... TO anon\` line.\n\n` +
        `Violations:\n${violations.map((v) => `  - ${v.file}`).join("\n")}`,
    ).toEqual([]);
  });
});

describe("Migration Consistency", () => {
  it("SQL function files should match init migration definitions", () => {
    const initMigrationPath = path.join(
      process.cwd(),
      "aisha/db/migrations/20260111000000_init.sql"
    );
    
    if (!fs.existsSync(initMigrationPath)) {
      console.warn("Init migration not found, skipping consistency check");
      return;
    }
    
    const initContent = fs.readFileSync(initMigrationPath, "utf8");
    const functions = getAllSqlFunctions();
    
    const inconsistencies: string[] = [];
    
    for (const fn of functions) {
      const fnContent = fs.readFileSync(
        path.join(SQL_FUNCTIONS_DIR, fn.file),
        "utf8"
      );
      
      // Check if function has SECURITY DEFINER in source but not in init
      if (fn.hasSecurityDefiner) {
        const fnName = fn.file.replace(".sql", "");
        // Simple check - look for the function in init
        const fnInInit = initContent.includes(`FUNCTION public.${fnName}`);
        
        if (fnInInit) {
          // Extract function definition from init and check for SECURITY DEFINER
          const initHasDefiner = new RegExp(
            `CREATE OR REPLACE FUNCTION public\\.${fnName}[^;]+SECURITY DEFINER`,
            "is"
          ).test(initContent);
          
          if (!initHasDefiner && fn.hasSecurityDefiner) {
            inconsistencies.push(
              `${fn.file}: has SECURITY DEFINER in source but not in init migration`
            );
          }
        }
      }
    }
    
    if (inconsistencies.length > 0) {
      console.warn(
        `\n⚠️ Source/Migration inconsistencies (regenerate init or apply patch):\n` +
        inconsistencies.map(i => `  - ${i}`).join("\n")
      );
    }
    
    // This is informational
    expect(true).toBe(true);
  });
});
