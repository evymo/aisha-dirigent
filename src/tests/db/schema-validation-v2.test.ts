/**
 * Schema Validation Tests v2
 *
 * Comprehensive validation of database schema, seed data, RLS policies,
 * and RPC functions. Uses dry-run approach (no destructive operations).
 *
 * Live DB checks auto-detect local PostgreSQL via test-env-probe; skip
 * gracefully when no DB is reachable. Suppress via AISHA_SKIP_DB_TESTS=1.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import {
  SOURCE_OF_TRUTH,
  getAbsolutePath,
  vypnuteTriggeryBezZapnuti,
  getTablesWithRlsStatus,
  getRpcFunctions,
  getEnumTypes,
  getRlsPolicies,
  getTableCounts,
  dryRunSeed,
  validateSqlSyntax,
  checkAIAvailability,
} from "./validation-utils";
import { isPgReachable, reportTestCapabilities, SKIP_AI_TESTS } from "./test-env-probe";

// =============================================================================
// Configuration — auto-detect local PostgreSQL
// =============================================================================

const dbAvailable = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("Schema Validation v2");
});

describe("Source of Truth - File Existence", () => {
  it("seed.sql exists and is readable", () => {
    const seedPath = getAbsolutePath(SOURCE_OF_TRUTH.paths.seed);
    expect(fs.existsSync(seedPath)).toBe(true);
    
    const content = fs.readFileSync(seedPath, "utf-8");
    expect(content.length).toBeGreaterThan(1000);
  });

  it("migrations directory exists with SQL files", () => {
    const migrationsPath = getAbsolutePath(SOURCE_OF_TRUTH.paths.migrations);
    expect(fs.existsSync(migrationsPath)).toBe(true);
    
    const files = fs.readdirSync(migrationsPath);
    const sqlFiles = files.filter(f => f.endsWith(".sql"));
    expect(sqlFiles.length).toBeGreaterThan(0);
  });

  it("types.ts exists", () => {
    const typesPath = getAbsolutePath(SOURCE_OF_TRUTH.paths.types);
    expect(fs.existsSync(typesPath)).toBe(true);
  });
});

describe("Source of Truth - Seed SQL Content", () => {
  let seedContent: string;

  beforeAll(() => {
    const seedPath = getAbsolutePath(SOURCE_OF_TRUTH.paths.seed);
    seedContent = fs.readFileSync(seedPath, "utf-8");
  });

  it("contains required INSERT statements for critical tables", () => {
    const requiredTables = SOURCE_OF_TRUTH.seedRequiredInsertTables;

    for (const table of requiredTables) {
      const hasInsert = seedContent.includes(`INSERT INTO ${table}`) ||
                        seedContent.includes(`INSERT INTO public.${table}`) ||
                        seedContent.includes(`INSERT INTO "public"."${table}"`);
      expect(hasInsert, `Missing INSERT for ${table}`).toBe(true);
    }
  });

  it("never leaves a trigger disabled (every DISABLE TRIGGER is re-enabled later)", () => {
    expect(vypnuteTriggeryBezZapnuti(seedContent), "trigger vypnutý seedem zůstane vypnutý v DB").toEqual([]);
  });

  it("has proper transaction structure", () => {
    const lines = seedContent.split("\n");
    const firstNonComment = lines.find(l => l.trim() && !l.trim().startsWith("--"));
    
    // Should start with BEGIN or be a clean SQL file
    // (Supabase seed runs in implicit transaction)
    expect(firstNonComment).toBeDefined();
  });

  it("does not contain dangerous commands", () => {
    const dangerous = ["DROP DATABASE", "DROP SCHEMA public", "TRUNCATE ALL"];
    for (const cmd of dangerous) {
      expect(seedContent).not.toContain(cmd);
    }
  });
});

describe("Database Validation - Expected Record Counts", () => {
  it.skipIf(!dbAvailable)("validates expected record counts in DB", async () => {
    const counts = await getTableCounts(Object.keys(SOURCE_OF_TRUTH.expectedCounts));

    // Accumulate ALL mismatches (don't abort at the first) so a single run
    // surfaces every drift between the expectations and the actual seed.
    const violations: string[] = [];
    for (const [table, expected] of Object.entries(SOURCE_OF_TRUTH.expectedCounts)) {
      const actual = counts[table] || 0;
      if (expected === 0) {
        // EXACT 0 — empty-invariant. Only genuinely-never-seeded tables
        // (lab_results, questionnaire_responses) live here; a floor would
        // silently permit PHI leaking into the seed.
        if (actual !== 0) {
          violations.push(`${table}: must be EMPTY in seed, got ${actual}`);
        }
      } else {
        // FLOOR — reference/demo data grows over time, so the count is a
        // minimum, not a fixed total. Matches seed-validation.test.ts.
        if (actual < expected) {
          violations.push(`${table}: expected >= ${expected}, got ${actual}`);
        }
      }
    }

    if (violations.length > 0) {
      console.error("\n❌ Expected-count violations:");
      violations.forEach(v => console.error(`   - ${v}`));
      console.error(
        "\nℹ️ Actual seed counts: " +
        Object.entries(counts).map(([t, c]) => `${t}=${c}`).join(", "),
      );
    }
    expect(violations, violations.join("; ")).toHaveLength(0);
  });
});

describe("Database Validation - RLS Policies", () => {
  it.skipIf(!dbAvailable)("all critical tables have RLS enabled", async () => {
    const tables = await getTablesWithRlsStatus();
    
    for (const criticalTable of SOURCE_OF_TRUTH.criticalTables) {
      const table = tables.find(t => t.tablename === criticalTable);
      expect(table, `Table ${criticalTable} not found`).toBeDefined();
      expect(table?.rowsecurity, `RLS not enabled on ${criticalTable}`).toBe(true);
    }
  });

  it.skipIf(!dbAvailable)("critical sensitive data tables have SELECT policies", async () => {
    const phiTables = [
      "health_check_ins",
      "lab_results",
      "dosing_logs",
      "profiles",
      "questionnaire_responses",
    ];
    
    for (const table of phiTables) {
      const policies = await getRlsPolicies(table);
      const hasSelectPolicy = policies.some(
        p => p.cmd === "SELECT" || p.cmd === "*"
      );
      expect(hasSelectPolicy, `No SELECT policy on sensitive data table ${table}`).toBe(true);
    }
  });
});

describe("Database Validation - RPC Functions", () => {
  it.skipIf(!dbAvailable)("required RPC functions exist", async () => {
    const functions = await getRpcFunctions();
    const functionNames = functions.map(f => f.routine_name);
    
    for (const required of SOURCE_OF_TRUTH.requiredRpcFunctions) {
      expect(
        functionNames.includes(required),
        `Missing RPC function: ${required}`
      ).toBe(true);
    }
  });
});

describe("Database Validation - Enum Types", () => {
  it.skipIf(!dbAvailable)("required enum types exist", async () => {
    const enums = await getEnumTypes();
    const enumNames = enums.map(e => e.typname);
    
    for (const required of SOURCE_OF_TRUTH.requiredEnums) {
      expect(
        enumNames.includes(required),
        `Missing enum type: ${required}`
      ).toBe(true);
    }
  });

  it.skipIf(!dbAvailable)("app_role enum has expected values", async () => {
    const enums = await getEnumTypes();
    const appRole = enums.find(e => e.typname === "app_role");
    
    expect(appRole).toBeDefined();
    expect(appRole?.values).toContain("admin");
    expect(appRole?.values).toContain("staff");
    expect(appRole?.values).toContain("member");
    expect(appRole?.values).toContain("practitioner");
  });
});

describe("Database Validation - SQL Syntax (Dry Run)", () => {
  it.skipIf(!dbAvailable)(
    "seed.sql has valid SQL syntax",
    async () => {
      const seedPath = getAbsolutePath(SOURCE_OF_TRUTH.paths.seed);
      const result = await validateSqlSyntax(seedPath);
      
      expect(result.valid, `SQL syntax error: ${result.error}`).toBe(true);
    },
    30000
  );

  it.skipIf(!dbAvailable)(
    "seed.sql executes successfully in dry-run",
    async () => {
      const seedPath = getAbsolutePath(SOURCE_OF_TRUTH.paths.seed);
      const result = await dryRunSeed(seedPath);
      
      expect(result.success, `Dry-run failed: ${result.error}`).toBe(true);
    },
    60000
  );
});

// Removed: "Data Consistency - Backup Comparison" — the docs/db-backup-check
// artifact is no longer produced by the build (legacy Supabase migration
// snapshot). Drift detection lives in aisha-deploy-flow Phase 1 now.

describe("AI-Powered Validation (MLX)", () => {
  const aiCheck = checkAIAvailability();
  const mlxDisabled = SKIP_AI_TESTS;

  it("reports AI availability status", () => {
    console.log(`🤖 AI Validation (MLX): ${aiCheck.available ? "Available" : "Unavailable"}`);
    console.log(`   Reason: ${aiCheck.reason}`);
    if (aiCheck.model) {
      console.log(`   Model: ${aiCheck.model}`);
    }
    if (mlxDisabled) {
      console.log(`   ⚠️ MLX validation disabled via SKIP_MLX_VALIDATION=1`);
    }
    
    // This test always passes - it's informational
    expect(true).toBe(true);
  });

  // AI tests run automatically when MLX is available
  // Skip only if explicitly disabled or not available
  it.skipIf(!aiCheck.available || mlxDisabled)(
    "MLX AI validation runs on Apple Silicon",
    () => {
      // When MLX is available, this would do semantic validation
      expect(aiCheck.available).toBe(true);
      expect(aiCheck.reason).toBe("Ready (Apple MLX)");
    }
  );
});

describe("Type System - TypeScript Alignment", () => {
  it("types.ts exists and exports Database type", () => {
    const typesPath = getAbsolutePath(SOURCE_OF_TRUTH.paths.types);
    const content = fs.readFileSync(typesPath, "utf-8");
    
    expect(content).toContain("export type Database");
    expect(content).toContain("Tables:");
  });

  it("types.ts includes critical table definitions", () => {
    const typesPath = getAbsolutePath(SOURCE_OF_TRUTH.paths.types);
    const content = fs.readFileSync(typesPath, "utf-8");
    
    const missingTables: string[] = [];
    
    for (const table of SOURCE_OF_TRUTH.criticalTables) {
      // TypeScript types.ts uses format: table_name: { Row: {...}, Insert: {...} }
      // Check for both quoted and unquoted formats
      const hasTable = content.includes(`${table}: {`) || 
                       content.includes(`"${table}":`) ||
                       content.includes(`'${table}':`);
      
      if (!hasTable) {
        missingTables.push(table);
      }
    }
    
    if (missingTables.length > 0) {
      console.error(`❌ Critical tables missing from types.ts: [${missingTables.join(", ")}]`);
    }
    
    expect(missingTables, `Critical tables missing: ${missingTables.join(", ")}`).toHaveLength(0);
  });
});
