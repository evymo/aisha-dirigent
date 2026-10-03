/**
 * SQL Function Column Validation Tests
 *
 * Cross-references column names used in SQL functions (INSERT, UPDATE, ON CONFLICT)
 * against actual table column definitions from source-of-truth table SQL files.
 *
 * Catches bugs like the set_api_key_admin issue where function referenced
 * `key_name` / `key_value` but table has `key` / `value`.
 *
 * @module
 */

import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { getReportDir, getReportPath } from "../helpers/reportPaths";

const ROOT_DIR = path.resolve(__dirname, "../../..");
const SQL_DIR = path.join(ROOT_DIR, "aisha/db/sql");
const TABLES_DIR = path.join(SQL_DIR, "tables");
const FUNCTIONS_DIR = path.join(SQL_DIR, "functions");
const REPORT_DIR = getReportDir();
const REPORT_PATH = getReportPath("sql-column-validation-report.json");

// ─── Report collector ───────────────────────────────────────────────────────

interface ColumnValidationIssue {
  category: "INSERT" | "UPDATE" | "ON_CONFLICT";
  severity: "error" | "warning" | "info";
  type: string;
  entity: string;
  message: string;
  functionFile: string;
  tableName: string;
  column: string;
  line: number;
}

const reportIssues: ColumnValidationIssue[] = [];
const reportCoverage = {
  tablesParsed: 0,
  functionsScanned: 0,
  insert: { total: 0, validated: 0 },
  update: { total: 0, validated: 0 },
  onConflict: { total: 0, validated: 0 },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse a table SQL file and extract column names from its FULL definition —
 * the CREATE TABLE block PLUS any trailing `ALTER TABLE ... ADD COLUMN`
 * statements. The latter is an established SoT convention (migration-added
 * columns are appended as idempotent ALTERs rather than edited into the
 * original CREATE), so a column that exists only in an ALTER is just as real
 * as one in the CREATE. Reading only CREATE would falsely flag valid INSERTs
 * into ALTER-added columns; reading both still catches genuine phantom columns
 * (present in neither CREATE nor ALTER nor the deployed schema).
 */
function extractTableColumns(sqlContent: string): string[] {
  // Strip line comments BEFORE any structural matching — PostgreSQL's lexer
  // does, and not doing so bit this suite the same way it bit the
  // duplicate-columns gate on the same day (2026-07-26): a doc comment reading
  // "…(visible to every\n-- instance);" contains `);`, which terminated the
  // non-greedy CREATE TABLE body match mid-table, so every column declared
  // after that comment was reported as nonexistent while the real database
  // accepted the INSERT just fine.
  sqlContent = sqlContent.replace(/--.*$/gm, "");

  const columns: string[] = [];

  // Trailing `ALTER TABLE [ONLY] [public.]<t> ADD COLUMN [IF NOT EXISTS] <col>`
  // statements contribute columns regardless of the CREATE TABLE block.
  const alterAddColRegex =
    /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?\w+\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
  let alterMatch;
  while ((alterMatch = alterAddColRegex.exec(sqlContent)) !== null) {
    columns.push(alterMatch[1].toLowerCase());
  }

  // Match CREATE TABLE ... ( ... ) block
  const createMatch = sqlContent.match(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\);/i
  );
  if (!createMatch) return columns;

  const body = createMatch[2];
  const lines = body.split("\n");

  // SQL keywords / constraints that start lines but are NOT column names
  const nonColumnKeywords = new Set([
    "primary", "unique", "check", "constraint", "foreign", "exclude",
    "references", "index", "using", "with", "where", "grant", "revoke",
    "create", "alter", "drop", "comment", "if", "on", "for", "to",
  ]);

  for (const line of lines) {
    const trimmed = line.trim().replace(/,\s*$/, "");

    // Skip empty lines, comments, closing paren
    if (!trimmed || trimmed.startsWith("--") || trimmed === ")") continue;

    // Skip constraint-only lines
    if (/^\s*(PRIMARY\s+KEY|UNIQUE|CHECK|CONSTRAINT|FOREIGN\s+KEY|EXCLUDE)\b/i.test(trimmed)) continue;

    // Get first word — must look like a column identifier
    const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
    if (nonColumnKeywords.has(firstWord)) continue;

    // Must be a valid identifier and followed by something (type name)
    // Column def: identifier type [constraints...]
    if (/^\w+$/.test(firstWord) && firstWord.length > 1 && trimmed.split(/\s+/).length >= 2) {
      columns.push(firstWord);
    }
  }

  return columns;
}

/**
 * Build a map of table_name → Set<column_name> from all table SQL files.
 */
function buildTableColumnMap(): Map<string, Set<string>> {
  const tableMap = new Map<string, Set<string>>();

  if (!fs.existsSync(TABLES_DIR)) return tableMap;

  const files = fs.readdirSync(TABLES_DIR).filter((f) => f.endsWith(".sql"));

  for (const file of files) {
    const tableName = file.replace(".sql", "").toLowerCase();
    const content = fs.readFileSync(path.join(TABLES_DIR, file), "utf-8");

    const cols = extractTableColumns(content);

    if (cols.length > 0) {
      tableMap.set(tableName, new Set(cols));
    }
  }

  return tableMap;
}

interface ColumnReference {
  functionFile: string;
  tableName: string;
  columns: string[];
  statement: "INSERT" | "UPDATE" | "ON_CONFLICT";
  line: number;
  rawMatch: string;
}

/**
 * Extract INSERT INTO table (col1, col2, ...) references from a SQL function file.
 */
function extractInsertColumns(content: string, fileName: string): ColumnReference[] {
  const refs: ColumnReference[] = [];

  // INSERT INTO [public.]table_name (col1, col2, ...)
  const insertRegex = /INSERT\s+INTO\s+(?:public\.)?(\w+)\s*\(([^)]+)\)/gi;
  let match;

  while ((match = insertRegex.exec(content)) !== null) {
    const tableName = match[1].toLowerCase();
    const columnsStr = match[2];

    // Skip if table is a subquery or keyword
    if (["select", "values", "returning", "with"].includes(tableName)) continue;

    const columns = columnsStr
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter((c) => c.length > 0 && /^\w+$/.test(c));

    if (columns.length > 0) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      refs.push({
        functionFile: fileName,
        tableName,
        columns,
        statement: "INSERT",
        line: lineNum,
        rawMatch: match[0].substring(0, 120),
      });
    }
  }

  return refs;
}

/**
 * Extract UPDATE table SET col = ..., col = ... references from a SQL function file.
 * Filters out function parameter/variable prefixes (p_, v_) which appear on
 * the RHS of assignments in CASE/WHEN expressions.
 */
function extractUpdateColumns(content: string, fileName: string): ColumnReference[] {
  const refs: ColumnReference[] = [];

  // UPDATE [public.]table_name SET col1 = ..., col2 = ...
  const updateRegex = /UPDATE\s+(?:public\.)?(\w+)\s+SET\s+([\s\S]*?)(?:WHERE|RETURNING|;|\))/gi;
  let match;

  while ((match = updateRegex.exec(content)) !== null) {
    const tableName = match[1].toLowerCase();
    const setClause = match[2];

    if (["select", "values", "returning"].includes(tableName)) continue;

    // Extract column = value pairs line by line from the SET clause.
    // Only the first identifier before "=" on each line/comma-separated segment
    // is a column name. Inner CASE expressions may have false "x = y" matches.
    const columns: string[] = [];
    const setLines = setClause.split(",");

    for (const segment of setLines) {
      const trimmed = segment.trim();
      // Match the first identifier before "=" in this SET segment
      const colMatch = trimmed.match(/^(\w+)\s*=/);
      if (!colMatch) continue;
      const col = colMatch[1].toLowerCase();

      // Skip SQL keywords, EXCLUDED references, and function variables (p_, v_ prefix)
      if (["excluded", "new", "old", "case", "when", "then", "else", "end",
           "true", "false", "null", "not", "and", "or", "is", "in",
           "coalesce", "now"].includes(col)) continue;
      if (/^(p|v)_/.test(col)) continue;

      columns.push(col);
    }

    if (columns.length > 0) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      refs.push({
        functionFile: fileName,
        tableName,
        columns,
        statement: "UPDATE",
        line: lineNum,
        rawMatch: match[0].substring(0, 120),
      });
    }
  }

  return refs;
}

/**
 * Extract ON CONFLICT (col1, col2) references from a SQL function file.
 * Uses the NEAREST preceding INSERT to determine the target table,
 * avoiding misattribution when multiple INSERTs exist in one function.
 */
function extractOnConflictColumns(content: string, fileName: string): ColumnReference[] {
  const refs: ColumnReference[] = [];

  // Find each ON CONFLICT separately, then look back for the nearest INSERT
  const conflictRegex = /ON\s+CONFLICT\s*\(([^)]+)\)/gi;
  let match;

  while ((match = conflictRegex.exec(content)) !== null) {
    const columnsStr = match[1];
    const textBefore = content.substring(0, match.index);

    // Find the LAST INSERT INTO before this ON CONFLICT
    const insertMatches = [...textBefore.matchAll(/INSERT\s+INTO\s+(?:public\.)?(\w+)/gi)];
    if (insertMatches.length === 0) continue;

    const lastInsert = insertMatches[insertMatches.length - 1];
    const tableName = lastInsert[1].toLowerCase();

    // Skip if table is a subquery or keyword
    if (["select", "values", "returning", "with"].includes(tableName)) continue;

    const columns = columnsStr
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter((c) => c.length > 0 && /^\w+$/.test(c));

    if (columns.length > 0) {
      const lineNum = content.substring(0, match.index).split("\n").length;
      refs.push({
        functionFile: fileName,
        tableName,
        columns,
        statement: "ON_CONFLICT",
        line: lineNum,
        rawMatch: `ON CONFLICT (${columnsStr.trim()})`,
      });
    }
  }

  return refs;
}

// ─── Known exceptions ───────────────────────────────────────────────────────

/**
 * System/built-in tables that don't have source-of-truth SQL files.
 * Column validation is skipped for these.
 */
const SYSTEM_TABLES = new Set([
  // Supabase internal
  "users", "identities", "sessions", "refresh_tokens", "mfa_factors",
  "mfa_challenges", "mfa_amr_claims", "sso_providers", "sso_domains",
  "saml_providers", "saml_relay_states", "flow_state",
  // Schema-qualified references parsed without schema
  "auth", "storage", "vault", "supabase_migrations",
  // Storage
  "buckets", "objects", "s3_multipart_uploads", "s3_multipart_uploads_parts",
  // Vault
  "secrets", "decrypted_secrets",
  // Realtime
  "messages", "subscription",
  // pg_* catalog
  "pg_proc", "pg_namespace", "pg_class", "pg_attribute", "pg_type",
  "pg_enum", "pg_policies", "pg_indexes",
  // Supabase migrations
  "schema_migrations", "seed_files",
]);

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("SQL Function Column Validation", () => {
  const tableMap = buildTableColumnMap();
  const functionFiles = fs.existsSync(FUNCTIONS_DIR)
    ? fs.readdirSync(FUNCTIONS_DIR).filter((f) => f.endsWith(".sql"))
    : [];

  // Write report after all tests complete
  afterAll(() => {
    reportCoverage.tablesParsed = tableMap.size;
    reportCoverage.functionsScanned = functionFiles.length;

    const errorCount = reportIssues.filter((i) => i.severity === "error").length;
    const warningCount = reportIssues.filter((i) => i.severity === "warning").length;
    const infoCount = reportIssues.filter((i) => i.severity === "info").length;

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        ...reportCoverage,
        violations: { error: errorCount, warning: warningCount, info: infoCount, total: reportIssues.length },
      },
      issues: reportIssues,
    };

    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log(`\n📄 Column validation report: ${REPORT_PATH}`);
  });

  it("should have parsed at least 50 tables", () => {
    expect(tableMap.size).toBeGreaterThan(50);
  });

  it("should have found function files", () => {
    expect(functionFiles.length).toBeGreaterThan(100);
  });

  it("INSERT columns should match table definitions", () => {
    const errors: string[] = [];

    for (const file of functionFiles) {
      const content = fs.readFileSync(path.join(FUNCTIONS_DIR, file), "utf-8");
      const refs = extractInsertColumns(content, file);

      for (const ref of refs) {
        if (SYSTEM_TABLES.has(ref.tableName)) continue;

        const tableCols = tableMap.get(ref.tableName);
        if (!tableCols) {
          // Table not found in source of truth — skip (covered by db-dependencies-validation)
          continue;
        }

        for (const col of ref.columns) {
          if (!tableCols.has(col)) {
            const msg = `${ref.functionFile}:${ref.line} — INSERT INTO ${ref.tableName}: ` +
              `column '${col}' does not exist in table definition. ` +
              `Available: [${[...tableCols].sort().join(", ")}]`;
            errors.push(msg);
            reportIssues.push({
              category: "INSERT",
              severity: "error",
              type: "COLUMN_MISMATCH",
              entity: `${ref.tableName}.${col}`,
              message: msg,
              functionFile: ref.functionFile,
              tableName: ref.tableName,
              column: col,
              line: ref.line,
            });
          }
        }
      }
    }

    expect(
      errors,
      `Found ${errors.length} column mismatch(es) in INSERT statements:\n\n${errors.join("\n\n")}`
    ).toHaveLength(0);
  });

  it("ON CONFLICT columns should match table definitions", () => {
    const errors: string[] = [];

    for (const file of functionFiles) {
      const content = fs.readFileSync(path.join(FUNCTIONS_DIR, file), "utf-8");
      const refs = extractOnConflictColumns(content, file);

      for (const ref of refs) {
        if (SYSTEM_TABLES.has(ref.tableName)) continue;

        const tableCols = tableMap.get(ref.tableName);
        if (!tableCols) continue;

        for (const col of ref.columns) {
          if (!tableCols.has(col)) {
            const msg = `${ref.functionFile}:${ref.line} — ON CONFLICT for ${ref.tableName}: ` +
              `column '${col}' does not exist. ` +
              `Available: [${[...tableCols].sort().join(", ")}]`;
            errors.push(msg);
            reportIssues.push({
              category: "ON_CONFLICT",
              severity: "error",
              type: "COLUMN_MISMATCH",
              entity: `${ref.tableName}.${col}`,
              message: msg,
              functionFile: ref.functionFile,
              tableName: ref.tableName,
              column: col,
              line: ref.line,
            });
          }
        }
      }
    }

    expect(
      errors,
      `Found ${errors.length} column mismatch(es) in ON CONFLICT clauses:\n\n${errors.join("\n\n")}`
    ).toHaveLength(0);
  });

  it("UPDATE SET columns should match table definitions", () => {
    const errors: string[] = [];

    for (const file of functionFiles) {
      const content = fs.readFileSync(path.join(FUNCTIONS_DIR, file), "utf-8");
      const refs = extractUpdateColumns(content, file);

      for (const ref of refs) {
        if (SYSTEM_TABLES.has(ref.tableName)) continue;

        const tableCols = tableMap.get(ref.tableName);
        if (!tableCols) continue;

        for (const col of ref.columns) {
          if (!tableCols.has(col)) {
            const msg = `${ref.functionFile}:${ref.line} — UPDATE ${ref.tableName} SET: ` +
              `column '${col}' does not exist. ` +
              `Available: [${[...tableCols].sort().join(", ")}]`;
            errors.push(msg);
            reportIssues.push({
              category: "UPDATE",
              severity: "error",
              type: "COLUMN_MISMATCH",
              entity: `${ref.tableName}.${col}`,
              message: msg,
              functionFile: ref.functionFile,
              tableName: ref.tableName,
              column: col,
              line: ref.line,
            });
          }
        }
      }
    }

    expect(
      errors,
      `Found ${errors.length} column mismatch(es) in UPDATE statements:\n\n${errors.join("\n\n")}`
    ).toHaveLength(0);
  });

  it("should provide comprehensive coverage stats", () => {
    let totalInserts = 0;
    let totalUpdates = 0;
    let totalConflicts = 0;
    let checkedInserts = 0;
    let checkedUpdates = 0;
    let checkedConflicts = 0;

    for (const file of functionFiles) {
      const content = fs.readFileSync(path.join(FUNCTIONS_DIR, file), "utf-8");

      const inserts = extractInsertColumns(content, file);
      const updates = extractUpdateColumns(content, file);
      const conflicts = extractOnConflictColumns(content, file);

      totalInserts += inserts.length;
      totalUpdates += updates.length;
      totalConflicts += conflicts.length;

      checkedInserts += inserts.filter(
        (r) => !SYSTEM_TABLES.has(r.tableName) && tableMap.has(r.tableName)
      ).length;
      checkedUpdates += updates.filter(
        (r) => !SYSTEM_TABLES.has(r.tableName) && tableMap.has(r.tableName)
      ).length;
      checkedConflicts += conflicts.filter(
        (r) => !SYSTEM_TABLES.has(r.tableName) && tableMap.has(r.tableName)
      ).length;
    }

    // Populate report coverage
    reportCoverage.insert = { total: totalInserts, validated: checkedInserts };
    reportCoverage.update = { total: totalUpdates, validated: checkedUpdates };
    reportCoverage.onConflict = { total: totalConflicts, validated: checkedConflicts };

    // Log stats for visibility
    console.log(`\n📊 SQL Column Validation Coverage:`);
    console.log(`   Tables parsed: ${tableMap.size}`);
    console.log(`   Functions scanned: ${functionFiles.length}`);
    console.log(`   INSERT statements: ${checkedInserts}/${totalInserts} validated`);
    console.log(`   UPDATE statements: ${checkedUpdates}/${totalUpdates} validated`);
    console.log(`   ON CONFLICT clauses: ${checkedConflicts}/${totalConflicts} validated`);

    // Ensure we're actually checking a meaningful number
    expect(checkedInserts).toBeGreaterThan(50);
  });
});
