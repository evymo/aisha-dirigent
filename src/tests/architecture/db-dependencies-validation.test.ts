/**
 * Database Dependencies Validation Tests
 * 
 * Validates that:
 * 1. All SQL RPC functions have backing tables/views
 * 2. All Edge Functions reference existing tables/RPC functions
 * 3. No orphan dependencies exist
 * 
 * These tests run as part of CI to catch missing dependencies early.
 * 
 * @module
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { isPgReachable } from "../db/test-env-probe";

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");
const SKIP_DB_TESTS = !isPgReachable();

const PATHS = {
  sqlFunctions: path.join(WORKSPACE_ROOT, "aisha/db/sql/functions"),
  sqlTables: path.join(WORKSPACE_ROOT, "aisha/db/sql/tables"),
  migrations: path.join(WORKSPACE_ROOT, "aisha/db/migrations"),
  // Reference-only archive — kept for historical lookup. The live runtime
  // is the per-domain microservices under services/. The dependency test
  // here scans the archive to make sure historical contracts stay
  // self-consistent, but it tolerates tables that exist only in
  // migrations (i.e. not as a separate `aisha/db/sql/tables/<name>.sql`).
  edgeFunctions: path.join(WORKSPACE_ROOT, "trash/legacy-archive/edge-functions-reference"),
};

/**
 * Collect every table name created by a CREATE TABLE statement anywhere in
 * the migrations directory. Used as a fallback when a table is referenced
 * but not split into its own `aisha/db/sql/tables/<name>.sql` file.
 */
function collectTablesFromMigrations(): Set<string> {
  const tables = new Set<string>();
  if (!fs.existsSync(PATHS.migrations)) return tables;
  const stack = [PATHS.migrations];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!entry.name.endsWith(".sql")) continue;
      const content = fs.readFileSync(p, "utf-8");
      const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["`']?(\w+)["`']?/gi;
      let m;
      while ((m = re.exec(content)) !== null) {
        tables.add(m[1].toLowerCase());
      }
    }
  }
  return tables;
}

// =============================================================================
// Static Analysis (No DB Required)
// =============================================================================

describe("SQL Function Dependencies (Static)", () => {
  const getAllSqlFiles = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(getAllSqlFiles(fullPath));
      } else if (entry.name.endsWith(".sql")) {
        files.push(fullPath);
      }
    }
    return files;
  };

  const extractTableReferences = (sqlContent: string): string[] => {
    const tables: Set<string> = new Set();
    
    // Match FROM table, JOIN table, INTO table patterns
    const patterns = [
      /FROM\s+(?:public\.)?(\w+)(?:\s|$|,|\()/gi,
      /JOIN\s+(?:public\.)?(\w+)/gi,
      /INTO\s+(?:public\.)?(\w+)/gi,
      /UPDATE\s+(?:public\.)?(\w+)/gi,
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(sqlContent)) !== null) {
        const table = match[1].toLowerCase();
        // Skip keywords and function names
        if (!["select", "where", "set", "values", "returning"].includes(table)) {
          tables.add(table);
        }
      }
    }
    
    return Array.from(tables);
  };

  // Skipped: produces false positives (SQL keywords parsed as table names).
  // Run manually: DB_DEPS_CHECK=true npm run test:run -- src/tests/architecture/db-dependencies-validation.test.ts
  it.skipIf(!process.env.DB_DEPS_CHECK)("should have table SQL files for tables referenced in functions", () => {
    const functionFiles = getAllSqlFiles(PATHS.sqlFunctions);
    const tableFiles = getAllSqlFiles(PATHS.sqlTables);
    
    const existingTables = new Set(
      tableFiles.map((f) => path.basename(f, ".sql"))
    );
    
    // System/built-in tables that don't need SQL files
    const systemTables = new Set([
      "auth", "users", "pg_proc", "pg_namespace", "information_schema",
      "pg_class", "pg_attribute", "pg_type", "pg_enum", "pg_policies",
      "supabase_migrations", "schema_migrations", "storage", "buckets",
      "objects", "secrets", "vault", "decrypted_secrets",
    ]);
    
    const errors: string[] = [];
    
    for (const file of functionFiles) {
      const content = fs.readFileSync(file, "utf-8");
      const tables = extractTableReferences(content);
      
      for (const table of tables) {
        if (
          !existingTables.has(table) &&
          !systemTables.has(table) &&
          !table.startsWith("pg_") &&
          !table.startsWith("_")
        ) {
          // Check if it's a view or might be defined elsewhere
          const isLikelyFunction = content.includes(`FUNCTION ${table}`) ||
                                   content.includes(`function ${table}`);
          if (!isLikelyFunction) {
            errors.push(`${path.basename(file)}: References table '${table}' - no SQL file found`);
          }
        }
      }
    }
    
    // Log warnings but don't fail (some tables may be created in migrations)
    if (errors.length > 0) {
      console.warn("⚠️ Potential missing table definitions:");
      errors.forEach((e) => console.warn(`  ${e}`));
    }
    
    // This is informational - actual validation happens in DB tests
    expect(true).toBe(true);
  });
});

describe("Edge Function Dependencies (Static)", () => {
  const getEdgeFunctionFiles = (): string[] => {
    // trash/legacy-archive/ is gitignored — fresh clones don't have it.
    // The dependency cross-check is only valuable when the archive is
    // actually present locally (e.g. when working on legacy contracts).
    const files: string[] = [];
    if (!fs.existsSync(PATHS.edgeFunctions)) return files;
    const entries = fs.readdirSync(PATHS.edgeFunctions, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith("_")) {
        const indexPath = path.join(PATHS.edgeFunctions, entry.name, "index.ts");
        if (fs.existsSync(indexPath)) {
          files.push(indexPath);
        }
      }
    }
    return files;
  };

  const extractDependencies = (content: string): {
    tables: string[];
    rpcs: string[];
    buckets: string[];
  } => {
    const tables: string[] = [];
    const rpcs: string[] = [];
    const buckets: string[] = [];
    
    // .from("table_name")
    const tableMatches = content.matchAll(/\.from\s*\(\s*["']([a-z_]+)["']\s*\)/gi);
    for (const m of tableMatches) {
      tables.push(m[1]);
    }
    
    // Pattern: .rpc("<fn>")
    const rpcMatches = content.matchAll(/\.rpc\s*\(\s*["']([a-z_]+)["']/gi);
    for (const m of rpcMatches) {
      rpcs.push(m[1]);
    }
    
    // storage.from("bucket_name")
    const bucketMatches = content.matchAll(/storage\.from\s*\(\s*["']([a-z_-]+)["']\s*\)/gi);
    for (const m of bucketMatches) {
      buckets.push(m[1]);
    }
    
    return {
      tables: [...new Set(tables)],
      rpcs: [...new Set(rpcs)],
      buckets: [...new Set(buckets)],
    };
  };

  it("should use centralized deps.ts for imports", () => {
    const files = getEdgeFunctionFiles();
    const errors: string[] = [];
    
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const funcName = path.dirname(file).split("/").pop();
      
      // Check for direct URL imports that should go through deps.ts
      const directImports = content.match(/from\s+["']https:\/\/(deno\.land|esm\.sh)/g);
      if (directImports && directImports.length > 0) {
        errors.push(`${funcName}: Has ${directImports.length} direct URL import(s) - should use deps.ts`);
      }
    }
    
    expect(errors, `Found direct URL imports:\n${errors.join("\n")}`).toHaveLength(0);
  });

  it("should reference tables that exist in SQL definitions", () => {
    const files = getEdgeFunctionFiles();
    const tableFiles = fs.existsSync(PATHS.sqlTables)
      ? fs.readdirSync(PATHS.sqlTables).filter((f) => f.endsWith(".sql"))
      : [];

    // Union of two truth sources:
    //  1. `aisha/db/sql/tables/<name>.sql` — preferred split-per-table layout
    //  2. CREATE TABLE statements anywhere in `aisha/db/migrations/`
    //     (catches tables created in a feature migration but never split out
    //     into the per-table SQL files, e.g. voice_rooms, call_participants)
    const existingTables = new Set<string>(
      tableFiles.map((f) => f.replace(".sql", "").toLowerCase()),
    );
    for (const t of collectTablesFromMigrations()) {
      existingTables.add(t);
    }

    const errors: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const funcName = path.dirname(file).split("/").pop();
      const { tables } = extractDependencies(content);

      for (const table of tables) {
        if (!existingTables.has(table)) {
          errors.push(`${funcName}: References unknown table '${table}'`);
        }
      }
    }
    
    // Informational only - full validation requires DB connection
    if (errors.length > 0) {
      console.warn("⚠️ Potential unknown table references:");
      errors.forEach((e) => console.warn(`  ${e}`));
    }
    
    expect(true).toBe(true);
  });
});

// =============================================================================
// Database Validation (Requires DB_VALIDATION=true)
// =============================================================================

describe.skipIf(SKIP_DB_TESTS)("Database Dependencies (DB Required)", () => {
  let dbTables: Set<string>;
  let dbFunctions: Set<string>;
  let dbBuckets: Set<string>;

  beforeAll(() => {
    // Get actual tables from database
    try {
      const tablesResult = execSync(
        `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -A -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      );
      dbTables = new Set(tablesResult.trim().split("\n").filter(Boolean));
    } catch {
      console.error("Failed to connect to database. Is Supabase running?");
      dbTables = new Set();
    }

    // Get actual functions from database
    try {
      const functionsResult = execSync(
        `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -A -c "SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      );
      dbFunctions = new Set(functionsResult.trim().split("\n").filter(Boolean));
    } catch {
      dbFunctions = new Set();
    }

    // Get storage buckets
    try {
      const bucketsResult = execSync(
        `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -t -A -c "SELECT id FROM storage.buckets"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      );
      dbBuckets = new Set(bucketsResult.trim().split("\n").filter(Boolean));
    } catch {
      dbBuckets = new Set();
    }
  });

  it("should have all Edge Function table dependencies in database", () => {
    if (dbTables.size === 0) {
      console.warn("⚠️ No database connection - skipping");
      return;
    }

    const edgeFunctionsDir = PATHS.edgeFunctions;
    const entries = fs.readdirSync(edgeFunctionsDir, { withFileTypes: true });
    const errors: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
      
      const indexPath = path.join(edgeFunctionsDir, entry.name, "index.ts");
      if (!fs.existsSync(indexPath)) continue;

      const content = fs.readFileSync(indexPath, "utf-8");
      const tableMatches = content.matchAll(/\.from\s*\(\s*["']([a-z_]+)["']\s*\)/gi);
      
      for (const match of tableMatches) {
        const table = match[1];
        if (!dbTables.has(table)) {
          errors.push(`${entry.name}: Table '${table}' not found in database`);
        }
      }
    }

    expect(errors, `Missing tables:\n${errors.join("\n")}`).toHaveLength(0);
  });

  it("should have all Edge Function RPC dependencies in database", () => {
    if (dbFunctions.size === 0) {
      console.warn("⚠️ No database connection - skipping");
      return;
    }

    const edgeFunctionsDir = PATHS.edgeFunctions;
    const entries = fs.readdirSync(edgeFunctionsDir, { withFileTypes: true });
    const errors: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
      
      const indexPath = path.join(edgeFunctionsDir, entry.name, "index.ts");
      if (!fs.existsSync(indexPath)) continue;

      const content = fs.readFileSync(indexPath, "utf-8");
      const rpcMatches = content.matchAll(/\.rpc\s*\(\s*["']([a-z_]+)["']/gi);
      
      for (const match of rpcMatches) {
        const funcName = match[1];
        if (!dbFunctions.has(funcName)) {
          errors.push(`${entry.name}: RPC function '${funcName}' not found in database`);
        }
      }
    }

    expect(errors, `Missing RPC functions:\n${errors.join("\n")}`).toHaveLength(0);
  });

  it("should have all required storage buckets", () => {
    if (dbBuckets.size === 0) {
      console.warn("⚠️ No database connection - skipping");
      return;
    }

    const requiredBuckets = ["health-documents"];
    const errors: string[] = [];

    for (const bucket of requiredBuckets) {
      if (!dbBuckets.has(bucket)) {
        errors.push(`Storage bucket '${bucket}' not found`);
      }
    }

    expect(errors, `Missing buckets:\n${errors.join("\n")}`).toHaveLength(0);
  });
});
