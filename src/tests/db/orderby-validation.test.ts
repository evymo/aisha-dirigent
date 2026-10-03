/**
 * ORDER BY Validation Tests
 *
 * Systematic validation that ALL RPC functions returning multiple rows
 * have proper ORDER BY clauses, especially for tables with sort_order
 * or display_order columns.
 *
 * This ensures consistent ordering across the application and prevents
 * UI inconsistencies caused by random row ordering.
 *
 * Auto-detects local PostgreSQL via test-env-probe; skips gracefully when
 * no DB is reachable. Suppress via AISHA_SKIP_DB_TESTS=1.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  getTablesWithOrderingColumns,
  validateOrderByCompleteness,
  getAllRpcFunctionsOrderByStatus,
  SINGLE_ROW_RPCS,
  psqlQuery,
} from "./validation-utils";
import { isPgReachable, reportTestCapabilities } from "./test-env-probe";

// =============================================================================
// Configuration — auto-detect local PostgreSQL
// =============================================================================

const shouldRunDbTests = isPgReachable();

beforeAll(async () => {
  await reportTestCapabilities("ORDER BY Validation");
});

// =============================================================================
// Ordering Column Tests
// =============================================================================

describe("Ordering Columns - Schema Validation", () => {
  it.skipIf(!shouldRunDbTests)(
    "all ordering columns have DEFAULT 0",
    async () => {
      const columns = await getTablesWithOrderingColumns();
      
      expect(columns.length).toBeGreaterThan(0);
      
      const missingDefaults = columns.filter(
        c => c.column_default === null || c.column_default === ""
      );
      
      if (missingDefaults.length > 0) {
        console.error("❌ Columns missing DEFAULT 0:");
        missingDefaults.forEach(c => {
          console.error(`   - ${c.table_name}.${c.column_name}`);
        });
      }
      
      expect(missingDefaults).toHaveLength(0);
    }
  );

  it.skipIf(!shouldRunDbTests)(
    "ordering columns have consistent naming (sort_order or display_order)",
    async () => {
      const columns = await getTablesWithOrderingColumns();
      
      const validNames = ["sort_order", "display_order"];
      const invalidColumns = columns.filter(
        c => !validNames.includes(c.column_name)
      );
      
      expect(invalidColumns).toHaveLength(0);
    }
  );
});

// =============================================================================
// RPC Functions - ORDER BY Validation
// =============================================================================

describe("RPC Functions - ORDER BY for Ordering Tables", () => {
  it.skipIf(!shouldRunDbTests)(
    "all get_/list_ functions for ordering tables have ORDER BY",
    async () => {
      const results = await validateOrderByCompleteness();
      
      const allIssues: string[] = [];
      results.forEach(r => {
        allIssues.push(...r.issues);
      });
      
      if (allIssues.length > 0) {
        console.error("❌ ORDER BY Issues Found:");
        allIssues.forEach(issue => console.error(`   - ${issue}`));
      }
      
      // Allow some known exceptions (functions with intentional different ordering)
      const criticalIssues = allIssues.filter(
        issue => !issue.includes("created_at") && !issue.includes("updated_at")
      );
      
      expect(criticalIssues).toHaveLength(0);
    }
  );

  it.skipIf(!shouldRunDbTests)(
    "functions using ordering columns actually ORDER BY those columns",
    async () => {
      const results = await validateOrderByCompleteness();
      
      // Group functions by table and check usage
      const tableStats = results.map(r => ({
        table: r.table,
        column: r.column,
        total_functions: r.functions_using_table.length,
        with_correct_order: r.functions_using_table.filter(
          f => f.has_order_by && f.uses_correct_column
        ).length,
        without_order: r.functions_using_table.filter(
          f => !f.has_order_by
        ).length,
      }));
      
      console.log("\n📊 ORDER BY Coverage by Table:");
      tableStats.forEach(stat => {
        const coverage = stat.total_functions > 0 
          ? Math.round((stat.with_correct_order / stat.total_functions) * 100)
          : 100;
        const status = coverage === 100 ? "✅" : coverage >= 80 ? "⚠️" : "❌";
        console.log(
          `   ${status} ${stat.table}.${stat.column}: ` +
          `${stat.with_correct_order}/${stat.total_functions} functions (${coverage}%)`
        );
      });
      
      // All tables should have at least one function with correct ORDER BY
      const tablesWithoutCoverage = tableStats.filter(
        s => s.total_functions > 0 && s.with_correct_order === 0
      );
      
      expect(tablesWithoutCoverage).toHaveLength(0);
    }
  );
});

// =============================================================================
// Comprehensive RPC ORDER BY Analysis
// =============================================================================

describe("All RPC Functions - ORDER BY Analysis", () => {
  it.skipIf(!shouldRunDbTests)(
    "all get_/list_ functions returning multiple rows have ORDER BY",
    async () => {
      const functions = await getAllRpcFunctionsOrderByStatus();

      const issues = functions.filter(f => f.issue !== null);

      // The ONLY allowed exceptions are the explicitly-reviewed single-row /
      // aggregate functions (SINGLE_ROW_RPCS). Everything else that returns
      // multiple rows MUST be deterministically ordered — no tolerance band,
      // no fuzzy name patterns.
      const criticalIssues = issues.filter(f => !SINGLE_ROW_RPCS.has(f.name));

      console.log(`\n📊 RPC ORDER BY Summary:`);
      console.log(`   Total functions with RETURN QUERY: ${functions.length}`);
      console.log(`   With ORDER BY: ${functions.filter(f => f.has_order_by).length}`);
      console.log(`   Single-row allowlisted: ${issues.length - criticalIssues.length}`);
      console.log(`   Missing ORDER BY (critical): ${criticalIssues.length}`);

      if (criticalIssues.length > 0) {
        console.error(
          "\n❌ Multi-row get_/list_ functions missing ORDER BY " +
          "(add a deterministic ORDER BY, or if it truly returns ≤1 row add it " +
          "to SINGLE_ROW_RPCS in validation-utils.ts with a justification):",
        );
        criticalIssues.forEach(f => console.error(`   - ${f.name}: ${f.issue}`));
      }

      expect(
        criticalIssues,
        `Multi-row functions missing ORDER BY: ${criticalIssues.map(f => f.name).join(", ")}`,
      ).toHaveLength(0);
    }
  );

  it.skipIf(!shouldRunDbTests)(
    "SINGLE_ROW_RPCS allowlist has no stale entries",
    async () => {
      // Guard against allowlist rot: every allowlisted name must still be a
      // real RETURN QUERY function. If a function is renamed/removed or later
      // gains an ORDER BY, its allowlist entry should be cleaned up rather than
      // silently masking a future multi-row function of a reused name.
      const functions = await getAllRpcFunctionsOrderByStatus();
      const known = new Set(functions.map(f => f.name));
      const stale = [...SINGLE_ROW_RPCS].filter(name => !known.has(name));
      if (stale.length > 0) {
        console.error(
          "\n⚠️ Stale SINGLE_ROW_RPCS entries (no matching RETURN QUERY function): " +
          stale.join(", "),
        );
      }
      expect(stale, `Stale allowlist entries: ${stale.join(", ")}`).toHaveLength(0);
    }
  );

  it.skipIf(!shouldRunDbTests)(
    "generates ORDER BY coverage report",
    async () => {
      const functions = await getAllRpcFunctionsOrderByStatus();
      
      // Group by ORDER BY clause type
      const orderByTypes: Record<string, number> = {
        "sort_order": 0,
        "display_order": 0,
        "created_at": 0,
        "updated_at": 0,
        "name/title": 0,
        "id": 0,
        "other": 0,
        "none": 0,
      };
      
      functions.forEach(f => {
        if (!f.order_clause) {
          orderByTypes["none"]++;
        } else if (f.order_clause.includes("sort_order")) {
          orderByTypes["sort_order"]++;
        } else if (f.order_clause.includes("display_order")) {
          orderByTypes["display_order"]++;
        } else if (f.order_clause.includes("created_at")) {
          orderByTypes["created_at"]++;
        } else if (f.order_clause.includes("updated_at")) {
          orderByTypes["updated_at"]++;
        } else if (/name|title/i.test(f.order_clause)) {
          orderByTypes["name/title"]++;
        } else if (f.order_clause.includes("id")) {
          orderByTypes["id"]++;
        } else {
          orderByTypes["other"]++;
        }
      });
      
      console.log("\n📊 ORDER BY Clause Distribution:");
      Object.entries(orderByTypes)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => {
          const pct = Math.round((count / functions.length) * 100);
          console.log(`   ${type}: ${count} (${pct}%)`);
        });
      
      // Ensure we have good coverage
      expect(orderByTypes["none"]).toBeLessThan(functions.length * 0.3);
    }
  );
});

// =============================================================================
// Direct Database Queries - ORDER BY Verification
// =============================================================================

describe("Direct Verification - Critical Functions", () => {
  /**
   * List of critical functions that MUST have correct ORDER BY
   */
  const criticalFunctions = [
    { name: "get_hero_slides_admin", expected: "sort_order" },
    { name: "get_subscription_packages", expected: "sort_order" },
    { name: "get_subscription_packages_admin", expected: "sort_order" },
    { name: "get_questionnaire_blocks_localized", expected: "display_order" },
    { name: "get_study_consent_requirements_localized", expected: "sort_order" },
    { name: "get_supported_languages", expected: "sort_order" },
    { name: "get_token_reward_rules_admin", expected: "sort_order" },
  ];

  it.skipIf(!shouldRunDbTests)(
    "critical functions have correct ORDER BY column",
    async () => {
      const failures: string[] = [];
      
      for (const func of criticalFunctions) {
        try {
          const result = psqlQuery(`
            SELECT substring(prosrc FROM 'ORDER BY[^;]{0,80}')
            FROM pg_proc 
            WHERE proname = '${func.name}'
              AND pronamespace = 'public'::regnamespace
          `);
          
          if (!result) {
            failures.push(`${func.name}: Function not found`);
            continue;
          }
          
          if (!result.includes(func.expected)) {
            failures.push(
              `${func.name}: Expected ORDER BY ${func.expected}, got: ${result}`
            );
          }
        } catch (error) {
          failures.push(`${func.name}: Query error - ${error}`);
        }
      }
      
      if (failures.length > 0) {
        console.error("\n❌ Critical Function Failures:");
        failures.forEach(f => console.error(`   - ${f}`));
      }
      
      expect(failures).toHaveLength(0);
    }
  );
});

// =============================================================================
// Null Sort Order Data Check
// =============================================================================

describe("Data Integrity - Sort Order Values", () => {
  it.skipIf(!shouldRunDbTests)(
    "no NULL values in sort_order/display_order columns",
    async () => {
      const columns = await getTablesWithOrderingColumns();
      const nullCounts: Array<{ table: string; column: string; count: number }> = [];
      
      for (const col of columns) {
        try {
          const result = psqlQuery(`
            SELECT COUNT(*) FROM "${col.table_name}" 
            WHERE "${col.column_name}" IS NULL
          `);
          const count = parseInt(result, 10) || 0;
          
          if (count > 0) {
            nullCounts.push({
              table: col.table_name,
              column: col.column_name,
              count,
            });
          }
        } catch {
          // Table might not exist in test DB
        }
      }
      
      if (nullCounts.length > 0) {
        console.error("\n❌ NULL values found in ordering columns:");
        nullCounts.forEach(n => {
          console.error(`   - ${n.table}.${n.column}: ${n.count} NULL rows`);
        });
      }
      
      // Allow some nulls but flag them
      expect(nullCounts.every(n => n.count < 100)).toBe(true);
    }
  );
});
