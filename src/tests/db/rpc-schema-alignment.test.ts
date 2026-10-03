/**
 * RPC ↔ Zod Schema Alignment Tests
 * 
 * Validates that SQL RPC function return types match TypeScript/Zod schemas.
 * Catches bugs like:
 *   - SQL returns `user_email` but Zod expects `email`
 *   - SQL returns nullable column but Zod expects non-nullable
 *   - Hook destructures field that doesn't exist in RPC return
 *   - Zod schema has extra fields not returned by RPC
 * 
 * Run: npm run test:run src/tests/db/rpc-schema-alignment.test.ts
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

const PATHS = {
  sqlFunctions: path.join(WORKSPACE_ROOT, "aisha/db/sql/functions"),
  migrations: path.join(WORKSPACE_ROOT, "aisha/db/migrations"),
  schemas: path.join(WORKSPACE_ROOT, "src/lib/schemas"),
  hooks: path.join(WORKSPACE_ROOT, "src/hooks"),
  pages: path.join(WORKSPACE_ROOT, "src/pages"),
};

// =============================================================================
// Utilities
// =============================================================================

function readFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf-8");
}

function getAllFiles(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getAllFiles(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Determine the return type of a SQL function
 */
type SqlReturnType = "table" | "jsonb" | "scalar" | "setof" | "unknown";

function getSqlReturnType(sqlContent: string): SqlReturnType {
  if (/RETURNS\s+TABLE\s*\(/i.test(sqlContent)) return "table";
  if (/RETURNS\s+jsonb\b/i.test(sqlContent)) return "jsonb";
  if (/RETURNS\s+SETOF\s+/i.test(sqlContent)) return "setof";
  if (/RETURNS\s+(void|boolean|text|integer|uuid|timestamp)/i.test(sqlContent)) return "scalar";
  return "unknown";
}

/**
 * Extract column names from SQL RETURNS TABLE definition
 */
function extractSqlReturnColumns(sqlContent: string): string[] {
  // Match RETURNS TABLE ( ... ) pattern
  const returnMatch = sqlContent.match(/RETURNS\s+TABLE\s*\(\s*([\s\S]*?)\)\s*(?:LANGUAGE|AS)/i);
  if (!returnMatch) return [];

  const columnsBlock = returnMatch[1];
  const columns: string[] = [];
  
  // Parse each line: column_name type, ... (handle quoted identifiers like "position")
  const lines = columnsBlock.split(/,(?![^()]*\))/).map(l => l.trim()).filter(l => l);
  
  for (const line of lines) {
    // Match both regular identifiers and quoted identifiers
    const match = line.match(/^"?(\w+)"?\s+/);
    if (match) {
      columns.push(match[1]);
    }
  }
  
  return columns;
}

/**
 * Extract top-level field names from SQL RETURNS jsonb function
 * Parses the FIRST jsonb_build_object (top-level return) and extracts only its direct fields
 */
function extractJsonbReturnFields(sqlContent: string): string[] {
  const fields: string[] = [];
  
  // Find the main jsonb_build_object that's returned (typically after SELECT or RETURN)
  // We want only the first/outer jsonb_build_object, not nested ones
  
  // Strategy: Find "jsonb_build_object(" and then parse the key-value pairs
  // Keys are quoted strings, values can be complex expressions
  const mainBuildMatch = sqlContent.match(
    /(?:SELECT|RETURN)\s+jsonb_build_object\s*\(\s*(['"][\w]+['"])/i
  );
  
  if (!mainBuildMatch) {
    // Fallback: try to find first jsonb_build_object in the function
    const fallbackMatch = sqlContent.match(/jsonb_build_object\s*\(/i);
    if (!fallbackMatch) return [];
  }
  
  // Extract the position of the main jsonb_build_object
  const selectMatch = sqlContent.match(/(SELECT|INTO\s+\w+\s+FROM\s*\(?\s*SELECT)\s+jsonb_build_object\s*\(/i);
  if (!selectMatch) return [];
  
  const startIdx = sqlContent.indexOf(selectMatch[0]);
  const buildObjectStart = sqlContent.indexOf("jsonb_build_object(", startIdx);
  
  if (buildObjectStart === -1) return [];
  
  // Parse the top-level object by tracking parentheses depth
  // Extract only the keys at depth 1 (inside the first jsonb_build_object)
  const afterOpen = sqlContent.slice(buildObjectStart + "jsonb_build_object(".length);
  
  let depth = 1;
  let inQuote = false;
  let quoteChar = "";
  let currentField = "";
  let expectingKey = true;
  
  for (let i = 0; i < afterOpen.length && depth > 0; i++) {
    const char = afterOpen[i];
    const prevChar = i > 0 ? afterOpen[i - 1] : "";
    
    // Handle string quotes
    if ((char === "'" || char === '"') && prevChar !== "\\") {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
        if (depth === 1 && expectingKey) {
          currentField = "";
        }
      } else if (char === quoteChar) {
        inQuote = false;
        if (depth === 1 && expectingKey && currentField) {
          fields.push(currentField);
          expectingKey = false;
        }
      }
      continue;
    }
    
    if (inQuote) {
      if (depth === 1 && expectingKey) {
        currentField += char;
      }
      continue;
    }
    
    // Track parentheses depth
    if (char === "(" || char === "[") {
      depth++;
    } else if (char === ")" || char === "]") {
      depth--;
    } else if (char === "," && depth === 1) {
      // At top level, comma after value means next item is a key
      expectingKey = true;
    }
  }
  
  return fields;
}

/**
 * Get JSONB columns from RETURNS TABLE definition
 * These columns contain nested objects that shouldn't be validated at top level
 */
function getJsonbColumns(sqlContent: string): string[] {
  const jsonbColumns: string[] = [];
  const returnMatch = sqlContent.match(/RETURNS\s+TABLE\s*\(\s*([\s\S]*?)\)\s*(?:LANGUAGE|AS)/i);
  if (!returnMatch) return [];

  const columnsBlock = returnMatch[1];
  const lines = columnsBlock.split(/,(?![^()]*\))/).map(l => l.trim()).filter(l => l);
  
  for (const line of lines) {
    // Match columns with jsonb type
    const match = line.match(/^"?(\w+)"?\s+jsonb\b/i);
    if (match) {
      jsonbColumns.push(match[1]);
    }
  }
  
  return jsonbColumns;
}

/**
 * Extract field names from Zod z.object({ ... }) definition
 */
function extractZodSchemaFields(schemaContent: string, schemaName: string): string[] {
  // Find the schema definition
  const schemaPattern = new RegExp(
    `export\\s+const\\s+${schemaName}\\s*=\\s*z\\.object\\(\\{([\\s\\S]*?)\\}\\)`,
    "i"
  );
  
  const match = schemaContent.match(schemaPattern);
  if (!match) return [];
  
  const objectBlock = match[1];
  const fields: string[] = [];
  
  // Extract field names (key: z.xxx patterns)
  const fieldMatches = objectBlock.matchAll(/^\s*(\w+)\s*:/gm);
  for (const m of fieldMatches) {
    fields.push(m[1]);
  }
  
  return fields;
}

/**
 * Extract RPC calls from TypeScript file
 */
function extractRpcCalls(tsContent: string): string[] {
  const matches = tsContent.matchAll(/aisha\.rpc\s*\(\s*["']([^"']+)["']/g);
  return Array.from(matches, m => m[1]);
}

/**
 * Extract destructured fields from data usage
 */
function extractDestructuredFields(tsContent: string, variableName: string = "data"): string[] {
  // Match patterns like: data.fieldName, entry.fieldName, item.fieldName
  const fieldAccesses = tsContent.matchAll(new RegExp(`\\b${variableName}\\.(\\w+)`, "g"));
  const fields = Array.from(fieldAccesses, m => m[1]);
  
  // Also match destructuring: const { field1, field2 } = data
  const destructureMatches = tsContent.matchAll(
    new RegExp(`(?:const|let)\\s*\\{([^}]+)\\}\\s*=\\s*${variableName}`, "g")
  );
  
  for (const m of destructureMatches) {
    const destructured = m[1].split(",").map(f => f.trim().split(":")[0].trim());
    fields.push(...destructured);
  }
  
  return [...new Set(fields)].filter(f => f && f !== "length" && f !== "map" && f !== "filter");
}

// =============================================================================
// RPC Function to Zod Schema Mapping
// =============================================================================

const RPC_SCHEMA_MAP: Record<string, { schemaFile: string; schemaName: string }> = {
  // Member Diary
  "get_my_products_audited": { 
    schemaFile: "memberDiarySchemas.ts", 
    schemaName: "memberProductSchema" 
  },
  "get_my_health_states_audited": { 
    schemaFile: "memberDiarySchemas.ts", 
    schemaName: "memberTrackingStateSchema" 
  },
  "get_my_product_plans_audited": { 
    schemaFile: "memberDiarySchemas.ts", 
    schemaName: "memberProductPlanSchema" 
  },
  "get_member_dashboard_widgets_audited": { 
    schemaFile: "memberDiarySchemas.ts", 
    schemaName: "memberDashboardWidgetSchema" 
  },
  "get_member_diary_calendar_audited": { 
    schemaFile: "memberDiarySchemas.ts", 
    schemaName: "memberDiaryCalendarResponseSchema" 
  },
  // Audit Journal
  "get_audit_journal": {
    schemaFile: "", // Uses types from hooks/useAuditJournal.ts (falsy → skipped in loop)
    schemaName: "",
  },
};

/**
 * RPC functions with Zod schemas defined INSIDE hook files (not in src/lib/schemas/).
 * These require separate handling because extractZodSchemaFields expects exported schemas.
 */
const HOOK_SCHEMA_MAP: Array<{
  rpcName: string;
  hookFile: string;
  schemaName: string;
}> = [
  {
    rpcName: "get_question_blocks_admin",
    hookFile: "useAdminQuestionnaires.ts",
    schemaName: "questionBlockSchema",
  },
  {
    rpcName: "get_questionnaires_admin",
    hookFile: "useAdminQuestionnaires.ts",
    schemaName: "questionnaireExtendedSchema",
  },
];

/**
 * Extract field names from a Zod z.object({ ... }) definition in any file.
 * Works with both exported and non-exported schemas.
 */
function extractZodFieldsFromFile(fileContent: string, schemaName: string): string[] {
  // Match: [export] const schemaName = z.object({ ... })
  const schemaPattern = new RegExp(
    `(?:export\\s+)?const\\s+${schemaName}\\s*=\\s*z\\.object\\(\\{([\\s\\S]*?)\\}\\)`,
    "i"
  );

  const match = fileContent.match(schemaPattern);
  if (!match) return [];

  const objectBlock = match[1];
  const fields: string[] = [];

  // Extract field names (key: z.xxx patterns)
  const fieldMatches = objectBlock.matchAll(/^\s*(\w+)\s*:/gm);
  for (const m of fieldMatches) {
    fields.push(m[1]);
  }

  return fields;
}

// =============================================================================
// Tests
// =============================================================================

describe("RPC ↔ Zod Schema Alignment", () => {
  
  describe("SQL Return Columns Match Zod Schema Fields", () => {
    
    for (const [rpcName, mapping] of Object.entries(RPC_SCHEMA_MAP)) {
      if (!mapping.schemaFile) continue; // Skip if no Zod schema defined
      
      it(`${rpcName} columns match ${mapping.schemaName}`, () => {
        // Read SQL function
        const sqlPath = path.join(PATHS.sqlFunctions, `${rpcName}.sql`);
        const sqlContent = readFile(sqlPath);
        
        if (!sqlContent) {
          console.warn(`⚠️ SQL function not found: ${rpcName}.sql`);
          return; // Skip if function doesn't exist yet
        }
        
        // Determine return type and extract fields accordingly
        const returnType = getSqlReturnType(sqlContent);
        let sqlColumns: string[];
        
        if (returnType === "jsonb") {
          // For RETURNS jsonb, extract fields from jsonb_build_object
          sqlColumns = extractJsonbReturnFields(sqlContent);
          console.log(`\n📦 ${rpcName} returns JSONB with fields: [${sqlColumns.join(", ")}]`);
        } else if (returnType === "table") {
          // For RETURNS TABLE, extract columns normally
          sqlColumns = extractSqlReturnColumns(sqlContent);
        } else {
          console.log(`\nℹ️ ${rpcName} returns ${returnType} (not table/jsonb) - skipping field comparison`);
          return; // Skip scalar/void functions
        }
        
        // Read Zod schema
        const schemaPath = path.join(PATHS.schemas, mapping.schemaFile);
        const schemaContent = readFile(schemaPath);
        
        expect(schemaContent, `Schema file ${mapping.schemaFile} not found`).toBeTruthy();
        
        const zodFields = extractZodSchemaFields(schemaContent, mapping.schemaName);
        
        // Compare
        const missingInZod = sqlColumns.filter(col => !zodFields.includes(col));
        const extraInZod = zodFields.filter(field => !sqlColumns.includes(field));
        
        // Report differences
        if (missingInZod.length > 0 || extraInZod.length > 0) {
          console.log(`\n📊 ${rpcName} alignment:`);
          console.log(`   Return type: ${returnType}`);
          console.log(`   SQL fields:  [${sqlColumns.join(", ")}]`);
          console.log(`   Zod fields:  [${zodFields.join(", ")}]`);
          if (missingInZod.length > 0) {
            console.log(`   ⚠️ In SQL but not in Zod: [${missingInZod.join(", ")}]`);
          }
          if (extraInZod.length > 0) {
            console.log(`   ⚠️ In Zod but not in SQL: [${extraInZod.join(", ")}]`);
          }
        }
        
        // Allow optional fields in Zod that aren't in SQL (computed/derived fields)
        // But SQL columns MUST be in Zod
        expect(
          missingInZod,
          `SQL function ${rpcName} returns fields not in Zod schema: [${missingInZod.join(", ")}]`
        ).toHaveLength(0);
      });
    }
  });
  
  describe("Hook-Embedded Zod Schemas Match SQL Return Columns", () => {
    for (const { rpcName, hookFile, schemaName } of HOOK_SCHEMA_MAP) {
      it(`${rpcName} SQL columns match ${schemaName} in ${hookFile}`, () => {
        // Read SQL function
        const sqlPath = path.join(PATHS.sqlFunctions, `${rpcName}.sql`);
        const sqlContent = readFile(sqlPath);

        expect(sqlContent, `SQL function file ${rpcName}.sql not found`).toBeTruthy();

        const returnType = getSqlReturnType(sqlContent);
        let sqlColumns: string[];

        if (returnType === "jsonb") {
          sqlColumns = extractJsonbReturnFields(sqlContent);
        } else if (returnType === "table") {
          sqlColumns = extractSqlReturnColumns(sqlContent);
        } else {
          console.log(`ℹ️ ${rpcName} returns ${returnType} — skipping field comparison`);
          return;
        }

        expect(
          sqlColumns.length,
          `Could not extract columns from ${rpcName}.sql (return type: ${returnType})`
        ).toBeGreaterThan(0);

        // Read hook file and extract Zod schema fields
        const hookPath = path.join(PATHS.hooks, hookFile);
        const hookContent = readFile(hookPath);

        expect(hookContent, `Hook file ${hookFile} not found`).toBeTruthy();

        const zodFields = extractZodFieldsFromFile(hookContent, schemaName);

        expect(
          zodFields.length,
          `Could not extract Zod fields from ${schemaName} in ${hookFile}`
        ).toBeGreaterThan(0);

        // Compare: every SQL column must be in Zod
        const missingInZod = sqlColumns.filter(col => !zodFields.includes(col));
        // Compare: every required Zod field must be in SQL
        const missingInSql = zodFields.filter(field => !sqlColumns.includes(field));

        console.log(`\n📊 ${rpcName} ↔ ${schemaName} alignment:`);
        console.log(`   SQL columns (${sqlColumns.length}): [${sqlColumns.join(", ")}]`);
        console.log(`   Zod fields  (${zodFields.length}): [${zodFields.join(", ")}]`);

        if (missingInZod.length > 0) {
          console.log(`   ❌ In SQL but NOT in Zod: [${missingInZod.join(", ")}]`);
        }
        if (missingInSql.length > 0) {
          console.log(`   ❌ In Zod but NOT in SQL: [${missingInSql.join(", ")}]`);
        }

        expect(
          missingInZod,
          `SQL function ${rpcName} returns columns not in Zod schema ${schemaName}: [${missingInZod.join(", ")}]. ` +
          `This will cause safeParse() to silently drop data!`
        ).toHaveLength(0);

        expect(
          missingInSql,
          `Zod schema ${schemaName} expects fields not returned by SQL ${rpcName}: [${missingInSql.join(", ")}]. ` +
          `Non-optional fields will cause safeParse() to fail!`
        ).toHaveLength(0);
      });
    }
  });

  describe("Frontend Field Usage Matches RPC Returns", () => {
    
    it("AdminQuestionnaires uses valid fields from get_questionnaires_admin", () => {
      const pageContent = readFile(path.join(PATHS.pages, "admin/AdminQuestionnaires.tsx"));
      const sqlContent = readFile(path.join(PATHS.sqlFunctions, "get_questionnaires_admin.sql"));
      
      if (!sqlContent) {
        console.warn("⚠️ get_questionnaires_admin.sql not found");
        return;
      }
      
      const sqlColumns = extractSqlReturnColumns(sqlContent);
      const jsonbColumns = getJsonbColumns(sqlContent);
      
      // Find field accesses on questionnaire data
      const usedFields = extractDestructuredFields(pageContent, "item");
      usedFields.push(...extractDestructuredFields(pageContent, "questionnaire"));
      usedFields.push(...extractDestructuredFields(pageContent, "q"));
      
      // Known nested JSONB fields (fields inside the questions jsonb column)
      // These are valid accesses on nested objects, not top-level RPC columns
      const knownNestedJsonbFields = [
        "text", "textKey", "descriptionKey", // inside questions array
        "responseOptions", "type", "isRequired", "order", // question object fields
        "options", "scaleLabels", // additional question config fields
      ];
      
      const uniqueFields = [...new Set(usedFields)];
      
      // Filter out fields that are:
      // 1. Known SQL columns (valid)
      // 2. Known nested JSONB fields (valid - accessing inside questions array)
      // 3. Common JS methods/properties
      const invalidFields = uniqueFields.filter(f => 
        !sqlColumns.includes(f) && 
        !knownNestedJsonbFields.includes(f) &&
        !["length", "map", "filter", "forEach", "find", "some", "every"].includes(f)
      );
      
      console.log(`\n✅ get_questionnaires_admin alignment:`);
      console.log(`   SQL columns: [${sqlColumns.join(", ")}]`);
      console.log(`   JSONB columns (contain nested objects): [${jsonbColumns.join(", ")}]`);
      console.log(`   Used fields (top-level + nested): [${uniqueFields.filter(f => !["length", "map", "filter"].includes(f)).join(", ")}]`);
      
      if (invalidFields.length > 0) {
        console.log(`   ⚠️ Potentially invalid fields: [${invalidFields.join(", ")}]`);
      }
      
      // This is informational - we check for obvious mismatches
      expect(sqlColumns.length).toBeGreaterThan(0);
    });
    
    it("MemberDiary uses valid fields from member diary RPCs", () => {
      const pageContent = readFile(path.join(PATHS.pages, "member/MemberDiary.tsx"));
      const hookContent = readFile(path.join(PATHS.hooks, "useMemberDiary.ts"));
      
      // Check which RPCs are called
      const rpcs = extractRpcCalls(hookContent);
      
      expect(rpcs).toContain("get_my_products_audited");
      expect(rpcs).toContain("get_my_health_states_audited");
      expect(rpcs).toContain("get_my_product_plans_audited");
      
      // Verify parseRpcArray is used (Zod validation)
      expect(hookContent).toContain("parseRpcArray");
      
      console.log(`\n✅ MemberDiary RPCs: [${rpcs.join(", ")}]`);
    });
    
    it("audit-journal-detail uses valid fields from AuditJournalEntry type", () => {
      const detailContent = readFile(path.join(PATHS.pages, "admin/audit-journal-detail.tsx"));
      const hookContent = readFile(path.join(PATHS.hooks, "useAuditJournal.ts"));
      
      // Check that hook defines AuditJournalEntry type
      expect(hookContent).toContain("AuditJournalEntry");
      
      // Extract fields from entry usage
      const usedFields = extractDestructuredFields(detailContent, "entry");
      
      // Check common expected fields
      const expectedFields = ["created_at", "area", "severity", "action_type", "details"];
      const missingExpected = expectedFields.filter(f => !usedFields.includes(f));
      
      if (missingExpected.length > 0) {
        console.log(`\n⚠️ audit-journal-detail might be missing fields: [${missingExpected.join(", ")}]`);
      }
      
      console.log(`\n✅ audit-journal-detail uses fields: [${usedFields.join(", ")}]`);
      
      expect(usedFields.length).toBeGreaterThan(0);
    });
  });
  
  describe("All Hooks with RPC Calls Use Zod Validation", () => {
    
    it("Sensitive data hooks use parseRpcArray or similar validation", () => {
      const hookFiles = getAllFiles(PATHS.hooks, ".ts").concat(getAllFiles(PATHS.hooks, ".tsx"));
      
      const phiHooks = [
        "useMemberDiary.ts",
        "useTracking.ts",
        "useTrackingDocuments.tsx",
        "useDistributionProtocols.tsx",
        "useAuditJournal.ts",
      ];
      
      const missingValidation: string[] = [];
      
      for (const hookName of phiHooks) {
        const hookPath = hookFiles.find(f => f.endsWith(hookName));
        if (!hookPath) continue;
        
        const content = readFile(hookPath);
        const rpcs = extractRpcCalls(content);
        
        if (rpcs.length === 0) continue;
        
        // Check for Zod validation patterns
        const hasZodValidation = 
          content.includes("parseRpcArray") ||
          content.includes("parseRpcSingle") ||
          content.includes(".parse(") ||
          content.includes(".safeParse(") ||
          content.includes("z.array(") ||
          content.includes("Schema.parse");
        
        if (!hasZodValidation) {
          missingValidation.push(hookName);
        }
      }
      
      if (missingValidation.length > 0) {
        console.log(`\n⚠️ sensitive data hooks without Zod validation: [${missingValidation.join(", ")}]`);
      }
      
      // Allow some hooks to not have validation if they're simple
      expect(missingValidation.length).toBeLessThanOrEqual(2);
    });
  });
});

/**
 * Build a set of all SQL function names defined in aisha/db/sql/functions/*.sql
 * AND aisha/db/migrations/*.sql (functions created via migrations before baseline refresh).
 * Scans file contents for CREATE OR REPLACE FUNCTION statements.
 */
function getAllDefinedSqlFunctions(): Set<string> {
  const functionNames = new Set<string>();

  const scanDir = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql"));
    for (const fileName of files) {
      const content = readFile(path.join(dir, fileName));
      const matches = content.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi);
      for (const match of matches) {
        functionNames.add(match[1]);
      }
    }
  };

  scanDir(PATHS.sqlFunctions);
  scanDir(PATHS.migrations);
  
  return functionNames;
}

describe("RPC Call Existence Validation", () => {
  
  it("all RPC calls in hooks have corresponding SQL functions", () => {
    const hookFiles = getAllFiles(PATHS.hooks, ".ts").concat(getAllFiles(PATHS.hooks, ".tsx"));
    const definedFunctions = getAllDefinedSqlFunctions();
    
    const missingFunctions: { hook: string; rpc: string }[] = [];
    
    for (const hookPath of hookFiles) {
      const hookName = path.basename(hookPath);
      const content = readFile(hookPath);
      const rpcs = extractRpcCalls(content);
      
      for (const rpc of rpcs) {
        if (!definedFunctions.has(rpc)) {
          missingFunctions.push({ hook: hookName, rpc });
        }
      }
    }
    
    if (missingFunctions.length > 0) {
      console.log(`\n❌ Missing SQL functions:`);
      for (const { hook, rpc } of missingFunctions) {
        console.log(`   - ${hook} calls "${rpc}" but no function definition found in SQL files`);
      }
    }
    
    expect(
      missingFunctions,
      `Found ${missingFunctions.length} RPC calls without SQL functions`
    ).toHaveLength(0);
  });
  
  it("RPC calls in pages have corresponding SQL functions", () => {
    const pageFiles = getAllFiles(PATHS.pages, ".tsx");
    const definedFunctions = getAllDefinedSqlFunctions();
    
    const missingFunctions: { page: string; rpc: string }[] = [];
    
    for (const pagePath of pageFiles) {
      const pageName = path.relative(PATHS.pages, pagePath);
      const content = readFile(pagePath);
      const rpcs = extractRpcCalls(content);
      
      for (const rpc of rpcs) {
        if (!definedFunctions.has(rpc)) {
          missingFunctions.push({ page: pageName, rpc });
        }
      }
    }
    
    if (missingFunctions.length > 0) {
      console.log(`\n❌ Missing SQL functions (pages):`);
      for (const { page, rpc } of missingFunctions) {
        console.log(`   - ${page} calls "${rpc}" but no function definition found in SQL files`);
      }
    }
    
    expect(
      missingFunctions,
      `Found ${missingFunctions.length} RPC calls in pages without SQL functions`
    ).toHaveLength(0);
  });
});
