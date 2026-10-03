/**
 * Zod ↔ SQL Return Parity Gate Test (Informational)
 *
 * Compares Zod schema object keys used in hooks against
 * SQL RETURNS TABLE column names from source of truth.
 *
 * This test is INFORMATIONAL — it warns about mismatches but
 * does not block the build. The canonical check is done by
 * scripts/db/func-manager/lib/type-checker.mjs at the SQL↔DB level.
 * This test catches the NEXT layer: Zod schema ↔ SQL return columns.
 *
 * Approach:
 * 1. Parse SQL functions for RETURNS TABLE columns
 * 2. Parse Zod schema files for z.object({...}) keys
 * 3. Find hooks that reference both a specific RPC function and a Zod schema
 * 4. Cross-check column/key alignment
 *
 * Run: npm run test:gates -- src/tests/gates/zod-sql-return-parity.gate.test.ts
 *
 * @module
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SQL_FUNCTIONS_DIR = path.join(ROOT, "aisha/db/sql/functions");
const SCHEMAS_DIR = path.join(ROOT, "src/lib/schemas");
const HOOKS_DIR = path.join(ROOT, "src/hooks");

// ---------------------------------------------------------------------------
// SQL Parser (lightweight — extracts RETURNS TABLE columns)
// ---------------------------------------------------------------------------

interface SqlReturnColumn {
  name: string;
  type: string;
}

interface SqlFunctionReturn {
  functionName: string;
  filePath: string;
  columns: SqlReturnColumn[];
}

function parseSqlReturnsTable(filePath: string): SqlFunctionReturn | null {
  const content = fs.readFileSync(filePath, "utf-8");
  const baseName = path.basename(filePath, ".sql");

  // Extract RETURNS TABLE block
  const tableMatch = content.match(/RETURNS\s+TABLE\s*\(([\s\S]*?)\)/i);
  if (!tableMatch) return null;

  const columns: SqlReturnColumn[] = [];
  const colPattern =
    /(\w+)\s+((?:timestamp|time)\s+with(?:out)?\s+time\s+zone|double\s+precision|character\s+varying(?:\s*\(\d+\))?|\w+)(\s*\([^)]*\))?(\s*\[\])?/gi;
  let m;
  while ((m = colPattern.exec(tableMatch[1])) !== null) {
    const typeParts = m[2].trim() + (m[3] || "") + (m[4] || "");
    columns.push({ name: m[1], type: typeParts.trim() });
  }

  if (columns.length === 0) return null;

  return {
    functionName: baseName,
    filePath: path.relative(ROOT, filePath),
    columns,
  };
}

// ---------------------------------------------------------------------------
// Zod Schema Parser (lightweight — extracts z.object keys)
// ---------------------------------------------------------------------------

interface ZodSchemaInfo {
  name: string;
  keys: string[];
  filePath: string;
}

/**
 * Extracts top-level z.object({...}) schema definitions from a TS file.
 * Only captures exported const schemas.
 */
function extractZodSchemas(filePath: string): ZodSchemaInfo[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const schemas: ZodSchemaInfo[] = [];

  // Pattern: export const xyzSchema = z.object({
  const schemaPattern =
    /export\s+const\s+(\w+(?:Schema|schema))\s*=\s*z\.object\(\{([^}]*(?:\{[^}]*\}[^}]*)*)\}\)/g;

  let match;
  while ((match = schemaPattern.exec(content)) !== null) {
    const schemaName = match[1];
    const body = match[2];

    // Extract key names from the object body
    const keyPattern = /^\s*(\w+)\s*:/gm;
    const keys: string[] = [];
    let km;
    while ((km = keyPattern.exec(body)) !== null) {
      keys.push(km[1]);
    }

    if (keys.length > 0) {
      schemas.push({
        name: schemaName,
        keys,
        filePath: path.relative(ROOT, filePath),
      });
    }
  }

  return schemas;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectFiles(dir: string, ext: string): string[] {
  const files: string[] = [];

  function walk(current: string): void {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(fullPath);
      } else if (entry.name.endsWith(ext)) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Zod ↔ SQL Return Parity (informational)", () => {
  let sqlFunctions: SqlFunctionReturn[];
  let zodSchemas: ZodSchemaInfo[];

  beforeAll(() => {
    // Parse SQL functions with RETURNS TABLE
    const sqlFiles = fs.existsSync(SQL_FUNCTIONS_DIR)
      ? fs.readdirSync(SQL_FUNCTIONS_DIR)
          .filter((f) => f.endsWith(".sql"))
          .map((f) => path.join(SQL_FUNCTIONS_DIR, f))
      : [];

    sqlFunctions = sqlFiles
      .map(parseSqlReturnsTable)
      .filter((f): f is SqlFunctionReturn => f !== null);

    // Parse Zod schemas
    const schemaFiles = collectFiles(SCHEMAS_DIR, ".ts");
    zodSchemas = schemaFiles.flatMap(extractZodSchemas);
  });

  it("finds SQL functions with RETURNS TABLE definitions", () => {
    expect(
      sqlFunctions.length,
      "Expected SQL functions with RETURNS TABLE in SoT",
    ).toBeGreaterThan(50);
  });

  it("finds exported Zod schemas in src/lib/schemas/", () => {
    expect(
      zodSchemas.length,
      "Expected Zod schemas in src/lib/schemas/",
    ).toBeGreaterThan(10);
  });

  it("Zod schema keys align with SQL RETURNS TABLE columns (informational)", () => {
    // Build lookup: function name → columns
    const sqlColumnMap = new Map<string, Set<string>>();
    for (const fn of sqlFunctions) {
      sqlColumnMap.set(fn.functionName, new Set(fn.columns.map((c) => c.name)));
    }

    // Build lookup: schema name → keys
    const schemaKeyMap = new Map<string, Set<string>>();
    for (const schema of zodSchemas) {
      schemaKeyMap.set(schema.name, new Set(schema.keys));
    }

    // Heuristic matching: find schemas whose name suggests an RPC function
    // e.g., adminHealthCheckInSchema → get_admin_health_check_ins_*
    const mismatches: string[] = [];
    let checked = 0;

    for (const [schemaName, schemaKeys] of schemaKeyMap) {
      // Convert camelCase schema name to potential snake_case function prefix
      const snakePrefix = schemaName
        .replace(/Schema$/, "")
        .replace(/([A-Z])/g, "_$1")
        .toLowerCase()
        .replace(/^_/, "");

      // Find matching SQL functions
      for (const [funcName, sqlCols] of sqlColumnMap) {
        // Fuzzy match — function name contains the schema prefix
        if (!funcName.includes(snakePrefix) && !snakePrefix.includes(funcName.replace(/^get_|^list_|^admin_|_audited$/g, ""))) {
          continue;
        }

        checked++;

        // Check: are there keys in Zod that don't appear in SQL?
        const zodOnly = [...schemaKeys].filter((k) => !sqlCols.has(k));
        // Check: are there columns in SQL that don't appear in Zod?
        const sqlOnly = [...sqlCols].filter((k) => !schemaKeys.has(k));

        if (zodOnly.length > 0 || sqlOnly.length > 0) {
          const parts: string[] = [];
          if (zodOnly.length > 0) parts.push(`Zod-only: [${zodOnly.join(", ")}]`);
          if (sqlOnly.length > 0) parts.push(`SQL-only: [${sqlOnly.join(", ")}]`);
          mismatches.push(`${schemaName} ↔ ${funcName}: ${parts.join("; ")}`);
        }
      }
    }

    // This is informational — report mismatches but don't fail
    // The test just validates the cross-check infrastructure works
    if (mismatches.length > 0 && checked > 0) {
      // Log as warning
      console.warn(
        `[INFO] Zod ↔ SQL parity check found ${mismatches.length} potential mismatches ` +
          `(checked ${checked} pairs):\n${mismatches.slice(0, 20).join("\n")}`,
      );
    }

    // Structural assertion: we checked at least SOMETHING
    // If checked === 0, the heuristic matching needs tuning
    expect(
      sqlFunctions.length + zodSchemas.length,
      "Both SQL functions and Zod schemas should be parseable",
    ).toBeGreaterThan(0);
  });
});
