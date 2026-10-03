/**
 * Source-of-Truth Analyzer Gate Test
 *
 * Validates the end-to-end source-of-truth workflow:
 * 1. Integration: `source.mjs` runs successfully (0 errors, 0 criticals)
 * 2. Report: JSON report is valid and has expected structure
 * 3. Parser unit tests: SQL signature parsing handles edge cases
 * 4. Frontend scanner: RPC call extraction handles nested objects, ternaries
 * 5. Contract: every frontend RPC param matches its SQL counterpart
 *
 * Run: npm run test:gates -- src/tests/gates/source-of-truth-analyzer.gate.test.ts
 *
 * @module
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SOURCE_MJS = path.join(ROOT, "scripts/db/db-manager/source.mjs");
// Mirror scripts/db/db-manager/lib/reportPaths.mjs — the analyzer writes to
// AISHA_REPORT_DIR when set (run-vitest.mjs always injects it), so the gate
// must read from the same location or it false-fails on fresh checkouts.
const REPORT_PATH = process.env.AISHA_REPORT_DIR
  ? path.join(path.resolve(process.env.AISHA_REPORT_DIR), "source-truth-report.json")
  : path.join(ROOT, "docs/db-structure/source-truth-report.json");
const SQL_DIR = path.join(ROOT, "aisha/db/sql/functions");

/* ---------- Dynamic ESM imports ---------- */

interface SqlParam {
  name: string;
  type: string;
  hasDefault: boolean;
}

interface SqlFunction {
  name: string;
  fileName: string;
  params: SqlParam[];
  isSecurityDefiner: boolean;
  hasAuthUid: boolean;
  hasSearchPath: boolean;
  hasAnonGrant: boolean;
  hasConsentCheck: boolean;
  accessesPhiData: boolean;
}

interface RpcCall {
  file: string;
  line: number;
  function: string;
  params: string[];
}

interface AnalyzerReport {
  generatedAt: string;
  analyzer: string;
  version: string;
  summary: {
    totalSqlFunctions: number;
    totalRpcCalls: number;
    issues: { critical: number; errors: number; warnings: number };
  };
  details: Array<{
    type: string;
    severity: string;
    function: string;
    location: string;
    line?: number;
    parameter?: string;
    message: string;
  }>;
}

interface SourceModule {
  parseSqlFunction: (filePath: string) => SqlFunction;
  parseParam: (paramStr: string) => SqlParam;
  extractBalancedBraces: (content: string, startIdx: number) => string | null;
  extractTopLevelKeys: (paramsContent: string) => string[];
  scanFrontendRpcCalls: (dir: string, results?: RpcCall[]) => RpcCall[];
  analyze: (isCli?: boolean) => AnalyzerReport;
}

let mod: SourceModule;

beforeAll(async () => {
  mod = await import(SOURCE_MJS);
});

// ============================================================================
// 1. Integration — full analyzer run
// ============================================================================
describe("Source-of-Truth Analyzer — Integration", () => {
  it("source.mjs runs via CLI with exit code 0", () => {
    const result = execSync(`node "${SOURCE_MJS}"`, {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 60_000,
    });
    expect(result).toContain("Errors: 0");
  });

  it("generates a valid JSON report", () => {
    expect(fs.existsSync(REPORT_PATH), "Report file missing").toBe(true);
    const raw = fs.readFileSync(REPORT_PATH, "utf-8");
    const report: AnalyzerReport = JSON.parse(raw);
    expect(report.analyzer).toBe("db-mgr:source");
    expect(report.version).toBe("1.0.0");
    expect(report.summary).toBeDefined();
    expect(report.details).toBeDefined();
    expect(Array.isArray(report.details)).toBe(true);
  });

  it("report summary has 0 errors and 0 criticals", () => {
    const report: AnalyzerReport = JSON.parse(
      fs.readFileSync(REPORT_PATH, "utf-8"),
    );
    expect(report.summary.issues.errors).toBe(0);
    expect(report.summary.issues.critical).toBe(0);
  });

  it("report scanned non-trivial counts (no empty run)", () => {
    const report: AnalyzerReport = JSON.parse(
      fs.readFileSync(REPORT_PATH, "utf-8"),
    );
    expect(report.summary.totalSqlFunctions).toBeGreaterThan(100);
    expect(report.summary.totalRpcCalls).toBeGreaterThan(100);
  });
});

// ============================================================================
// 2. Programmatic run — analyze() returns report
// ============================================================================
describe("Source-of-Truth Analyzer — Programmatic", () => {
  let report: AnalyzerReport;

  beforeAll(() => {
    report = mod.analyze(false);
  });

  it("returns report object with 0 errors", () => {
    expect(report.summary.issues.errors).toBe(0);
    expect(report.summary.issues.critical).toBe(0);
  });

  it("scans SQL functions and frontend RPC calls", () => {
    expect(report.summary.totalSqlFunctions).toBeGreaterThan(0);
    expect(report.summary.totalRpcCalls).toBeGreaterThan(0);
  });
});

// ============================================================================
// 3. SQL parser — parseSqlFunction edge cases
// ============================================================================
describe("parseSqlFunction — edge cases", () => {
  it("parses a function with DEFAULT NOW()", () => {
    const sqlFile = path.join(SQL_DIR, "save_health_metric_audited.sql");
    if (!fs.existsSync(sqlFile)) return; // skip if file removed

    const fn = mod.parseSqlFunction(sqlFile);
    expect(fn.name).toBe("save_health_metric_audited");
    // All params should be parsed (no truncation at the first `)` in NOW())
    expect(fn.params.length).toBeGreaterThan(0);

    // Verify known Default params are flagged
    const defaultParams = fn.params.filter((p: SqlParam) => p.hasDefault);
    // Functions with DEFAULT NOW() should have at least 1 default param
    const hasNowDefault = fn.params.some((p: SqlParam) => p.hasDefault);
    expect(hasNowDefault).toBe(true);
  });

  it("parses a function with ARRAY[...] type", () => {
    const sqlFile = path.join(SQL_DIR, "upsert_distribution_protocol_admin.sql");
    if (!fs.existsSync(sqlFile)) return;

    const fn = mod.parseSqlFunction(sqlFile);
    expect(fn.name).toBeTruthy();
    // Params should be parsed without ARRAY[] bracket breaking the parser
    expect(fn.params.length).toBeGreaterThan(0);
  });

  it("parses function with no parameters", () => {
    // Find a parameterless function
    const files = fs.readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql"));
    const paramless = files.find((f) => {
      const content = fs.readFileSync(path.join(SQL_DIR, f), "utf-8");
      const match = content.match(
        /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+\w+\s*\(\s*\)/i,
      );
      return !!match;
    });
    if (!paramless) return; // skip if none found

    const fn = mod.parseSqlFunction(path.join(SQL_DIR, paramless));
    expect(fn.params).toHaveLength(0);
  });

  it("detects SECURITY DEFINER correctly", () => {
    const files = fs.readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql"));
    const definerFile = files.find((f) => {
      const content = fs.readFileSync(path.join(SQL_DIR, f), "utf-8");
      return /SECURITY\s+DEFINER/i.test(content);
    });
    if (!definerFile) return;

    const fn = mod.parseSqlFunction(path.join(SQL_DIR, definerFile));
    expect(fn.isSecurityDefiner).toBe(true);
  });
});

// ============================================================================
// 4. parseParam — unit tests
// ============================================================================
describe("parseParam — unit tests", () => {
  it("parses simple param: p_name text", () => {
    const p = mod.parseParam("p_name text");
    expect(p.name).toBe("p_name");
    expect(p.type).toContain("text");
    expect(p.hasDefault).toBe(false);
  });

  it("parses param with DEFAULT", () => {
    const p = mod.parseParam("p_limit integer DEFAULT 10");
    expect(p.name).toBe("p_limit");
    expect(p.type).toContain("integer");
    expect(p.hasDefault).toBe(true);
  });

  it("parses IN mode param", () => {
    const p = mod.parseParam("IN p_user_id uuid");
    expect(p.name).toBe("p_user_id");
    expect(p.type).toContain("uuid");
  });

  it("parses OUT mode param", () => {
    const p = mod.parseParam("OUT total_count bigint");
    expect(p.name).toBe("total_count");
    expect(p.type).toContain("bigint");
  });
});

// ============================================================================
// 5. extractBalancedBraces — unit tests
// ============================================================================
describe("extractBalancedBraces — unit tests", () => {
  it("extracts simple object", () => {
    const content = '{ p_name: "foo" }';
    const result = mod.extractBalancedBraces(content, 0);
    expect(result).toBe(' p_name: "foo" ');
  });

  it("handles nested braces", () => {
    const content = '{ p_data: { row: 0, col: 1 }, p_name: "test" }';
    const result = mod.extractBalancedBraces(content, 0);
    expect(result).toBe(' p_data: { row: 0, col: 1 }, p_name: "test" ');
  });

  it("returns null for no opening brace", () => {
    expect(mod.extractBalancedBraces("hello", 0)).toBeNull();
  });

  it("returns null for unbalanced braces", () => {
    expect(mod.extractBalancedBraces("{ open { nested", 0)).toBeNull();
  });

  it("handles deeply nested objects", () => {
    const content = '{ a: { b: { c: 1 } } }';
    const result = mod.extractBalancedBraces(content, 0);
    expect(result).toContain("a: { b: { c: 1 } }");
  });
});

// ============================================================================
// 6. extractTopLevelKeys — unit tests
// ============================================================================
describe("extractTopLevelKeys — unit tests", () => {
  it("extracts simple keys", () => {
    const keys = mod.extractTopLevelKeys(' p_name: value, p_age: 42 ');
    expect(keys).toContain("p_name");
    expect(keys).toContain("p_age");
    expect(keys).toHaveLength(2);
  });

  it("ignores nested object keys", () => {
    const keys = mod.extractTopLevelKeys(
      ' p_data: { row: 0, col: 1 }, p_name: "test" ',
    );
    expect(keys).toContain("p_data");
    expect(keys).toContain("p_name");
    expect(keys).not.toContain("row");
    expect(keys).not.toContain("col");
  });

  it("ignores ternary operator colon", () => {
    const keys = mod.extractTopLevelKeys(
      ' p_active: isActive ? true : false, p_name: "x" ',
    );
    expect(keys).toContain("p_active");
    expect(keys).toContain("p_name");
    // "false" should NOT be extracted as a key (ternary false branch)
    expect(keys).not.toContain("false");
    expect(keys).toHaveLength(2);
  });

  it("handles template literals", () => {
    const keys = mod.extractTopLevelKeys(
      " p_query: `select ${col}`, p_limit: 10 ",
    );
    expect(keys).toContain("p_query");
    expect(keys).toContain("p_limit");
    expect(keys).toHaveLength(2);
  });

  it("handles function call values", () => {
    const keys = mod.extractTopLevelKeys(
      " p_id: getId(), p_date: new Date().toISOString() ",
    );
    expect(keys).toContain("p_id");
    expect(keys).toContain("p_date");
    expect(keys).toHaveLength(2);
  });

  it("handles empty input", () => {
    expect(mod.extractTopLevelKeys("")).toHaveLength(0);
  });

  it("handles value with array brackets", () => {
    const keys = mod.extractTopLevelKeys(
      " p_ids: [1, 2, 3], p_name: 'test' ",
    );
    expect(keys).toContain("p_ids");
    expect(keys).toContain("p_name");
    expect(keys).toHaveLength(2);
  });
});

// ============================================================================
// 7. scanFrontendRpcCalls — integration
// ============================================================================
describe("scanFrontendRpcCalls — integration", () => {
  it("finds RPC calls in src/hooks", () => {
    const hooksDir = path.join(ROOT, "src/hooks");
    const calls = mod.scanFrontendRpcCalls(hooksDir);
    expect(calls.length).toBeGreaterThan(50);
  });

  it("every call has required fields", () => {
    const hooksDir = path.join(ROOT, "src/hooks");
    const calls = mod.scanFrontendRpcCalls(hooksDir);
    for (const call of calls) {
      expect(call.file).toBeTruthy();
      expect(call.function).toBeTruthy();
      expect(typeof call.line).toBe("number");
      expect(Array.isArray(call.params)).toBe(true);
    }
  });

  it("does not scan test files", () => {
    const calls = mod.scanFrontendRpcCalls(path.join(ROOT, "src"));
    const testCalls = calls.filter(
      (c: RpcCall) => c.file.includes(".test.") || c.file.includes("__tests__"),
    );
    expect(testCalls).toHaveLength(0);
  });
});

// ============================================================================
// 8. Contract validation — every hook param matches SQL
// ============================================================================
describe("Contract validation — full codebase", () => {
  it("source-of-truth report has 0 WRONG_PARAM errors", () => {
    const report: AnalyzerReport = JSON.parse(
      fs.readFileSync(REPORT_PATH, "utf-8"),
    );
    const wrongParams = report.details.filter(
      (d) => d.type === "WRONG_PARAM",
    );
    expect(
      wrongParams,
      `WRONG_PARAM violations:\n${wrongParams.map((d) => `  ${d.location}:${d.line} — ${d.message}`).join("\n")}`,
    ).toHaveLength(0);
  });

  it("source-of-truth report has 0 MISSING_REQUIRED_PARAM errors", () => {
    const report: AnalyzerReport = JSON.parse(
      fs.readFileSync(REPORT_PATH, "utf-8"),
    );
    const missing = report.details.filter(
      (d) => d.type === "MISSING_REQUIRED_PARAM",
    );
    expect(
      missing,
      `MISSING_REQUIRED_PARAM violations:\n${missing.map((d) => `  ${d.location}:${d.line} — ${d.message}`).join("\n")}`,
    ).toHaveLength(0);
  });
});

// ============================================================================
// 9. Migration idempotency — all CREATE POLICY/TRIGGER have DROP IF EXISTS
// ============================================================================
describe("Migration idempotency", () => {
  const migrationsDir = path.join(ROOT, "aisha/db/migrations");
  const migrationFiles = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"))
    : [];

  it("has migration files", () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
  });

  it("CREATE POLICY statements are idempotent (DROP IF EXISTS or EXCEPTION WHEN duplicate_object)", () => {
    const violations: string[] = [];

    for (const file of migrationFiles) {
      const content = fs.readFileSync(
        path.join(migrationsDir, file),
        "utf-8",
      );
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*CREATE\s+POLICY\b/i.test(line)) {
          // Check that somewhere before this line (within 5 lines) there's DROP POLICY IF EXISTS
          const policyName = line.match(/CREATE\s+POLICY\s+(?:"([^"]+)"|(\w+))/i);
          const name = policyName?.[1] ?? policyName?.[2] ?? "";
          if (!name) continue;

          const prevLines = lines.slice(Math.max(0, i - 5), i).join("\n");
          const nextLines = lines.slice(i, Math.min(lines.length, i + 8)).join("\n");

          const hasDropIfExists = new RegExp(
            `DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+(?:"${name}"|${name})`,
            "i",
          ).test(prevLines);

          // Also accept DO $$ BEGIN ... EXCEPTION WHEN duplicate_object pattern
          const hasExceptionHandler =
            /DO\s+\$\$\s*BEGIN/i.test(prevLines) &&
            /EXCEPTION\s+WHEN\s+duplicate_object/i.test(nextLines);

          if (!hasDropIfExists && !hasExceptionHandler) {
            violations.push(`${file}:${i + 1} — CREATE POLICY "${name}" without idempotency guard`);
          }
        }
      }
    }

    const recentViolations = violations.filter((v) => {
      const ts = v.match(/^(\d{14})/);
      return ts && ts[1] >= "20260410000000";
    });

    expect(
      recentViolations,
      `Recent migrations with non-idempotent CREATE POLICY:\n${recentViolations.join("\n")}`,
    ).toHaveLength(0);
  });
});

// ============================================================================
// 10. Extension governance support
// ============================================================================
describe("Extension governance commands", () => {
  const extPkg = path.resolve(
    ROOT,
    "extensions/aisha-dirigent/package.json",
  );
  const extParticipant = path.resolve(
    ROOT,
    "extensions/aisha-dirigent/src/participant.ts",
  );

  it("extension has /quality command", () => {
    const pkg = JSON.parse(fs.readFileSync(extPkg, "utf-8"));
    const commands = pkg.contributes?.chatParticipants?.[0]?.commands ?? [];
    const qualityCmd = commands.find(
      (c: { name: string }) => c.name === "quality",
    );
    expect(qualityCmd, "Missing /quality command in extension").toBeDefined();
  });

  it("extension has /compliance command", () => {
    const pkg = JSON.parse(fs.readFileSync(extPkg, "utf-8"));
    const commands = pkg.contributes?.chatParticipants?.[0]?.commands ?? [];
    const complianceCmd = commands.find(
      (c: { name: string }) => c.name === "compliance",
    );
    expect(
      complianceCmd,
      "Missing /compliance command in extension",
    ).toBeDefined();
  });

  it("participant.ts has handleQuality function", () => {
    const content = fs.readFileSync(extParticipant, "utf-8");
    expect(content).toContain("handleQuality");
  });

  it("participant.ts has handleCompliance function", () => {
    const content = fs.readFileSync(extParticipant, "utf-8");
    expect(content).toContain("handleCompliance");
  });

  it("quality handler calls MCP assess_quality as fallback", () => {
    const content = fs.readFileSync(extParticipant, "utf-8");
    expect(content).toContain("assess_quality");
  });

  it("compliance handler calls MCP validate_compliance as fallback", () => {
    const content = fs.readFileSync(extParticipant, "utf-8");
    expect(content).toContain("validate_compliance");
  });
});
