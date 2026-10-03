/**
 * RPC Field Mismatch Detection Tests
 *
 * Automated tests to detect common field name mismatches between:
 * 1. SQL RETURNS TABLE column names vs TypeScript usage
 * 2. Zod schema field names vs frontend object literal keys
 * 3. camelCase vs snake_case inconsistencies in RPC params
 *
 * These patterns cause runtime null/undefined errors that TypeScript
 * may not catch when using generated types or any casts.
 *
 * @see AGENTS.md for RPC-only architecture requirements
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// =====================================================
// HELPERS
// =====================================================

function findTypeScriptFiles(dir: string, pattern?: RegExp): string[] {
  const files: string[] = [];

  function walk(directory: string) {
    if (!fs.existsSync(directory)) return;

    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules, test files, etc.
        if (!["node_modules", ".git", "dist", "coverage"].includes(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile() && /\.(tsx?|js|jsx)$/.test(entry.name)) {
        if (!pattern || pattern.test(fullPath)) {
          files.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Extract Zod schema field names from a schema definition
 */
function extractZodSchemaFields(schemaContent: string, schemaName: string): string[] {
  // Match: export const schemaName = z.object({ ... })
  const schemaPattern = new RegExp(
    `(?:export\\s+)?const\\s+${schemaName}\\s*=\\s*z\\.object\\(\\s*\\{([^}]+(?:\\{[^}]*\\}[^}]*)*)\\}\\s*\\)`,
    "s"
  );
  const match = schemaContent.match(schemaPattern);
  if (!match) return [];

  const objectBody = match[1];
  const fields: string[] = [];

  // Extract field names (before the colon)
  const fieldPattern = /^\s*(\w+)\s*:/gm;
  let fieldMatch;
  while ((fieldMatch = fieldPattern.exec(objectBody)) !== null) {
    fields.push(fieldMatch[1]);
  }

  return fields;
}

/**
 * Extract object literal keys from mutate/rpc calls
 * Example: confirmTaken.mutate({ planId }) -> ["planId"]
 * Example: confirmTaken.mutate({ plan_id: planId }) -> ["plan_id"]
 */
function extractObjectLiteralKeys(code: string, pattern: RegExp): Array<{ line: number; keys: string[]; raw: string }> {
  const results: Array<{ line: number; keys: string[]; raw: string }> = [];
  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(pattern);
    if (match) {
      // Extract object literal { key1, key2: value }
      const objMatch = line.match(/\(\s*\{([^}]+)\}/);
      if (objMatch) {
        const objContent = objMatch[1];
        const keys: string[] = [];

        // Split by comma and extract keys
        const parts = objContent.split(",").map(p => p.trim());
        for (const part of parts) {
          if (!part) continue;
          
          // Check if it's { key: value } or just { key } (shorthand)
          if (part.includes(":")) {
            // { key: value } - extract the key (left side of colon)
            const keyPart = part.split(":")[0].trim();
            if (/^\w+$/.test(keyPart)) {
              keys.push(keyPart);
            }
          } else {
            // { key } - shorthand property, the identifier IS the key
            const keyMatch = part.match(/^(\w+)$/);
            if (keyMatch) {
              keys.push(keyMatch[1]);
            }
          }
        }

        results.push({
          line: i + 1,
          keys,
          raw: objContent.trim(),
        });
      }
    }
  }

  return results;
}

/**
 * Find camelCase vs snake_case mismatches
 * Example: planId should be plan_id
 */
function detectCamelSnakeMismatch(
  frontendKey: string,
  schemaFields: string[]
): { expected: string | null; type: "camel_to_snake" | "snake_to_camel" | null } {
  // Convert camelCase to snake_case
  const toSnakeCase = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
  // Convert snake_case to camelCase
  const toCamelCase = (s: string) =>
    s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

  const snakeVersion = toSnakeCase(frontendKey);
  const camelVersion = toCamelCase(frontendKey);

  if (schemaFields.includes(snakeVersion) && !schemaFields.includes(frontendKey)) {
    return { expected: snakeVersion, type: "camel_to_snake" };
  }

  if (schemaFields.includes(camelVersion) && !schemaFields.includes(frontendKey)) {
    return { expected: camelVersion, type: "snake_to_camel" };
  }

  return { expected: null, type: null };
}

/**
 * Extract SQL RETURNS TABLE columns
 */
function extractSqlReturnColumns(sqlContent: string): string[] {
  // Match RETURNS TABLE ( ... ) with multi-line support
  const returnMatch = sqlContent.match(
    /RETURNS\s+TABLE\s*\(\s*([\s\S]*?)\)\s*(?:LANGUAGE|AS)/i
  );
  if (!returnMatch) return [];

  const columnsBlock = returnMatch[1];
  const columns: string[] = [];

  // Split by comma (but not inside parentheses for types like NUMERIC(10,2))
  const lines = columnsBlock
    .split(/,(?![^()]*\))/)
    .map((l) => l.trim())
    .filter((l) => l);

  for (const line of lines) {
    // Column name is first word (may be quoted)
    const match = line.match(/^"?(\w+)"?\s+/);
    if (match) {
      columns.push(match[1]);
    }
  }

  return columns;
}

// =====================================================
// TEST DATA - Known Zod schemas and their files
// =====================================================

const MUTATION_SCHEMA_MAP: Record<
  string,
  { schemaFile: string; schemaName: string; mutationPattern: RegExp }
> = {
  useConfirmProductTaken: {
    schemaFile: "src/lib/schemas/memberDiarySchemas.ts",
    schemaName: "confirmProductTakenInputSchema",
    mutationPattern: /confirmTaken\.mutate|useConfirmProductTaken.*\.mutate/,
  },
  useUpdateProductLog: {
    schemaFile: "src/lib/schemas/memberDiarySchemas.ts",
    schemaName: "updateProductLogInputSchema",
    mutationPattern: /updateLog\.mutate|useUpdateProductLog.*\.mutate/,
  },
  useCreateProduct: {
    schemaFile: "src/lib/schemas/memberDiarySchemas.ts",
    schemaName: "createProductInputSchema",
    mutationPattern: /createProduct\.mutate|useCreateProduct.*\.mutate/,
  },
  useCreateTrackingState: {
    schemaFile: "src/lib/schemas/memberDiarySchemas.ts",
    schemaName: "createTrackingStateInputSchema",
    mutationPattern: /createHealthState\.mutate|useCreateTrackingState.*\.mutate/,
  },
  useLogTrackingState: {
    schemaFile: "src/lib/schemas/memberDiarySchemas.ts",
    schemaName: "logTrackingStateInputSchema",
    mutationPattern: /logHealthState\.mutate|useLogTrackingState.*\.mutate/,
  },
  useCreateProductPlan: {
    schemaFile: "src/lib/schemas/memberDiarySchemas.ts",
    schemaName: "createProductPlanInputSchema",
    mutationPattern: /createPlan\.mutate|useCreateProductPlan.*\.mutate/,
  },
};

// =====================================================
// TESTS
// =====================================================

describe("RPC Field Mismatch Detection", () => {
  describe("camelCase vs snake_case in mutation parameters", () => {
    const srcDir = path.resolve(__dirname, "../../../src");

    it("detects camelCase keys where snake_case is expected (Zod schemas)", { timeout: 60000 }, () => {
      const mismatches: Array<{
        file: string;
        line: number;
        frontendKey: string;
        expectedKey: string;
        raw: string;
      }> = [];

      // Load Zod schemas
      const schemaCache: Record<string, string[]> = {};

      // Scan src/ ONCE and pre-read non-test files (perf: this used to walk the
      // whole tree + readFileSync every file once PER schema = O(schemas × files),
      // which crossed the 60s timeout as src/ grew. Hoisted to O(files).
      // Test files were already skipped — now skipped BEFORE the read, not after.
      const sourceFiles = findTypeScriptFiles(srcDir, /\.(tsx?)$/)
        .filter((f) => !f.includes(".test.") && !f.includes(".spec."))
        .map((f) => ({ file: f, content: fs.readFileSync(f, "utf-8") }));

      for (const [hookName, config] of Object.entries(MUTATION_SCHEMA_MAP)) {
        const schemaPath = path.resolve(__dirname, "../../../", config.schemaFile);
        if (!fs.existsSync(schemaPath)) continue;

        const schemaContent = fs.readFileSync(schemaPath, "utf-8");
        const schemaFields = extractZodSchemaFields(schemaContent, config.schemaName);
        if (schemaFields.length === 0) continue;

        schemaCache[hookName] = schemaFields;

        for (const { file, content } of sourceFiles) {
          // Check if file uses this mutation pattern
          if (!config.mutationPattern.test(content)) continue;

          // Extract object literal keys from mutation calls
          const usages = extractObjectLiteralKeys(content, config.mutationPattern);

          for (const usage of usages) {
            for (const key of usage.keys) {
              // Check for camelCase -> snake_case mismatch
              const mismatch = detectCamelSnakeMismatch(key, schemaFields);
              if (mismatch.expected) {
                mismatches.push({
                  file: path.relative(srcDir, file),
                  line: usage.line,
                  frontendKey: key,
                  expectedKey: mismatch.expected,
                  raw: usage.raw,
                });
              }
            }
          }
        }
      }

      // Report mismatches
      if (mismatches.length > 0) {
        const report = mismatches
          .map(
            (m) =>
              `  ${m.file}:${m.line}\n    Found: "${m.frontendKey}" → Expected: "${m.expectedKey}"\n    Context: { ${m.raw} }`
          )
          .join("\n\n");

        expect.fail(
          `Found ${mismatches.length} camelCase/snake_case mismatch(es):\n\n${report}`
        );
      }

      expect(mismatches).toHaveLength(0);
    });
  });

  describe("SQL column vs TypeScript field name mismatches", () => {
    const sqlFunctionsDir = path.resolve(__dirname, "../../../aisha/db/sql/functions");
    const srcDir = path.resolve(__dirname, "../../../src");

    // Map of RPC function -> known field name discrepancies
    const FIELD_ALIAS_MAP: Record<string, Record<string, string>> = {
      get_audit_journal: {
        // SQL returns 'action', TypeScript might use 'action_type'
        action: "action",
        metadata: "metadata", // SQL returns 'metadata', not 'details'
      },
    };

    /**
     * Extract RPC function names called in a TypeScript file
     */
    function extractRpcCalls(content: string): string[] {
      const rpcPattern = /supabase\.rpc\s*\(\s*["']([^"']+)["']/g;
      const rpcs: string[] = [];
      let match;
      while ((match = rpcPattern.exec(content)) !== null) {
        rpcs.push(match[1]);
      }
      return [...new Set(rpcs)];
    }

    it("detects TypeScript code using wrong field names for SQL columns", () => {
      const issues: Array<{
        file: string;
        line: number;
        rpcFunction: string;
        usedField: string;
        sqlColumn: string | null;
        suggestion: string;
      }> = [];

      // Load SQL function definitions
      const sqlColumnsByFunction: Record<string, string[]> = {};

      if (fs.existsSync(sqlFunctionsDir)) {
        const sqlFiles = fs.readdirSync(sqlFunctionsDir).filter((f) => f.endsWith(".sql"));

        for (const sqlFile of sqlFiles) {
          const funcName = sqlFile.replace(/\.sql$/, "");
          const content = fs.readFileSync(path.join(sqlFunctionsDir, sqlFile), "utf-8");
          const columns = extractSqlReturnColumns(content);
          if (columns.length > 0) {
            sqlColumnsByFunction[funcName] = columns;
          }
        }
      }

      // Known problematic field mappings: wrongField -> correctField for specific RPC
      const FIELD_CORRECTIONS: Record<string, { wrongField: string; correctField: string }[]> = {
        get_audit_journal: [
          { wrongField: "action_type", correctField: "action" },
          { wrongField: "details", correctField: "metadata" },
        ],
        // Note: get_session_monitoring_data actually returns 'details' and 'action_type'
        // so those are NOT wrong in that context
      };

      // Scan TypeScript files
      const tsFiles = findTypeScriptFiles(srcDir, /\.(tsx?)$/);

      for (const file of tsFiles) {
        // Skip test files
        if (file.includes(".test.") || file.includes(".spec.")) continue;

        const content = fs.readFileSync(file, "utf-8");
        
        // Find which RPC functions this file calls
        const rpcsCalled = extractRpcCalls(content);
        
        // For each RPC, check if the file uses wrong field names
        for (const rpcName of rpcsCalled) {
          const corrections = FIELD_CORRECTIONS[rpcName];
          if (!corrections) continue;

          const sqlColumns = sqlColumnsByFunction[rpcName] || [];

          for (const { wrongField, correctField } of corrections) {
            // Check if SQL actually has the correct field and NOT the wrong one
            const hasCorrect = sqlColumns.includes(correctField);
            const hasWrong = sqlColumns.includes(wrongField);

            if (hasCorrect && !hasWrong) {
              // Look for usages of the wrong field in this file
              const pattern = new RegExp(`entry\\.${wrongField}\\b`, "g");
              let match;
              while ((match = pattern.exec(content)) !== null) {
                const upToMatch = content.slice(0, match.index);
                const lineNumber = upToMatch.split("\n").length;

                issues.push({
                  file: path.relative(srcDir, file),
                  line: lineNumber,
                  rpcFunction: rpcName,
                  usedField: wrongField,
                  sqlColumn: correctField,
                  suggestion: `Use "entry.${correctField}" instead of "entry.${wrongField}"`,
                });
              }
            }
          }
        }
      }

      // Report issues
      if (issues.length > 0) {
        const report = issues
          .map(
            (i) =>
              `  ${i.file}:${i.line}\n    RPC: ${i.rpcFunction}\n    Used: "${i.usedField}" → SQL column: "${i.sqlColumn}"\n    ${i.suggestion}`
          )
          .join("\n\n");

        expect.fail(
          `Found ${issues.length} SQL column/TypeScript field mismatch(es):\n\n${report}`
        );
      }

      expect(issues).toHaveLength(0);
    });
  });

  describe("Null coalescing anti-patterns", () => {
    const srcDir = path.resolve(__dirname, "../../../src");

    it("detects '=== null ? undefined :' which should be '?? undefined'", () => {
      const antiPatterns: Array<{
        file: string;
        line: number;
        code: string;
        suggestion: string;
      }> = [];

      const tsFiles = findTypeScriptFiles(srcDir, /\.(tsx?)$/);

      // Pattern: value === null ? undefined : value
      // Should be: value ?? undefined (when value can be null or undefined)
      const ANTI_PATTERN = /(\w+(?:\.\w+)*)\s*===\s*null\s*\?\s*undefined\s*:\s*\1/g;

      for (const file of tsFiles) {
        // Skip test files
        if (file.includes(".test.") || file.includes(".spec.")) continue;

        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n");

        let match;
        while ((match = ANTI_PATTERN.exec(content)) !== null) {
          const upToMatch = content.slice(0, match.index);
          const lineNumber = upToMatch.split("\n").length;

          antiPatterns.push({
            file: path.relative(srcDir, file),
            line: lineNumber,
            code: match[0].trim(),
            suggestion: `Use "${match[1]} ?? undefined" for cleaner null coalescing`,
          });
        }
      }

      // Report anti-patterns (as warnings, not failures - this is style)
      if (antiPatterns.length > 0) {
        const report = antiPatterns
          .map(
            (p) =>
              `  ${p.file}:${p.line}\n    Found: ${p.code}\n    Suggestion: ${p.suggestion}`
          )
          .join("\n\n");

        console.warn(
          `[Style] Found ${antiPatterns.length} null coalescing anti-pattern(s):\n\n${report}`
        );
      }

      // Note: Not failing on style issues, just reporting
      expect(true).toBe(true);
    });
  });

  describe("Object shorthand with wrong property names", () => {
    const srcDir = path.resolve(__dirname, "../../../src");

    it("detects object shorthand where key doesn't match expected schema field", () => {
      const issues: Array<{
        file: string;
        line: number;
        shorthandKey: string;
        context: string;
        possibleFix: string;
      }> = [];

      // Known mutations that expect snake_case
      const SNAKE_CASE_MUTATIONS = [
        { pattern: /\.mutate\(\s*\{\s*planId\s*\}/, expected: "plan_id" },
        { pattern: /\.mutate\(\s*\{\s*logId\s*\}/, expected: "log_id" },
        { pattern: /\.mutate\(\s*\{\s*stateId\s*\}/, expected: "state_id" },
        { pattern: /\.mutate\(\s*\{\s*productId\s*\}/, expected: "product_id" },
        { pattern: /\.mutate\(\s*\{\s*userId\s*\}/, expected: "user_id" },
      ];

      const tsFiles = findTypeScriptFiles(srcDir, /\.(tsx?)$/);

      for (const file of tsFiles) {
        // Skip test files
        if (file.includes(".test.") || file.includes(".spec.")) continue;

        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          for (const mutation of SNAKE_CASE_MUTATIONS) {
            if (mutation.pattern.test(line)) {
              // Extract the camelCase key
              const keyMatch = line.match(/\{\s*(\w+)\s*\}/);
              if (keyMatch) {
                const key = keyMatch[1];
                // Check if it's camelCase (has uppercase letter)
                if (/[A-Z]/.test(key)) {
                  issues.push({
                    file: path.relative(srcDir, file),
                    line: i + 1,
                    shorthandKey: key,
                    context: line.trim(),
                    possibleFix: `Use { ${mutation.expected}: ${key} } instead of { ${key} }`,
                  });
                }
              }
            }
          }
        }
      }

      // Report issues
      if (issues.length > 0) {
        const report = issues
          .map(
            (i) =>
              `  ${i.file}:${i.line}\n    Shorthand: { ${i.shorthandKey} }\n    Fix: ${i.possibleFix}`
          )
          .join("\n\n");

        expect.fail(
          `Found ${issues.length} object shorthand mismatch(es) (camelCase used where snake_case expected):\n\n${report}`
        );
      }

      expect(issues).toHaveLength(0);
    });
  });
});

describe("Type Safety Patterns", () => {
  describe("Generated types vs runtime usage", () => {
    const srcDir = path.resolve(__dirname, "../../../src");

    it("lists files using Database types with potential field access issues", () => {
      // This test documents files that access fields on Database-generated types
      // and could have mismatches if the DB schema changes

      const potentialIssues: Array<{
        file: string;
        usage: string;
      }> = [];

      const tsFiles = findTypeScriptFiles(srcDir, /\.(tsx?)$/);

      // Pattern: accessing .field on something from Database["public"]["Tables/Functions"]
      const TYPE_ACCESS_PATTERNS = [
        // Direct type casting with field access
        /as\s+\w+\)\.\w+/g,
        // Type annotation followed by field access
        /:\s*\w+\["\w+"\].*\.\w+/g,
      ];

      for (const file of tsFiles) {
        // Skip test files and type definition files
        if (
          file.includes(".test.") ||
          file.includes(".spec.") ||
          file.includes(".d.ts")
        )
          continue;

        const content = fs.readFileSync(file, "utf-8");

        // Check if file uses Database types
        if (!content.includes('Database["public"]')) continue;

        // Check for potential field access patterns
        for (const pattern of TYPE_ACCESS_PATTERNS) {
          const matches = content.match(pattern);
          if (matches) {
            potentialIssues.push({
              file: path.relative(srcDir, file),
              usage: matches.slice(0, 3).join(", ") + (matches.length > 3 ? "..." : ""),
            });
            break;
          }
        }
      }

      // Just log for awareness, don't fail
      if (potentialIssues.length > 0) {
        console.log(
          `[Info] ${potentialIssues.length} file(s) use Database types with field access patterns.`
        );
        console.log("These may need verification if DB schema changes:");
        potentialIssues.slice(0, 10).forEach((i) => {
          console.log(`  - ${i.file}`);
        });
      }

      expect(true).toBe(true);
    });
  });
});
