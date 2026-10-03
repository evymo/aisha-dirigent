/**
 * RPC Runtime Validation Tests
 * 
 * These tests verify that RPC functions work correctly at RUNTIME, not just statically.
 * They catch issues like:
 *   - Type cast errors (enum to text)
 *   - Column name mismatches (permission_code vs permission)
 *   - Missing SECURITY DEFINER when needed
 *   - Functions that return empty when they shouldn't
 * 
 * Unlike E2E tests, these run in the test environment and can be executed quickly.
 * 
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Configuration
// =============================================================================

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");
const SQL_FUNCTIONS_DIR = path.join(WORKSPACE_ROOT, "aisha/db/sql/functions");
const SQL_ENUMS_DIR = path.join(WORKSPACE_ROOT, "aisha/db/sql/enums");

// MLX AI validation lives in scripts/ai (optional, local-only)
const AI_SCRIPTS_DIR = path.join(WORKSPACE_ROOT, "scripts/ai");
const MLX_VENV_PYTHON = path.join(AI_SCRIPTS_DIR, ".venv/bin/python3");
const MLX_VALIDATE_SCRIPT = path.join(AI_SCRIPTS_DIR, "validate.py");

// =============================================================================
// Types
// =============================================================================

interface FunctionInfo {
  name: string;
  file: string;
  returnType: string | null;
  returnColumns: string[];
  usesEnumCast: boolean;
  enumsUsed: string[];
  hasSecurityDefiner: boolean;
  grantsAnon: boolean;
  grantsAuthenticated: boolean;
}

interface EnumInfo {
  name: string;
  values: string[];
}

interface MlxAvailability {
  available: boolean;
  reason: string;
  isAppleSilicon: boolean;
}

// =============================================================================
// SQL Parsing Utilities
// =============================================================================

function parseFunction(content: string, fileName: string): FunctionInfo | null {
  // Strip SQL comments to avoid matching in comment text
  const stripped = content
    .replace(/--[^\n]*/g, "") // Single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, ""); // Multi-line comments
  
  // Extract function name
  const nameMatch = stripped.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?(\w+)/i);
  if (!nameMatch) return null;
  
  const name = nameMatch[1];
  
  // Extract return type (from stripped content)
  const returnTypeMatch = stripped.match(/RETURNS\s+(TABLE\s*\([^)]+\)|SETOF\s+\w+|\w+(?:\s*\[\])?)/i);
  const returnType = returnTypeMatch ? returnTypeMatch[1].trim() : null;
  
  // Extract return columns for TABLE returns
  const returnColumns: string[] = [];
  if (returnType?.startsWith("TABLE")) {
    const columnsMatch = returnType.match(/TABLE\s*\(([^)]+)\)/i);
    if (columnsMatch) {
      const columns = columnsMatch[1].split(",").map(c => {
        const parts = c.trim().split(/\s+/);
        return parts[0]; // Column name
      });
      returnColumns.push(...columns);
    }
  }
  
  // Check for enum usage without cast
  // Pattern: SELECT ... enum_column ... (should be enum_column::TEXT)
  const usesEnumCast = /::TEXT/i.test(content);
  
  // Find enums used in the function
  const enumsUsed: string[] = [];
  const enumMatches = content.matchAll(/(\w+)::(?:app_role|admin_section|consent_type|study_type|registration_status|order_status|membership_tier)/gi);
  for (const match of enumMatches) {
    enumsUsed.push(match[1]);
  }
  
  // Check security
  const hasSecurityDefiner = /SECURITY\s+DEFINER/i.test(content);
  const grantsAnon = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+[^;]+TO\s+anon/i.test(content);
  const grantsAuthenticated = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+[^;]+TO\s+authenticated/i.test(content);
  
  return {
    name,
    file: fileName,
    returnType,
    returnColumns,
    usesEnumCast,
    enumsUsed,
    hasSecurityDefiner,
    grantsAnon,
    grantsAuthenticated,
  };
}

function parseEnum(content: string, fileName: string): EnumInfo | null {
  const nameMatch = content.match(/CREATE\s+TYPE\s+(?:public\.)?(\w+)\s+AS\s+ENUM/i);
  if (!nameMatch) return null;
  
  const name = nameMatch[1];
  
  const valuesMatch = content.match(/AS\s+ENUM\s*\(\s*([\s\S]*?)\)/i);
  if (!valuesMatch) return null;
  
  const values = valuesMatch[1]
    .split(",")
    .map(v => v.trim().replace(/^['"]|['"]$/g, ""))
    .filter(v => v.length > 0);
  
  return { name, values };
}

function getAllFunctions(): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  
  if (!fs.existsSync(SQL_FUNCTIONS_DIR)) return functions;
  
  const files = fs.readdirSync(SQL_FUNCTIONS_DIR).filter(f => f.endsWith(".sql"));
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(SQL_FUNCTIONS_DIR, file), "utf-8");
    const info = parseFunction(content, file);
    if (info) functions.push(info);
  }
  
  return functions;
}

function getAllEnums(): Map<string, EnumInfo> {
  const enums = new Map<string, EnumInfo>();
  
  if (!fs.existsSync(SQL_ENUMS_DIR)) return enums;
  
  const files = fs.readdirSync(SQL_ENUMS_DIR).filter(f => f.endsWith(".sql"));
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(SQL_ENUMS_DIR, file), "utf-8");
    const info = parseEnum(content, file);
    if (info) enums.set(info.name, info);
  }
  
  return enums;
}

// =============================================================================
// Optional AI (MLX) Validation Utilities
// =============================================================================

function checkMlxAvailability(): MlxAvailability {
  let isAppleSilicon = false;
  try {
    const arch = execSync("uname -m", { encoding: "utf-8" }).trim();
    isAppleSilicon = arch === "arm64";
  } catch {
    return { available: false, reason: "Cannot detect architecture", isAppleSilicon: false };
  }

  if (!isAppleSilicon) {
    return { available: false, reason: "Not Apple Silicon (arm64)", isAppleSilicon };
  }

  if (!fs.existsSync(MLX_VALIDATE_SCRIPT)) {
    return { available: false, reason: "Missing scripts/ai/validate.py", isAppleSilicon };
  }

  if (!fs.existsSync(MLX_VENV_PYTHON)) {
    return {
      available: false,
      reason: "MLX not setup (run: ./scripts/ai/setup-mlx.sh)",
      isAppleSilicon,
    };
  }

  try {
    execSync(`${MLX_VENV_PYTHON} -c "import mlx; import mlx_lm"`, { stdio: "pipe", timeout: 30000 });
  } catch {
    return { available: false, reason: "MLX packages not installed in venv", isAppleSilicon };
  }

  return { available: true, reason: "Ready (Apple MLX)", isAppleSilicon };
}

async function runMlxRpcValidation(options?: { fromMigrations?: boolean }): Promise<unknown> {
  const maxTokens = process.env.AI_MAX_TOKENS || process.env.MLX_RPC_MAX_TOKENS || "200";
  const fromMigrations = options?.fromMigrations === true;

  return await new Promise<unknown>((resolve, reject) => {
    const child = spawn(
      MLX_VENV_PYTHON,
      [
        MLX_VALIDATE_SCRIPT,
        "--check",
        "rpc",
        "--json",
        "--max-tokens",
        maxTokens,
        ...(fromMigrations ? ["--from-migrations"] : []),
      ],
      {
        cwd: WORKSPACE_ROOT,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          HF_HUB_DISABLE_TELEMETRY: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("MLX RPC validation timed out"));
    }, 300000);

    child.stdout.on("data", (d: Buffer) => stdoutChunks.push(d));
    child.stderr.on("data", (d: Buffer) => stderrChunks.push(d));

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();

      if (code !== 0) {
        reject(new Error(`MLX validation failed (code ${code}): ${stderr.slice(-1000)}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(
          new Error(
            `Failed to parse MLX JSON output. stdout_tail=${stdout.slice(-500)} stderr_tail=${stderr.slice(-500)} err=${String(e)}`
          )
        );
      }
    });
  });
}

// =============================================================================
// Critical Function Definitions
// These functions are critical and need extra validation
// =============================================================================

/**
 * Functions that return TEXT columns but might use enum sources.
 * Format: { function_name: { column: expected_source_enum } }
 */
const ENUM_TO_TEXT_FUNCTIONS: Record<string, Record<string, string>> = {
  get_user_permissions: {
    permission_code: "admin_section", // Was returning admin_section instead of TEXT
    role: "app_role",
  },
  get_partner_type: {
    // Returns TEXT, should be 'professional' | 'amateur' | 'uncertified'
  },
};

/**
 * Functions that must return specific columns (contract validation)
 * Use empty array for scalar functions or functions we don't validate columns for
 */
const FUNCTION_RETURN_CONTRACTS: Record<string, string[]> = {
  get_user_permissions: ["permission_code", "category", "role"],
  get_partner_type: [], // Scalar return
  get_active_studies: ["id", "code", "name", "description"], // Core columns
  get_public_products: ["id", "name", "description"],
};

/**
 * Functions that must be accessible by anon users
 * These are functions that have GRANT EXECUTE TO anon in their SQL files
 */
const ANON_REQUIRED_FUNCTIONS = [
  "get_supported_languages",
  "get_active_studies", 
  "get_public_products",
  "get_certified_partners",
  "get_extended_studies",
  "get_public_hero_slides",
  "get_public_homepage_stats",
  "get_public_product_by_slug",
  "get_study_detail",
  "get_user_permissions",
];

/**
 * Functions that MUST have SECURITY DEFINER if they grant to anon
 */
const SECURITY_DEFINER_REQUIRED_FOR_ANON = true;

// =============================================================================
// Tests
// =============================================================================

describe("RPC Function Runtime Validation", () => {
  let functions: FunctionInfo[];
  let enums: Map<string, EnumInfo>;
  let enumColumnIndex: Set<string>;

  beforeAll(async () => {
    functions = getAllFunctions();
    enums = getAllEnums();
    // Build enum-column index from CREATE TABLE statements so cast
    // heuristics can distinguish real enum sources from text columns that
    // merely have enum-like names (status/role/type).
    const { buildEnumColumnIndex } = await import("../../lib/test-helpers/enum-column-index");
    enumColumnIndex = buildEnumColumnIndex(
      path.join(WORKSPACE_ROOT, "aisha/db/sql/tables"),
      enums,
    );
    console.log(`\n📊 Loaded ${functions.length} functions and ${enums.size} enums for analysis (${enumColumnIndex.size} enum-typed columns)\n`);
  });
  
  // ---------------------------------------------------------------------------
  // Test: Enum to TEXT cast requirements
  // ---------------------------------------------------------------------------
  describe("Enum to TEXT Casting", () => {
    it("functions returning TEXT columns properly cast enum sources", () => {
      const issues: string[] = [];
      
      for (const [funcName, columns] of Object.entries(ENUM_TO_TEXT_FUNCTIONS)) {
        const func = functions.find(f => f.name === funcName);
        if (!func) {
          issues.push(`Function ${funcName} not found in SQL files`);
          continue;
        }
        
        // Read the actual file content
        const filePath = path.join(SQL_FUNCTIONS_DIR, func.file);
        const content = fs.readFileSync(filePath, "utf-8");
        
        // Check if function returns TEXT but uses enum columns
        for (const [column, sourceEnum] of Object.entries(columns)) {
          // The column should be cast to TEXT if it comes from an enum
          // Look for patterns like: rp.section AS permission_code (BAD)
          // vs: rp.section::TEXT AS permission_code (GOOD)
          // vs: aliased_column AS final_column where aliased_column was already cast (OK)
          
          // Check if the return type declares this column as text
          if (func.returnType?.toLowerCase().includes(`${column} text`)) {
            // Verify the SELECT actually casts to TEXT
            // Direct cast pattern: column::TEXT AS result
            const hasDirectCast = content.includes(`::TEXT AS ${column}`) || 
                                  content.includes(`::text AS ${column}`) ||
                                  content.includes(`::TEXT as ${column}`);
            
            // Also check if it uses a text literal directly (which is fine)
            const usesLiteral = content.match(new RegExp(`'[^']+' AS ${column}`, "i"));
            
            // Check if source enum has any ::TEXT cast in the file (for CTE-based casts)
            const hasSourceEnumCast = sourceEnum && 
              (content.includes(`::TEXT`) || content.includes(`::text`));
            
            // Look for problematic pattern: direct enum column without cast
            // Pattern: enum_type_column AS result_column (without ::TEXT)
            const problematicPattern = new RegExp(
              `\\b${sourceEnum}\\.\\w+\\s+AS\\s+${column}(?!.*::TEXT)`,
              "i"
            );
            const hasProblematicUse = sourceEnum && problematicPattern.test(content);
            
            // If no proper handling and potentially problematic
            if (!hasDirectCast && !usesLiteral && !hasSourceEnumCast && hasProblematicUse) {
              issues.push(
                `${func.file}: Column '${column}' declared as TEXT but might not be properly cast from enum source`
              );
            }
          }
        }
      }
      
      if (issues.length > 0) {
        console.error("\n❌ Enum casting issues found:");
        issues.forEach(i => console.error(`   - ${i}`));
      }
      
      expect(issues, "Some functions have enum-to-TEXT casting issues").toHaveLength(0);
    });
    
    /**
     * ⚠️ 2026-08-05 — PŘEPSÁNO NA VÝKON, TVRZENÍ BEZE ZMĚNY.
     *
     * Test padal TIMEOUTEM, ne asercí: pro KAŽDÝ text-sloupec četl soubor znovu
     * a stavěl regex se VŠEMI enumy (69), přičemž `[^:]*?` nad souborem plným
     * `::` castů spouští katastrofický backtracking. Cena rostla s délkou
     * souboru, ne s počtem skutečných problémů — takže první dlouhá funkce
     * s `text` sloupcem bránu překlopila, aniž by na ní cokoli bylo špatně.
     *
     * Změřeno A/B na TÉTO větvi: bez nové funkce 87 s (zeleně), s ní 130 s
     * (timeout na 120 s). Přidání jednoho souboru stálo ~43 s.
     *
     * Dvě změny, obě čistě výkonové:
     *   1. soubor se čte JEDNOU na funkci, ne jednou na sloupec,
     *   2. enumy se předfiltrují na ty, které se v souboru vůbec vyskytují —
     *      regex se pak staví pro jednotky, ne pro 69 kandidátů.
     * Množina hlášených problémů je TÁŽ: enum, který v souboru není, nemohl
     * nikdy dát shodu, takže jeho vynechání nic nezakrývá.
     *
     * ⛔ POZOR PŘI DALŠÍ ÚPRAVĚ: tenhle blok NEMÁ `expect` — v původní podobě
     * je to vědomě jen varování do konzole (viz komentář na konci). Jediné, čím
     * dokáže shodit CI, je právě timeout. Test, který nic netvrdí a padá na
     * rychlosti čtení souborů, měří stroj, ne kód.
     */
    it("all TABLE functions with text return columns use proper casts", { timeout: 120000 }, () => {
      const issues: string[] = [];
      const enumTypes = Array.from(enums.keys());

      for (const func of functions) {
        if (!func.returnType?.startsWith("TABLE")) continue;

        // Check for columns declared as text
        const textColumns = Array.from(func.returnType.matchAll(/(\w+)\s+text/gi));
        if (textColumns.length === 0) continue;

        // Read file ONCE per function (was: once per text column).
        const filePath = path.join(SQL_FUNCTIONS_DIR, func.file);
        const content = fs.readFileSync(filePath, "utf-8");

        // Only enums actually mentioned in this file can ever match — checking
        // the rest is pure backtracking cost.
        const presentEnums = enumTypes.filter((e) => content.includes(e));
        if (presentEnums.length === 0) continue;

        for (const match of textColumns) {
          const columnName = match[1];

          // Look for enum types being used without cast
          for (const enumType of presentEnums) {
            // Pattern: enum_type_column AS column_name (without ::TEXT)
            const badPattern = new RegExp(
              `\\b(\\w+)::${enumType}[^:]*?\\s+AS\\s+${columnName}(?!::TEXT)`,
              "gi"
            );
            
            if (badPattern.test(content)) {
              issues.push(
                `${func.file}: Column '${columnName}' might be using ${enumType} enum without TEXT cast`
              );
            }
          }
        }
      }
      
      if (issues.length > 0) {
        console.error("\n⚠️ Potential enum casting issues (review manually):");
        issues.forEach(i => console.error(`   - ${i}`));
      }
      
      // This is a warning, not a hard failure (might have false positives)
      // But log it for review
    });
  });
  
  // ---------------------------------------------------------------------------
  // Test: Return column contracts
  // ---------------------------------------------------------------------------
  describe("Return Column Contracts", () => {
    it("critical functions have expected return columns", () => {
      const issues: string[] = [];
      
      for (const [funcName, expectedColumns] of Object.entries(FUNCTION_RETURN_CONTRACTS)) {
        if (expectedColumns.length === 0) continue; // Scalar functions
        
        const func = functions.find(f => f.name === funcName);
        if (!func) {
          issues.push(`Function ${funcName} not found`);
          continue;
        }
        
        for (const col of expectedColumns) {
          if (!func.returnColumns.includes(col)) {
            issues.push(
              `${funcName}: Missing expected column '${col}'. Has: [${func.returnColumns.join(", ")}]`
            );
          }
        }
      }
      
      if (issues.length > 0) {
        console.error("\n❌ Contract violations found:");
        issues.forEach(i => console.error(`   - ${i}`));
      }
      
      expect(issues).toHaveLength(0);
    });
  });
  
  // ---------------------------------------------------------------------------
  // Test: Anon function security
  // ---------------------------------------------------------------------------
  describe("Anonymous Access Security", () => {
    it("functions granting anon access have SECURITY DEFINER", () => {
      const issues: string[] = [];
      
      for (const func of functions) {
        if (func.grantsAnon && !func.hasSecurityDefiner) {
          issues.push(
            `${func.file}: Grants EXECUTE to anon but lacks SECURITY DEFINER - will fail on RLS-protected tables`
          );
        }
      }
      
      if (issues.length > 0) {
        console.error("\n❌ Security configuration issues:");
        issues.forEach(i => console.error(`   - ${i}`));
      }
      
      expect(issues).toHaveLength(0);
    });
    
    it("required anon functions have proper grants", () => {
      const missing: string[] = [];
      
      for (const funcName of ANON_REQUIRED_FUNCTIONS) {
        const func = functions.find(f => f.name === funcName);
        
        if (!func) {
          missing.push(`${funcName}: Function not found`);
          continue;
        }
        
        if (!func.grantsAnon) {
          missing.push(`${funcName}: Missing GRANT EXECUTE TO anon`);
        }
      }
      
      if (missing.length > 0) {
        console.error("\n❌ Missing anon grants:");
        missing.forEach(m => console.error(`   - ${m}`));
      }
      
      expect(missing).toHaveLength(0);
    });
  });
  
  // ---------------------------------------------------------------------------
  // Test: Common SQL anti-patterns that cause runtime errors
  // ---------------------------------------------------------------------------
  describe("SQL Anti-patterns Detection", () => {
    it("functions don't have common cast issues", () => {
      const issues: string[] = [];
      
      for (const func of functions) {
        const filePath = path.join(SQL_FUNCTIONS_DIR, func.file);
        const content = fs.readFileSync(filePath, "utf-8");
        
        // Anti-pattern 1: Selecting an enum-typed column without ::TEXT cast
        // when the function declares the return column as text.
        // Example: SELECT rp.section AS permission_code (where section is enum).
        // Naming alone is unreliable — confirm against `enumColumnIndex` so
        // plain text columns named `type`/`status`/etc. are not flagged.
        if (func.returnType?.includes("text")) {
          const enumLikeNames = ["section", "role", "status", "type", "tier", "category"];

          for (const col of enumLikeNames) {
            const pattern = new RegExp(
              `\\b(\\w+)\\.${col}\\s+AS\\s+(\\w+)(?![^,]*::TEXT)`,
              "gi",
            );

            const matches = content.matchAll(pattern);
            for (const match of matches) {
              const aliasRef = match[1];
              const returnCol = match[2];
              if (!func.returnType?.toLowerCase().includes(`${returnCol} text`)) continue;

              // Resolve alias → table via FROM clause and check the index.
              const aliasMatch = content.match(
                new RegExp(`FROM\\s+(?:public\\.)?(\\w+)(?:\\s+(?:AS\\s+)?${aliasRef})?`, "i"),
              );
              const tableName = aliasMatch ? aliasMatch[1].toLowerCase() : aliasRef.toLowerCase();
              if (!enumColumnIndex.has(`${tableName}.${col}`)) continue;

              issues.push(
                `${func.file}: '${col}' selected AS '${returnCol}' (text) from enum-typed '${tableName}.${col}' — missing ::TEXT cast`,
              );
            }
          }
        }
        
        // Anti-pattern 2: RETURN QUERY without proper text conversion.
        // Only fire when the source column is genuinely typed as an enum
        // (collected from CREATE TABLE statements). Naming alone is not a
        // reliable signal — many "name"/"status"/"type" columns are
        // varchar/text and need no cast.
        if (content.includes("RETURN QUERY") && func.returnType?.startsWith("TABLE")) {
          const textCols = func.returnType.matchAll(/(\w+)\s+text/gi);
          for (const match of textCols) {
            const colName = match[1].toLowerCase();

            const returnQuery = content.match(/RETURN\s+QUERY[\s\S]*?;/gi);
            if (!returnQuery) continue;
            for (const rq of returnQuery) {
              const suspiciousPattern = new RegExp(
                `\\b(\\w+)\\.(\\w+)\\s+AS\\s+${colName}\\b(?![^,;]*::TEXT)`,
                "i",
              );
              const m2 = rq.match(suspiciousPattern);
              if (!m2) continue;
              // m2[1] = alias/table-ref, m2[2] = source column.
              // Resolve alias → table using the FROM clause.
              const aliasMatch = rq.match(
                new RegExp(`FROM\\s+(?:public\\.)?(\\w+)(?:\\s+(?:AS\\s+)?${m2[1]})?`, "i"),
              );
              const tableName = aliasMatch ? aliasMatch[1].toLowerCase() : m2[1].toLowerCase();
              const sourceCol = m2[2].toLowerCase();

              // Only flag if the source column is genuinely enum-typed.
              if (enumColumnIndex.has(`${tableName}.${sourceCol}`)) {
                issues.push(
                  `${func.file}: RETURN QUERY selects '${colName}' from enum-typed '${tableName}.${sourceCol}' without ::TEXT cast`,
                );
              }
            }
          }
        }
      }
      
      // Remove duplicates
      const uniqueIssues = [...new Set(issues)];
      
      if (uniqueIssues.length > 0) {
        console.warn("\n⚠️ Potential SQL issues to review:");
        uniqueIssues.forEach(i => console.warn(`   - ${i}`));
      }
      
      // Log but don't fail - these are heuristics
      console.log(`\n📋 Found ${uniqueIssues.length} patterns to review (not necessarily bugs)`);
    });
  });
  
  // ---------------------------------------------------------------------------
  // Test: Frontend schema expectations
  // ---------------------------------------------------------------------------
  describe("Frontend Schema Alignment", () => {
    it("permission functions return columns matching frontend schema", () => {
      const func = functions.find(f => f.name === "get_user_permissions");
      
      if (!func) {
        console.warn("get_user_permissions not found - skipping");
        return;
      }
      
      // Frontend schema expects: { permission: string, ... } or { permission_code: string, ... }
      // See: src/lib/validation/rpcSchemas.ts - userPermissionRowSchema
      
      const acceptableColumns = [
        ["permission_code", "category", "role"], // Current schema
        ["section", "permission", "role"], // Legacy schema (to be deprecated)
      ];
      
      const hasValidSchema = acceptableColumns.some(
        cols => cols.every(c => func.returnColumns.includes(c))
      );
      
      if (!hasValidSchema) {
        console.error(
          `get_user_permissions returns [${func.returnColumns.join(", ")}] ` +
          `but frontend expects one of: ${acceptableColumns.map(c => `[${c.join(", ")}]`).join(" or ")}`
        );
      }
      
      expect(hasValidSchema, "get_user_permissions schema mismatch").toBe(true);
    });
    
    it("partner type function returns expected values", () => {
      const func = functions.find(f => f.name === "get_partner_type");
      
      if (!func) {
        console.warn("get_partner_type not found - skipping");
        return;
      }
      
      // Read the file to check return values
      const filePath = path.join(SQL_FUNCTIONS_DIR, func.file);
      const content = fs.readFileSync(filePath, "utf-8");
      
      // Frontend expects: "professional" | "amateur" | "uncertified"
      const expectedValues = ["professional", "amateur", "uncertified"];
      
      const returnMatches = content.matchAll(/RETURN\s+['"](\w+)['"]/gi);
      const actualValues = Array.from(returnMatches, m => m[1].toLowerCase());
      
      console.log(`  get_partner_type returns: [${actualValues.join(", ")}]`);
      console.log(`  Frontend expects: [${expectedValues.join(", ")}]`);
      
      // Check that all returned values are expected
      const unexpectedValues = actualValues.filter(v => !expectedValues.includes(v));
      
      if (unexpectedValues.length > 0) {
        console.error(`Unexpected return values: [${unexpectedValues.join(", ")}]`);
      }
      
      expect(unexpectedValues, "Unexpected return values in get_partner_type").toHaveLength(0);
    });
  });
  
  // ---------------------------------------------------------------------------
  // Test: Summary statistics
  // ---------------------------------------------------------------------------
  describe("Summary", () => {
    it("prints function analysis summary", () => {
      const withSecurityDefiner = functions.filter(f => f.hasSecurityDefiner).length;
      const withAnonGrant = functions.filter(f => f.grantsAnon).length;
      const withAuthGrant = functions.filter(f => f.grantsAuthenticated).length;
      const tableReturns = functions.filter(f => f.returnType?.startsWith("TABLE")).length;
      
      console.log("\n📊 SQL Function Analysis Summary:");
      console.log(`   Total functions: ${functions.length}`);
      console.log(`   With SECURITY DEFINER: ${withSecurityDefiner}`);
      console.log(`   With GRANT TO anon: ${withAnonGrant}`);
      console.log(`   With GRANT TO authenticated: ${withAuthGrant}`);
      console.log(`   Returning TABLE: ${tableReturns}`);
      console.log(`   Enums loaded: ${enums.size}`);
      
      // This is just informational
      expect(true).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Optional: AI (MLX) validation extension (local-only)
  // ---------------------------------------------------------------------------
  describe("AI (MLX) RPC Validation", () => {
    const mlx = checkMlxAvailability();
    const enabledByEnv = process.env.RUN_MLX_RPC_VALIDATION === "1";
    const runFromMigrations = process.env.RUN_MLX_RPC_VALIDATION_FROM_MIGRATIONS === "1";

    let rpcSourceResultPromise: Promise<unknown> | null = null;
    let rpcMigrationsResultPromise: Promise<unknown> | null = null;

    const getRpcSourceResult = async (): Promise<unknown> => {
      if (!rpcSourceResultPromise) {
        rpcSourceResultPromise = runMlxRpcValidation({ fromMigrations: false });
      }
      return rpcSourceResultPromise;
    };

    const getRpcMigrationsResult = async (): Promise<unknown> => {
      if (!rpcMigrationsResultPromise) {
        rpcMigrationsResultPromise = runMlxRpcValidation({ fromMigrations: true });
      }
      return rpcMigrationsResultPromise;
    };

    it("reports MLX RPC validation status", () => {
      console.log(`\n🤖 MLX RPC Validation: ${mlx.available ? "Available" : "Unavailable"}`);
      console.log(`   Reason: ${mlx.reason}`);
      console.log(`   Enabled: ${enabledByEnv ? "Yes" : "No"} (set RUN_MLX_RPC_VALIDATION=1)`);
      expect(true).toBe(true);
    });

    it.skipIf(!enabledByEnv || !mlx.available)(
      "flags critical RPC security issues via MLX",
      async () => {
        const result = await getRpcSourceResult();

        // validate.py returns: { rpc: { summary: { critical_issues }, ... } }
        const rpc = (result as Record<string, unknown>)?.rpc as Record<string, unknown> | undefined;
        const summary = (rpc?.summary as Record<string, unknown> | undefined) || undefined;
        const criticalIssues = Number((summary?.critical_issues as number | undefined) ?? NaN);

        if (!Number.isFinite(criticalIssues)) {
          throw new Error("Unexpected MLX output shape for rpc.summary.critical_issues");
        }

        if (criticalIssues > 0) {
          const critical = (rpc?.security_critical as unknown[] | undefined) || [];
          console.error("\n❌ MLX detected critical RPC security issues:");
          for (const item of critical.slice(0, 20)) {
            try {
              console.error(`   - ${JSON.stringify(item)}`);
            } catch {
              console.error("   - (unstringifiable item)");
            }
          }
        }

        expect(criticalIssues, "MLX found critical RPC security issues").toBe(0);
      },
      360000
    );

    it.skipIf(!enabledByEnv || !mlx.available)(
      "prints MLX RPC summary counts",
      async () => {
        const result = await getRpcSourceResult();
        const rpc = (result as Record<string, unknown>)?.rpc as Record<string, unknown> | undefined;
        const summary = (rpc?.summary as Record<string, unknown> | undefined) || {};

        const total = Number((summary.total as number | undefined) ?? NaN);
        const critical = Number((summary.critical_issues as number | undefined) ?? NaN);
        const warnings = Number((summary.warnings as number | undefined) ?? NaN);
        const phiIssues = Number((summary.secure_issues as number | undefined) ?? NaN);

        if (![total, critical, warnings, phiIssues].every((n) => Number.isFinite(n))) {
          throw new Error("Unexpected MLX output shape for rpc.summary.{total,critical_issues,warnings,secure_issues}");
        }

        console.log("\n🤖 MLX RPC Summary:");
        console.log(`   total=${total} critical=${critical} warnings=${warnings} secure_issues=${phiIssues}`);

        expect(true).toBe(true);
      },
      360000
    );

    it.skipIf(!enabledByEnv || !mlx.available || !runFromMigrations)(
      "flags critical RPC security issues via MLX (from migrations)",
      async () => {
        const result = await getRpcMigrationsResult();

        const rpc = (result as Record<string, unknown>)?.rpc as Record<string, unknown> | undefined;
        const summary = (rpc?.summary as Record<string, unknown> | undefined) || undefined;
        const criticalIssues = Number((summary?.critical_issues as number | undefined) ?? NaN);

        if (!Number.isFinite(criticalIssues)) {
          throw new Error("Unexpected MLX output shape for rpc.summary.critical_issues (from migrations)");
        }

        if (criticalIssues > 0) {
          const critical = (rpc?.security_critical as unknown[] | undefined) || [];
          console.error("\n❌ MLX (migrations) detected critical RPC security issues:");
          for (const item of critical.slice(0, 20)) {
            try {
              console.error(`   - ${JSON.stringify(item)}`);
            } catch {
              console.error("   - (unstringifiable item)");
            }
          }
        }

        expect(criticalIssues, "MLX (migrations) found critical RPC security issues").toBe(0);
      },
      360000
    );
  });
});
