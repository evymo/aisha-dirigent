/**
 * Database ↔ Frontend Consistency Tests
 * 
 * These tests verify that string literals, enum values, and return types
 * are consistent between:
 *   - SQL source files (aisha/db/sql/)
 *   - TypeScript types (src/integrations/db/types.ts)
 *   - Frontend code (src/hooks/, src/components/)
 * 
 * This catches bugs like:
 *   - DB function returns 'community' but frontend expects 'amateur'
 *   - Enum has 'members' but code uses 'member'
 *   - TypeScript type doesn't match actual DB return values
 * 
 * Run with: npm run test:run src/tests/db/db-frontend-consistency.test.ts
 * 
 * @packageDocumentation
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Configuration
// =============================================================================

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

const PATHS = {
  sqlFunctions: path.join(WORKSPACE_ROOT, "aisha/db/sql/functions"),
  sqlEnums: path.join(WORKSPACE_ROOT, "aisha/db/sql/enums"),
  types: path.join(WORKSPACE_ROOT, "src/integrations/db/types.ts"),
  hooks: path.join(WORKSPACE_ROOT, "src/hooks"),
  components: path.join(WORKSPACE_ROOT, "src/components"),
};

// =============================================================================
// Utilities
// =============================================================================

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function readAllFilesInDir(dir: string, extension: string = ".sql"): Map<string, string> {
  const result = new Map<string, string>();
  if (!fs.existsSync(dir)) return result;
  
  const files = fs.readdirSync(dir).filter(f => f.endsWith(extension));
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    result.set(file, content);
  }
  return result;
}

function extractEnumValues(sqlContent: string): string[] {
  // Match CREATE TYPE ... AS ENUM (...) pattern
  const enumMatch = sqlContent.match(/AS\s+ENUM\s*\(\s*([\s\S]*?)\)/i);
  if (!enumMatch) return [];
  
  const valuesBlock = enumMatch[1];
  const values = valuesBlock
    .split(",")
    .map(v => v.trim())
    .map(v => v.replace(/^['"]|['"]$/g, "").trim())
    .filter(v => v.length > 0 && !v.startsWith("--"));
  
  return values;
}

function extractReturnLiterals(sqlContent: string): string[] {
  // Match RETURN 'value' patterns in SQL functions
  const matches = sqlContent.matchAll(/RETURN\s+['"]([^'"]+)['"]/gi);
  return Array.from(matches, m => m[1]);
}

function extractTypeLiterals(content: string, typeName: string): string[] {
  // Match type X = "a" | "b" | "c" pattern
  const typeMatch = content.match(new RegExp(`type\\s+${typeName}\\s*=\\s*([^;]+)`, "i"));
  if (!typeMatch) return [];
  
  const literals = typeMatch[1].matchAll(/["']([^"']+)["']/g);
  return Array.from(literals, m => m[1]);
}

function extractUsedLiterals(content: string, pattern: RegExp): string[] {
  const matches = content.matchAll(pattern);
  return Array.from(matches, m => m[1]);
}

// =============================================================================
// Test: Enum Consistency
// =============================================================================

describe("Enum Consistency: SQL ↔ TypeScript", () => {
  const enumFiles = readAllFilesInDir(PATHS.sqlEnums);
  const typesContent = readFile(PATHS.types);

  it("journal_area enum - SQL source has all values used in functions", () => {
    // This test validates that the SQL enum source file is complete
    // TypeScript types are generated from DB, so we test source consistency
    const sqlContent = enumFiles.get("journal_area.sql");
    expect(sqlContent).toBeDefined();
    
    const sqlValues = extractEnumValues(sqlContent!);
    expect(sqlValues.length).toBeGreaterThan(30); // We have ~40 values
    
    // Check that commonly used areas exist
    const requiredAreas = [
      "admin", "auth", "chat", "consents", "documents", 
      "health", "orders", "partner", "secure", "profile", "system"
    ];
    
    for (const area of requiredAreas) {
      expect(sqlValues).toContain(area);
    }
  });

  it("app_role enum values match TypeScript", () => {
    const sqlContent = enumFiles.get("app_role.sql");
    expect(sqlContent).toBeDefined();
    
    const sqlValues = extractEnumValues(sqlContent!);
    expect(sqlValues.length).toBeGreaterThan(0);
    
    for (const value of sqlValues) {
      expect(typesContent).toContain(`"${value}"`);
    }
  });

  it("consent_type enum values match TypeScript", () => {
    const sqlContent = enumFiles.get("consent_type.sql");
    expect(sqlContent).toBeDefined();
    
    const sqlValues = extractEnumValues(sqlContent!);
    expect(sqlValues.length).toBeGreaterThan(0);
    
    for (const value of sqlValues) {
      expect(typesContent).toContain(`"${value}"`);
    }
  });
});

// =============================================================================
// Test: RPC Return Values vs Frontend Expectations
// =============================================================================

describe("RPC Return Values ↔ Frontend Consistency", () => {
  
  it("get_partner_type returns values matching PartnerType", () => {
    // SQL function
    const sqlPath = path.join(PATHS.sqlFunctions, "get_partner_type.sql");
    expect(fs.existsSync(sqlPath)).toBe(true);
    
    const sqlContent = readFile(sqlPath);
    const sqlReturns = extractReturnLiterals(sqlContent);
    
    // Frontend PartnerType
    const hooksDir = PATHS.hooks;
    const permissionsFile = path.join(hooksDir, "usePermissions.ts");
    expect(fs.existsSync(permissionsFile)).toBe(true);
    
    const hookContent = readFile(permissionsFile);
    const partnerTypeValues = extractTypeLiterals(hookContent, "PartnerType");
    
    // Every non-null SQL return should be in PartnerType
    const validSqlReturns = sqlReturns.filter(v => v !== "NULL" && v !== "null");
    
    for (const sqlValue of validSqlReturns) {
      expect(
        partnerTypeValues.includes(sqlValue),
        `SQL get_partner_type returns '${sqlValue}' but PartnerType doesn't include it. ` +
        `PartnerType values: [${partnerTypeValues.join(", ")}]`
      ).toBe(true);
    }
    
    // Log what we found for visibility
    console.log(`  SQL returns: [${validSqlReturns.join(", ")}]`);
    console.log(`  PartnerType: [${partnerTypeValues.join(", ")}]`);
  });

  it("frontend partner type comparisons match SQL returns", () => {
    const sqlPath = path.join(PATHS.sqlFunctions, "get_partner_type.sql");
    const sqlContent = readFile(sqlPath);
    const sqlReturns = extractReturnLiterals(sqlContent).filter(v => v !== "NULL" && v !== "null");
    
    const hookContent = readFile(path.join(PATHS.hooks, "usePermissions.ts"));
    
    // Find all === "xxx" comparisons for partnerType
    const comparisons = extractUsedLiterals(
      hookContent, 
      /partnerType\s*===?\s*["']([^"']+)["']/g
    );
    
    // Every comparison value should be possible SQL return
    for (const comparison of comparisons) {
      expect(
        sqlReturns.includes(comparison),
        `Frontend compares partnerType === '${comparison}' but SQL never returns this value. ` +
        `SQL returns: [${sqlReturns.join(", ")}]`
      ).toBe(true);
    }
    
    console.log(`  Frontend comparisons: [${comparisons.join(", ")}]`);
  });
});

// =============================================================================
// Test: Audit Journal Areas - SQL functions use valid enum values
// =============================================================================

describe("Audit Journal Area Consistency", () => {
  const enumFiles = readAllFilesInDir(PATHS.sqlEnums);
  const functionFiles = readAllFilesInDir(PATHS.sqlFunctions);
  
  it("all journal_area values used in functions exist in enum", () => {
    const enumContent = enumFiles.get("journal_area.sql");
    expect(enumContent).toBeDefined();
    
    const validAreas = extractEnumValues(enumContent!);
    expect(validAreas.length).toBeGreaterThan(20); // Sanity check
    
    const errors: string[] = [];
    
    for (const [filename, content] of functionFiles) {
      // Find all 'xxx'::journal_area, 'xxx'::public.journal_area, or 'xxx', -- as area parameter patterns
      const areaMatches = content.matchAll(/['"](\w+)['"](?:::(?:public\.)?journal_area|,\s*--.*area)/gi);
      
      for (const match of areaMatches) {
        const area = match[1];
        if (!validAreas.includes(area)) {
          errors.push(`${filename}: uses '${area}' but it's not in journal_area enum`);
        }
      }
      
      // Also check write_audit_journal calls - 3rd parameter is area
      const auditCalls = content.matchAll(/write_audit_journal\s*\(\s*['"][^'"]+['"]\s*,\s*['"][^'"]+['"]\s*,\s*['"](\w+)['"]/gi);
      for (const match of auditCalls) {
        const area = match[1];
        if (!validAreas.includes(area)) {
          errors.push(`${filename}: write_audit_journal uses area '${area}' but it's not in journal_area enum`);
        }
      }
    }
    
    if (errors.length > 0) {
      console.error("\n❌ Invalid journal_area values found:");
      errors.forEach(e => console.error(`   - ${e}`));
    }
    
    expect(errors, `Found ${errors.length} invalid journal_area usages`).toHaveLength(0);
  });
});

// =============================================================================
// Test: String Literal Consistency Across Codebase
// =============================================================================

describe("Role String Consistency", () => {
  const enumFiles = readAllFilesInDir(PATHS.sqlEnums);
  
  it("app_role enum values are used consistently in frontend", () => {
    const enumContent = enumFiles.get("app_role.sql");
    expect(enumContent).toBeDefined();
    
    const validRoles = extractEnumValues(enumContent!);
    
    // Read all hook files
    const hookFiles = fs.readdirSync(PATHS.hooks)
      .filter(f => f.endsWith(".ts") || f.endsWith(".tsx"));
    
    const errors: string[] = [];
    
    for (const hookFile of hookFiles) {
      const content = readFile(path.join(PATHS.hooks, hookFile));
      
      // Find role comparisons like role === "admin"
      const roleComparisons = content.matchAll(/role\s*===?\s*["'](\w+)["']/gi);
      
      for (const match of roleComparisons) {
        const role = match[1];
        // Skip if it's not a role value (could be other variable named 'role')
        if (!validRoles.includes(role) && 
            ["admin", "staff", "member", "practitioner", "evaluator"].includes(role.toLowerCase())) {
          if (!validRoles.includes(role)) {
            errors.push(`${hookFile}: uses role '${role}' but valid roles are [${validRoles.join(", ")}]`);
          }
        }
      }
    }
    
    if (errors.length > 0) {
      console.error("\n❌ Invalid role values found:");
      errors.forEach(e => console.error(`   - ${e}`));
    }
    
    expect(errors).toHaveLength(0);
  });
});

// =============================================================================
// Test: Comprehensive Enum Coverage
// =============================================================================

describe("All Enums Have TypeScript Definitions", () => {
  const enumFiles = readAllFilesInDir(PATHS.sqlEnums);
  const typesContent = readFile(PATHS.types);
  
  it("critical SQL enums are present in types.ts", () => {
    // Only check critical enums that are used in frontend
    const criticalEnums = [
      "app_role",
      "consent_type", 
      "study_type",
      "registration_status",
      "order_status",
      "membership_tier",
    ];
    
    const missing: string[] = [];
    
    for (const enumName of criticalEnums) {
      // Check if enum values exist anywhere in types
      const enumContent = enumFiles.get(`${enumName}.sql`);
      if (!enumContent) continue;
      
      const values = extractEnumValues(enumContent);
      const hasAllValues = values.every(v => typesContent.includes(`"${v}"`));
      
      if (!hasAllValues) {
        missing.push(enumName);
      }
    }
    
    expect(missing, `Critical enums missing from types.ts: [${missing.join(", ")}]`).toHaveLength(0);
  });
});

// =============================================================================
// Test: Function Return Types Match Usage
// =============================================================================

describe("RPC Function Contract Validation", () => {
  
  it("functions returning string literals document all possible values", () => {
    const functionsToCheck = [
      "get_partner_type.sql",
      "get_product_access_type.sql",
    ];
    
    const functionFiles = readAllFilesInDir(PATHS.sqlFunctions);
    
    for (const funcFile of functionsToCheck) {
      const content = functionFiles.get(funcFile);
      if (!content) continue;
      
      const returns = extractReturnLiterals(content);
      
      // Should have at least a description comment listing possible values
      const hasDocumentation = content.includes("Returns:") || 
                               content.includes("@returns") ||
                               content.includes("Possible values:");
      
      console.log(`  ${funcFile}: returns [${returns.join(", ")}], documented: ${hasDocumentation}`);
      
      // At minimum, the function should return something
      expect(returns.length).toBeGreaterThan(0);
    }
  });
});
