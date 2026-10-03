/**
 * SQL Source Separation Test
 *
 * Validates that each SQL object type (tables, indexes, triggers, policies, functions, enums)
 * is defined in the correct location and not embedded in other file types.
 *
 * Source of Truth structure:
 * - aisha/db/sql/tables/*.sql      → CREATE TABLE only
 * - aisha/db/sql/indexes/*.sql     → CREATE INDEX only
 * - aisha/db/sql/triggers/*.sql    → CREATE TRIGGER only
 * - aisha/db/sql/policies/*.sql    → CREATE POLICY only
 * - aisha/db/sql/functions/*.sql   → CREATE FUNCTION only
 * - aisha/db/sql/enums/*.sql       → CREATE TYPE ... AS ENUM only
 * - aisha/db/sql/views/*.sql       → CREATE VIEW only
 */

import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { getReportDir, getReportPath } from "../helpers/reportPaths";

const SQL_SOURCE_DIR = path.join(process.cwd(), "aisha/db/sql");
const MIGRATIONS_DIR = path.join(process.cwd(), "aisha/db/migrations");
const REPORT_DIR = getReportDir();
const REPORT_PATH = getReportPath("sql-source-separation-report.json");

// ─── Report collector ───────────────────────────────────────────────────────

interface SeparationIssue {
  category: string;
  severity: "error" | "warning" | "info";
  type: string;
  entity: string;
  message: string;
}

const reportIssues: SeparationIssue[] = [];
const reportStats = {
  tableFiles: 0,
  indexFiles: 0,
  triggerFiles: 0,
  policyFiles: 0,
  functionFiles: 0,
  enumFiles: 0,
  viewFiles: 0,
  migrations: 0,
  registeredMigrations: 0,
};

/**
 * Read all SQL files from a directory
 */
function readSqlFiles(dir: string): { name: string; content: string }[] {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({
      name,
      content: fs.readFileSync(path.join(dir, name), "utf-8"),
    }));
}

/**
 * Check if content contains a specific SQL statement type
 */
function containsSqlType(
  content: string,
  type: "TABLE" | "INDEX" | "TRIGGER" | "POLICY" | "FUNCTION" | "TYPE" | "VIEW"
): boolean {
  // Remove comments and normalize whitespace
  const normalized = content
    .replace(/--[^\n]*/g, "") // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
    .replace(/\s+/g, " ")
    .toUpperCase();

  switch (type) {
    case "TABLE":
      return /CREATE\s+(OR\s+REPLACE\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?/i.test(
        normalized
      );
    case "INDEX":
      return /CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?/i.test(
        normalized
      );
    case "TRIGGER":
      return /CREATE\s+(OR\s+REPLACE\s+)?TRIGGER\s+/i.test(normalized);
    case "POLICY":
      return /CREATE\s+POLICY\s+/i.test(normalized);
    case "FUNCTION":
      return /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+/i.test(normalized);
    case "TYPE":
      return /CREATE\s+TYPE\s+[\w.]+\s+AS\s+ENUM/i.test(normalized);
    case "VIEW":
      return /CREATE\s+(OR\s+REPLACE\s+)?VIEW\s+/i.test(normalized);
  }
}

/**
 * Allowed statements in table files
 */
const TABLE_FILE_ALLOWED = [
  "CREATE TABLE",
  "ALTER TABLE",
  "ENABLE ROW LEVEL SECURITY",
  "COMMENT ON",
  "GRANT",
  "REVOKE",
];

describe("SQL Source Separation", () => {
  // Write report after all tests complete
  afterAll(() => {
    const errorCount = reportIssues.filter((i) => i.severity === "error").length;
    const warningCount = reportIssues.filter((i) => i.severity === "warning").length;
    const infoCount = reportIssues.filter((i) => i.severity === "info").length;

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        ...reportStats,
        violations: { error: errorCount, warning: warningCount, info: infoCount, total: reportIssues.length },
      },
      issues: reportIssues,
    };

    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log(`\n📄 Source separation report: ${REPORT_PATH}`);
  });

  describe("Tables Directory", () => {
    const tableFiles = readSqlFiles(path.join(SQL_SOURCE_DIR, "tables"));

    it("should not contain CREATE INDEX in table files", () => {
      const violations: string[] = [];

      reportStats.tableFiles = tableFiles.length;

      for (const file of tableFiles) {
        if (containsSqlType(file.content, "INDEX")) {
          violations.push(file.name);
          reportIssues.push({
            category: "SEPARATION",
            severity: "error",
            type: "TABLE_CONTAINS_INDEX",
            entity: file.name,
            message: `Table file "${file.name}" contains CREATE INDEX (should be in indexes/)`,
          });
        }
      }

      expect(
        violations,
        `Table files should not contain CREATE INDEX. Violations: ${violations.join(", ")}`
      ).toHaveLength(0);
    });

    it("should not contain CREATE TRIGGER in table files", () => {
      const violations: string[] = [];

      for (const file of tableFiles) {
        if (containsSqlType(file.content, "TRIGGER")) {
          violations.push(file.name);
          reportIssues.push({
            category: "SEPARATION",
            severity: "error",
            type: "TABLE_CONTAINS_TRIGGER",
            entity: file.name,
            message: `Table file "${file.name}" contains CREATE TRIGGER (should be in triggers/)`,
          });
        }
      }

      expect(
        violations,
        `Table files should not contain CREATE TRIGGER. Violations: ${violations.join(", ")}`
      ).toHaveLength(0);
    });

    it("should not contain CREATE POLICY in table files", () => {
      const violations: string[] = [];

      for (const file of tableFiles) {
        if (containsSqlType(file.content, "POLICY")) {
          violations.push(file.name);
          reportIssues.push({
            category: "SEPARATION",
            severity: "error",
            type: "TABLE_CONTAINS_POLICY",
            entity: file.name,
            message: `Table file "${file.name}" contains CREATE POLICY (should be in policies/)`,
          });
        }
      }

      expect(
        violations,
        `Table files should not contain CREATE POLICY. Violations: ${violations.join(", ")}`
      ).toHaveLength(0);
    });

    it("should not contain CREATE FUNCTION in table files", () => {
      const violations: string[] = [];

      for (const file of tableFiles) {
        if (containsSqlType(file.content, "FUNCTION")) {
          violations.push(file.name);
          reportIssues.push({
            category: "SEPARATION",
            severity: "error",
            type: "TABLE_CONTAINS_FUNCTION",
            entity: file.name,
            message: `Table file "${file.name}" contains CREATE FUNCTION (should be in functions/)`,
          });
        }
      }

      expect(
        violations,
        `Table files should not contain CREATE FUNCTION. Violations: ${violations.join(", ")}`
      ).toHaveLength(0);
    });
  });

  describe("Index Directory", () => {
    const indexFiles = readSqlFiles(path.join(SQL_SOURCE_DIR, "indexes"));

    it("should only contain CREATE INDEX statements", () => {
      const violations: string[] = [];

      reportStats.indexFiles = indexFiles.length;

      for (const file of indexFiles) {
        if (!containsSqlType(file.content, "INDEX")) {
          const v = `${file.name} - missing CREATE INDEX`;
          violations.push(v);
          reportIssues.push({ category: "SEPARATION", severity: "error", type: "INDEX_MISSING_STATEMENT", entity: file.name, message: v });
        }
        if (containsSqlType(file.content, "TABLE")) {
          const v = `${file.name} - contains CREATE TABLE`;
          violations.push(v);
          reportIssues.push({ category: "SEPARATION", severity: "error", type: "INDEX_CONTAINS_TABLE", entity: file.name, message: v });
        }
        if (containsSqlType(file.content, "FUNCTION")) {
          const v = `${file.name} - contains CREATE FUNCTION`;
          violations.push(v);
          reportIssues.push({ category: "SEPARATION", severity: "error", type: "INDEX_CONTAINS_FUNCTION", entity: file.name, message: v });
        }
      }

      expect(violations, `Index file violations: ${violations.join("; ")}`).toHaveLength(0);
    });
  });

  describe("Trigger Directory", () => {
    const triggerFiles = readSqlFiles(path.join(SQL_SOURCE_DIR, "triggers"));

    it("should only contain CREATE TRIGGER statements", () => {
      const violations: string[] = [];

      reportStats.triggerFiles = triggerFiles.length;

      for (const file of triggerFiles) {
        if (!containsSqlType(file.content, "TRIGGER")) {
          const v = `${file.name} - missing CREATE TRIGGER`;
          violations.push(v);
          reportIssues.push({ category: "SEPARATION", severity: "error", type: "TRIGGER_MISSING_STATEMENT", entity: file.name, message: v });
        }
        if (containsSqlType(file.content, "TABLE")) {
          const v = `${file.name} - contains CREATE TABLE`;
          violations.push(v);
          reportIssues.push({ category: "SEPARATION", severity: "error", type: "TRIGGER_CONTAINS_TABLE", entity: file.name, message: v });
        }
      }

      expect(violations, `Trigger file violations: ${violations.join("; ")}`).toHaveLength(0);
    });
  });

  describe("Policy Directory", () => {
    const policyFiles = readSqlFiles(path.join(SQL_SOURCE_DIR, "policies"));

    it("should only contain CREATE POLICY statements", () => {
      const violations: string[] = [];

      reportStats.policyFiles = policyFiles.length;

      for (const file of policyFiles) {
        if (!containsSqlType(file.content, "POLICY")) {
          const v = `${file.name} - missing CREATE POLICY`;
          violations.push(v);
          reportIssues.push({ category: "SEPARATION", severity: "error", type: "POLICY_MISSING_STATEMENT", entity: file.name, message: v });
        }
        if (containsSqlType(file.content, "TABLE")) {
          const v = `${file.name} - contains CREATE TABLE`;
          violations.push(v);
          reportIssues.push({ category: "SEPARATION", severity: "error", type: "POLICY_CONTAINS_TABLE", entity: file.name, message: v });
        }
        if (containsSqlType(file.content, "FUNCTION")) {
          const v = `${file.name} - contains CREATE FUNCTION`;
          violations.push(v);
          reportIssues.push({ category: "SEPARATION", severity: "error", type: "POLICY_CONTAINS_FUNCTION", entity: file.name, message: v });
        }
      }

      expect(violations, `Policy file violations: ${violations.join("; ")}`).toHaveLength(0);
    });
  });

  describe("Function Directory", () => {
    const functionFiles = readSqlFiles(path.join(SQL_SOURCE_DIR, "functions"));

    it("should only contain CREATE FUNCTION statements", () => {
      const violations: string[] = [];

      reportStats.functionFiles = functionFiles.length;

      for (const file of functionFiles) {
        if (!containsSqlType(file.content, "FUNCTION")) {
          const v = `${file.name} - missing CREATE FUNCTION`;
          violations.push(v);
          reportIssues.push({ category: "SEPARATION", severity: "error", type: "FUNCTION_MISSING_STATEMENT", entity: file.name, message: v });
        }
        if (containsSqlType(file.content, "TABLE")) {
          const v = `${file.name} - contains CREATE TABLE`;
          violations.push(v);
          reportIssues.push({ category: "SEPARATION", severity: "error", type: "FUNCTION_CONTAINS_TABLE", entity: file.name, message: v });
        }
        if (containsSqlType(file.content, "POLICY")) {
          const v = `${file.name} - contains CREATE POLICY`;
          violations.push(v);
          reportIssues.push({ category: "SEPARATION", severity: "error", type: "FUNCTION_CONTAINS_POLICY", entity: file.name, message: v });
        }
      }

      expect(violations, `Function file violations: ${violations.join("; ")}`).toHaveLength(0);
    });
  });

  describe("Enum Directory", () => {
    const enumFiles = readSqlFiles(path.join(SQL_SOURCE_DIR, "enums"));

    it("should only contain CREATE TYPE AS ENUM statements", () => {
      const violations: string[] = [];

      reportStats.enumFiles = enumFiles.length;

      for (const file of enumFiles) {
        if (!containsSqlType(file.content, "TYPE")) {
          const v = `${file.name} - missing CREATE TYPE AS ENUM`;
          violations.push(v);
          reportIssues.push({ category: "SEPARATION", severity: "error", type: "ENUM_MISSING_STATEMENT", entity: file.name, message: v });
        }
        if (containsSqlType(file.content, "TABLE")) {
          const v = `${file.name} - contains CREATE TABLE`;
          violations.push(v);
          reportIssues.push({ category: "SEPARATION", severity: "error", type: "ENUM_CONTAINS_TABLE", entity: file.name, message: v });
        }
        if (containsSqlType(file.content, "FUNCTION")) {
          const v = `${file.name} - contains CREATE FUNCTION`;
          violations.push(v);
          reportIssues.push({ category: "SEPARATION", severity: "error", type: "ENUM_CONTAINS_FUNCTION", entity: file.name, message: v });
        }
      }

      expect(violations, `Enum file violations: ${violations.join("; ")}`).toHaveLength(0);
    });
  });

  describe("Migration Registry", () => {
    const REGISTRY_PATH = path.join(
      process.cwd(),
      "aisha/db/migration-registry.json"
    );

    /**
     * Load migration registry — list of all approved non-baseline migrations.
     * Register new migrations via: npm run db:migration:register
     */
    function loadRegistry(): string[] {
      if (!fs.existsSync(REGISTRY_PATH)) return [];
      const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
      if (!Array.isArray(raw.migrations)) {
        throw new Error(
          "migration-registry.json must have a top-level 'migrations' array"
        );
      }
      return raw.migrations as string[];
    }

    it("every non-baseline migration must be registered in migration-registry.json", () => {
      if (!fs.existsSync(MIGRATIONS_DIR)) {
        return; // Skip if no migrations dir
      }

      const migrations = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"));

      reportStats.migrations = migrations.length;

      const registry = new Set(loadRegistry());

      reportStats.registeredMigrations = registry.size;

      const unregistered = migrations.filter(
        (m) =>
          !m.startsWith("00000000000000_baseline") && !registry.has(m)
      );

      for (const m of unregistered) {
        reportIssues.push({
          category: "MIGRATION",
          severity: "error",
          type: "UNREGISTERED_MIGRATION",
          entity: m,
          message: `Migration "${m}" is not registered in migration-registry.json. Run: npm run db:migration:register`,
        });
      }

      expect(
        unregistered,
        [
          `Unregistered migrations found: ${unregistered.join(", ")}`,
          "Run: npm run db:migration:register",
          "This registers all current migrations and ensures source-of-truth tracking.",
        ].join("\n")
      ).toHaveLength(0);
    });

    it("registry should not reference migrations that no longer exist on disk", () => {
      if (!fs.existsSync(MIGRATIONS_DIR)) {
        return;
      }

      const migrationsOnDisk = new Set(
        fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))
      );

      const registry = loadRegistry();
      const orphaned = registry.filter((m) => !migrationsOnDisk.has(m));

      for (const m of orphaned) {
        reportIssues.push({
          category: "MIGRATION",
          severity: "warning",
          type: "ORPHANED_REGISTRY_ENTRY",
          entity: m,
          message: `Registry references migration "${m}" which no longer exists on disk`,
        });
      }

      expect(
        orphaned,
        [
          `Registry references migrations not on disk: ${orphaned.join(", ")}`,
          "Remove stale entries from aisha/db/migration-registry.json",
          "or run: npm run db:migration:register",
        ].join("\n")
      ).toHaveLength(0);
    });

    it("migrations must be in chronological order (timestamp prefix)", () => {
      if (!fs.existsSync(MIGRATIONS_DIR)) {
        return;
      }

      const migrations = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort();

      for (let i = 1; i < migrations.length; i++) {
        const prev = migrations[i - 1];
        const curr = migrations[i];
        expect(
          prev.localeCompare(curr),
          `Migration ordering violation: ${prev} should come before ${curr}`
        ).toBeLessThan(0);
      }
    });
  });

  describe("No Duplicate Definitions", () => {
    it("should not have policies defined in both table files and policy files", () => {
      const tableFiles = readSqlFiles(path.join(SQL_SOURCE_DIR, "tables"));
      const policyFiles = readSqlFiles(path.join(SQL_SOURCE_DIR, "policies"));

      const tablesWithPolicies = tableFiles
        .filter((f) => containsSqlType(f.content, "POLICY"))
        .map((f) => f.name);

      for (const t of tablesWithPolicies) {
        reportIssues.push({
          category: "DUPLICATE",
          severity: "error",
          type: "DUPLICATE_POLICY_DEFINITION",
          entity: t,
          message: `Table file "${t}" has embedded CREATE POLICY — should be in policies/`,
        });
      }

      if (tablesWithPolicies.length > 0 && policyFiles.length > 0) {
        expect(
          tablesWithPolicies,
          `Tables with embedded policies (should use separate policy files): ${tablesWithPolicies.join(", ")}`
        ).toHaveLength(0);
      }
    });

    it("should not have indexes defined in both table files and index files", () => {
      const tableFiles = readSqlFiles(path.join(SQL_SOURCE_DIR, "tables"));
      const indexFiles = readSqlFiles(path.join(SQL_SOURCE_DIR, "indexes"));

      const tablesWithIndexes = tableFiles
        .filter((f) => containsSqlType(f.content, "INDEX"))
        .map((f) => f.name);

      for (const t of tablesWithIndexes) {
        reportIssues.push({
          category: "DUPLICATE",
          severity: "error",
          type: "DUPLICATE_INDEX_DEFINITION",
          entity: t,
          message: `Table file "${t}" has embedded CREATE INDEX — should be in indexes/`,
        });
      }

      if (tablesWithIndexes.length > 0 && indexFiles.length > 0) {
        expect(
          tablesWithIndexes,
          `Tables with embedded indexes (should use separate index files): ${tablesWithIndexes.join(", ")}`
        ).toHaveLength(0);
      }
    });
  });
});

describe("Policy File Naming Convention", () => {
  const policyFiles = readSqlFiles(path.join(SQL_SOURCE_DIR, "policies"));

  it("should follow naming convention: table__PolicyName.sql", () => {
    const violations: string[] = [];

    for (const file of policyFiles) {
      // Pattern: tablename__PolicyName.sql or tablename.sql (for inline)
      // Allows: letters, numbers, underscores, and hyphens in policy names
      const validPattern = /^[\w]+(__[\w-]+)?\.sql$/;
      if (!validPattern.test(file.name)) {
        violations.push(file.name);
        reportIssues.push({
          category: "NAMING",
          severity: "warning",
          type: "INVALID_POLICY_FILENAME",
          entity: file.name,
          message: `Policy file "${file.name}" doesn't match naming convention: table__PolicyName.sql`,
        });
      }
    }

    expect(
      violations,
      `Policy files with invalid naming: ${violations.join(", ")}`
    ).toHaveLength(0);
  });
});
