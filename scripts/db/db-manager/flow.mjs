#!/usr/bin/env node
/**
 * DB Manager — Flow Consistency Analyzer
 *
 * Verifies that the data flow hook → RPC → DB function → table is consistent.
 * Checks that hooks calling RPC functions reference functions that actually exist
 * in the SQL source of truth, and that the overall flow is coherent.
 *
 * Generates docs/db-structure/flow-consistency-report.json
 *
 * Usage:
 *   node scripts/db/db-manager/flow.mjs [--static]
 *   npm run db-mgr:flow [-- --static]
 *
 * @module
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReportOutput } from "./lib/reportPaths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const SQL_DIR = path.join(ROOT, "aisha", "db", "sql", "functions");
const SRC_DIR = path.join(ROOT, "src");
const { reportDir: REPORT_DIR, reportPath: REPORT_PATH } = resolveReportOutput(
  ROOT,
  "flow-consistency-report.json",
);

const isStatic = process.argv.includes("--static");

/* ---------- Helpers ---------- */

function getSqlFunctions() {
  if (!existsSync(SQL_DIR)) return new Set();
  return new Set(
    readdirSync(SQL_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(".sql", ""))
  );
}

function scanHooksForRpc(dir, results = []) {
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanHooksForRpc(full, results);
      continue;
    }
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
    if (entry.name.includes(".test.") || entry.name.includes(".spec.")) continue;

    const content = readFileSync(full, "utf-8");
    const relPath = path.relative(ROOT, full);

    // Find all .rpc() calls
    const rpcRegex = /\.rpc\(\s*["'](\w+)["']/g;
    let match;
    while ((match = rpcRegex.exec(content)) !== null) {
      const linesBefore = content.substring(0, match.index).split("\n");
      results.push({
        hook: relPath,
        function: match[1],
        line: linesBefore.length,
      });
    }

    // Find any .from() calls (should not exist per AGENTS.md rules)
    const fromRegex = /\.from\(\s*["'](\w+)["']\)/g;
    let fromMatch;
    while ((fromMatch = fromRegex.exec(content)) !== null) {
      const linesBefore = content.substring(0, fromMatch.index).split("\n");
      results.push({
        hook: relPath,
        directTable: fromMatch[1],
        line: linesBefore.length,
      });
    }
  }
  return results;
}

/* ---------- Analysis ---------- */

function analyze() {
  console.log(`🔄 Flow Consistency Analyzer${isStatic ? " (static mode)" : ""}\n`);

  const sqlFunctions = getSqlFunctions();
  console.log(`  📄 ${sqlFunctions.size} SQL functions in source of truth`);

  // Scan hooks and components for RPC calls
  const hookCalls = scanHooksForRpc(path.join(SRC_DIR, "hooks"));
  const componentCalls = scanHooksForRpc(path.join(SRC_DIR, "components"));
  const pageCalls = scanHooksForRpc(path.join(SRC_DIR, "pages"));
  const allCalls = [...hookCalls, ...componentCalls, ...pageCalls];
  console.log(`  🔗 ${allCalls.length} RPC/from() calls in frontend`);

  const issues = [];

  /**
   * Tables with full RLS policies that hooks access via .from() for
   * Supabase Realtime subscriptions, upserts, and channel operations.
   * Realtime requires channel subscription on the table — .rpc() cannot
   * be used for this. RPC wrappers are not planned for these patterns.
   */
  const REALTIME_ALLOWED_TABLES = new Set([
    "call_participants",
    "consultation_sessions",
    "sla_tracking",
    "stories",
    "story_matrix_rooms",
    "voice_rooms",
  ]);

  // Check for .from() calls (RPC-only violation)
  const directTableCalls = allCalls.filter((c) => c.directTable);
  for (const call of directTableCalls) {
    if (REALTIME_ALLOWED_TABLES.has(call.directTable)) continue;
    issues.push({
      type: "DIRECT_TABLE_ACCESS",
      severity: "error",
      hook: call.hook,
      table: call.directTable,
      line: call.line,
      message: `Direct .from("${call.directTable}") in ${call.hook} — must use .rpc() per RPC-only pattern`,
    });
  }

  // Check RPC calls reference existing SQL functions
  const rpcCalls = allCalls.filter((c) => c.function);
  const missingFunctions = new Set();

  for (const call of rpcCalls) {
    if (!sqlFunctions.has(call.function)) {
      missingFunctions.add(call.function);
      issues.push({
        type: "RPC_MISSING_SQL",
        severity: "warning",
        hook: call.hook,
        function: call.function,
        line: call.line,
        message: `RPC call to "${call.function}" in ${call.hook} — no matching SQL file in source of truth`,
      });
    }
  }

  // Deduplicate warnings for same function
  const deduped = [];
  const seenFuncWarnings = new Set();
  for (const issue of issues) {
    if (issue.type === "RPC_MISSING_SQL") {
      const key = `${issue.function}:${issue.hook}`;
      if (seenFuncWarnings.has(key)) continue;
      seenFuncWarnings.add(key);
    }
    deduped.push(issue);
  }

  const summary = {
    totalSqlFunctions: sqlFunctions.size,
    totalFrontendCalls: allCalls.length,
    directTableAccess: directTableCalls.length,
    rpcMissingSql: missingFunctions.size,
    issues: {
      errors: deduped.filter((i) => i.severity === "error").length,
      warnings: deduped.filter((i) => i.severity === "warning").length,
    },
  };

  const report = {
    generatedAt: new Date().toISOString(),
    analyzer: "db-mgr:flow",
    version: "1.0.0",
    mode: isStatic ? "static" : "live",
    summary,
    issues: deduped,
  };

  if (!existsSync(REPORT_DIR)) {
    mkdirSync(REPORT_DIR, { recursive: true });
  }
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf-8");

  console.log(`\n📊 Results:`);
  console.log(`  Direct table access violations: ${directTableCalls.length}`);
  console.log(`  RPC calls to missing SQL functions: ${missingFunctions.size}`);
  console.log(`  Total issues: ${deduped.length}`);
  console.log(`\n📝 Report: ${path.relative(ROOT, REPORT_PATH)}`);

  if (summary.issues.errors > 0) process.exit(1);
  process.exit(0);
}

analyze();
