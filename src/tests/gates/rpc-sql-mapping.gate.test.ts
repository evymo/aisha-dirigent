/**
 * RPC ↔ SQL Mapping Gate Test
 *
 * Validates that every supabase.rpc("function_name") call from frontend hooks,
 * mobile app, and edge functions has a corresponding SQL function file in the
 * source of truth (aisha/db/sql/functions/).
 *
 * Detects:
 * - Phantom RPC calls (hooks calling SQL functions that don't exist in SoT)
 * - Drift between frontend code and database layer
 *
 * Does NOT fail on orphaned SQL functions — many are legitimately called from
 * triggers, RLS policies, n8n workflows, or other SQL functions.
 *
 * Run: npm run test:gates -- src/tests/gates/rpc-sql-mapping.gate.test.ts
 *
 * @module
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const SQL_FUNCTIONS_DIR = path.join(ROOT, "aisha/db/sql/functions");

const SCAN_DIRS = [
  path.join(ROOT, "src/hooks"),
  path.join(ROOT, "src/components"),
  path.join(ROOT, "src/pages"),
  path.join(ROOT, "src/integrations"),
  path.join(ROOT, "mobile-app/src"),
  path.join(ROOT, "services"),
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

const SKIP_PATTERNS = [
  "node_modules",
  ".test.",
  ".spec.",
  "__tests__",
  "types.ts",
  // Skip gate test files themselves — they contain .rpc("function_name") in comments/examples
  ".gate.test.",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect source files, skipping tests and node_modules */
function collectFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      if (entry.name === "tests" || entry.name === "__tests__") continue;
      result.push(...collectFiles(full));
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      !SKIP_PATTERNS.some((p) => entry.name.includes(p))
    ) {
      result.push(full);
    }
  }
  return result;
}

/** Extract all RPC function names from supabase.rpc() and v2 rpcService() calls in source files */
function extractRpcCallNames(files: string[]): Map<string, string[]> {
  const rpcMap = new Map<string, string[]>();
  // Matches:
  //   .rpc("fn"  |  .rpc('fn'     (frontend supabase shim)
  //   rpcService<T>('fn' | rpcService('fn' | rpcUser<T>('fn' | rpcUser('fn'    (v2 microservice helpers)
  // ⛔ NAMĚŘENO 2026-09-29 (SELF_IMPROVEMENT_LOOP.md K-18): generický argument `<[^>]*>`
  // nerozebral vnořený generik — `rpcService<Array<{ id: string }>>('fn')` se nezachytil
  // vůbec, takže volání neexistující RPC (get_golden_examples_for_eval) prošlo zeleně.
  // Teď líné `<…>` do nejbližšího `>` těsně před `(`, bez středníku, nejvýš 400 znaků.
  const rpcPattern = /(?:\.rpc\(|\brpc(?:Service|User)\s*(?:<[^;]{0,400}?>)?\s*\()\s*["'](\w+)["']/g;

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    let match: RegExpExecArray | null = rpcPattern.exec(content);
    while (match !== null) {
      const fnName = match[1];
      const relativePath = path.relative(ROOT, file);
      if (!rpcMap.has(fnName)) {
        rpcMap.set(fnName, []);
      }
      rpcMap.get(fnName)!.push(relativePath);
      match = rpcPattern.exec(content);
    }
    // Reset lastIndex for next file (global regex)
    rpcPattern.lastIndex = 0;
  }

  return rpcMap;
}

/** Get all SQL function names from aisha/db/sql/functions/ directory */
function getSqlFunctionNames(): Set<string> {
  if (!fs.existsSync(SQL_FUNCTIONS_DIR)) return new Set();
  return new Set(
    fs.readdirSync(SQL_FUNCTIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, "")),
  );
}

/**
 * Functions that are legitimately dynamic (e.g. constructed at runtime).
 * All RPC calls MUST have a corresponding SoT SQL file — NO allowlisting.
 */
const KNOWN_DYNAMIC_FUNCTIONS = new Set<string>([]);

/**
 * V2 microservice RPC backlog — functions called from services/svc-* that
 * have no SQL SoT file yet. Tracked in docs/tasks/v2-missing-rpc-functions.md.
 * When an SQL function is implemented, REMOVE its name from this set so the
 * gate test resumes enforcing full coverage.
 *
 * Do NOT use this set to paper over phantom RPC calls in frontend / hooks —
 * only v2 Fastify microservices are allowed here during the migration cutover.
 */
const V2_PENDING_RPC_FUNCTIONS = new Set<string>([
  // Odhaleno opravou regexu 2026-09-29 (SELF_IMPROVEMENT_LOOP.md K-18): volání s vnořeným
  // generikem brána dřív neviděla. SoT neexistuje → vydání tokenu hlasové místnosti a
  // nahrávání (svc-livekit) a jméno v Matrixu (svc-matrix) volají RPC, které v DB nejsou.
  // Samostatná oprava mimo samoučení; tady jen evidence, ať brána hlídá všechno ostatní.
  "get_consultation_session",
  "get_voice_room_by_livekit_name",
  "check_story_membership",
  "get_profile_display_name",
  "verify_app_attestation",
  "edge_database_dump",
  "resolve_vulnerability",
  "get_vulnerability_scan_results",
  "auth_get_current_user_id",
  "proactive_evaluate_triggers",
  "proactive_get_stats",
  "proactive_get_my_stats",
  "get_reward_claim",
  "fulfill_reward_claim",
  "update_blockchain_audit_status",
  "get_user_cosmos_address",
  "upsert_github_app_repositories",
  "deactivate_github_app_repositories",
  "update_consultation_recording_egress",
  "upsert_call_participant",
  "clear_knowledge_item_chunks",
  "insert_knowledge_chunk",
  "insert_knowledge_embedding",
  "create_shipment_record",
  "plugin_kv_get",
  "plugin_kv_set",
  "plugin_kv_delete",
]);

const SERVICES_DIR_PREFIX = "services/";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RPC ↔ SQL Mapping Integrity", () => {
  let rpcCallMap: Map<string, string[]>;
  let sqlFunctions: Set<string>;

  beforeAll(() => {
    const sourceFiles = SCAN_DIRS.flatMap((dir) => collectFiles(dir));
    rpcCallMap = extractRpcCallNames(sourceFiles);
    sqlFunctions = getSqlFunctionNames();
  });

  it("scans a non-trivial number of RPC calls", () => {
    expect(rpcCallMap.size).toBeGreaterThan(100);
  });

  it("has a non-trivial number of SQL functions in SoT", () => {
    expect(sqlFunctions.size).toBeGreaterThan(500);
  });

  it("every frontend RPC call has a corresponding SQL function file in SoT", () => {
    const phantomCalls: string[] = [];

    for (const [fnName, callers] of rpcCallMap.entries()) {
      if (KNOWN_DYNAMIC_FUNCTIONS.has(fnName)) continue;
      if (!sqlFunctions.has(fnName)) {
        // v2 microservice backlog: allow pending RPCs ONLY when callers are
        // all inside services/svc-* (tracked in docs/tasks/v2-missing-rpc-functions.md).
        const allFromServices = callers.every((c) => c.startsWith(SERVICES_DIR_PREFIX));
        if (V2_PENDING_RPC_FUNCTIONS.has(fnName) && allFromServices) continue;
        phantomCalls.push(
          `${fnName} — called from: ${callers.slice(0, 3).join(", ")}${callers.length > 3 ? ` (+${callers.length - 3} more)` : ""}`,
        );
      }
    }

    expect(
      phantomCalls,
      `Phantom RPC calls (no SQL SoT file):\n${phantomCalls.join("\n")}`,
    ).toHaveLength(0);
  });

  it("orphaned SQL function ratio is within acceptable range", () => {
    // Many SQL functions are used by triggers, RLS policies, n8n workflows,
    // or other SQL functions — not all are called directly from frontend.
    // We only warn if orphan ratio exceeds 80%.
    const calledFromFrontend = new Set(rpcCallMap.keys());
    let orphanCount = 0;
    for (const fn of sqlFunctions) {
      if (!calledFromFrontend.has(fn)) orphanCount++;
    }
    const orphanRatio = orphanCount / sqlFunctions.size;

    // Informational: log the ratio
    expect(
      orphanRatio,
      `Orphan ratio ${(orphanRatio * 100).toFixed(1)}% exceeds 80% — review if SQL functions are actually used`,
    ).toBeLessThan(0.80);
  });
});
