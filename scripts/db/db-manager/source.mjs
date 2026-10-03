#!/usr/bin/env node
/**
 * DB Manager — Source of Truth Analyzer
 *
 * Scans aisha/db/sql/functions/ and src/ to verify that frontend RPC calls
 * match SQL function signatures. Generates a JSON report at
 * docs/db-structure/source-truth-report.json
 *
 * Usage:
 *   node scripts/db/db-manager/source.mjs
 *   npm run db-mgr:source
 *
 * No database connection required — works entirely from source files.
 *
 * @module
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReportOutput } from "./lib/reportPaths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const SQL_DIR = path.join(ROOT, "aisha", "db", "sql", "functions");
const SRC_DIR = path.join(ROOT, "src");
const { reportDir: REPORT_DIR, reportPath: REPORT_PATH } = resolveReportOutput(
  ROOT,
  "source-truth-report.json",
);

/* ---------- SQL function parser ---------- */

/**
 * Extract function name and parameter names from a SQL function file.
 * Parses both the header comment and CREATE FUNCTION statement.
 */
function parseSqlFunction(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const fileName = path.basename(filePath, ".sql");

  // Extract function name from CREATE FUNCTION
  const createMatch = content.match(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(/i
  );
  const funcName = createMatch ? createMatch[1] : fileName;

  // Extract parameters using balanced parentheses matching
  // (handles DEFAULT NOW(), COALESCE(), etc.)
  const params = [];
  if (createMatch) {
    const openParenIdx = content.indexOf("(", createMatch.index + createMatch[0].length - 1);
    if (openParenIdx !== -1) {
      let depth = 0;
      let endIdx = -1;
      for (let i = openParenIdx; i < content.length; i++) {
        if (content[i] === "(") depth++;
        else if (content[i] === ")") {
          depth--;
          if (depth === 0) { endIdx = i; break; }
        }
      }
      if (endIdx !== -1) {
        let paramStr = content.substring(openParenIdx + 1, endIdx);
        // Strip SQL single-line comments to avoid false comma/string matches
        paramStr = paramStr.replace(/--[^\n]*/g, "");
        // Split on commas, handling nested parens (), brackets [], and string literals
        let parenDepth = 0;
        let bracketDepth = 0;
        let inString = false;
        let stringChar = "";
        let current = "";
        for (let i = 0; i < paramStr.length; i++) {
          const ch = paramStr[i];
          if (inString) {
            current += ch;
            if (ch === stringChar && paramStr[i - 1] !== "\\") {
              inString = false;
            }
            continue;
          }
          if (ch === "'" || ch === '"') {
            inString = true;
            stringChar = ch;
            current += ch;
            continue;
          }
          if (ch === "(") parenDepth++;
          else if (ch === ")") parenDepth--;
          else if (ch === "[") bracketDepth++;
          else if (ch === "]") bracketDepth--;
          else if (ch === "," && parenDepth === 0 && bracketDepth === 0) {
            if (current.trim()) params.push(parseParam(current.trim()));
            current = "";
            continue;
          }
          current += ch;
        }
        if (current.trim()) params.push(parseParam(current.trim()));
      }
    }
  }

  // Extract security model
  const isSecurityDefiner = /SECURITY\s+DEFINER/i.test(content);
  const hasAuthUid = /auth\.uid\(\)/i.test(content);
  const hasSearchPath = /SET\s+search_path/i.test(content);
  const hasAnonGrant = /GRANT\s+EXECUTE.*TO\s+anon/i.test(content);
  const hasConsentCheck = /has_data_sharing_consent/i.test(content);

  // Detect sensitive data tables (health-related)
  const phiTables = [
    "health_check_ins", "lab_results", "medications", "medical_records",
    "health_goals", "biometric_data", "treatment_plans",
  ];
  const accessesPhiData = phiTables.some((t) =>
    new RegExp(`\\b${t}\\b`, "i").test(content)
  );

  return {
    name: funcName,
    fileName,
    params,
    isSecurityDefiner,
    hasAuthUid,
    hasSearchPath,
    hasAnonGrant,
    hasConsentCheck,
    accessesPhiData,
  };
}

function parseParam(paramStr) {
  // Format: [IN|OUT|INOUT] name type [DEFAULT value]
  const parts = paramStr.split(/\s+/);
  let name = parts[0];
  let type = parts.slice(1).join(" ");
  let hasDefault = false;

  // Skip IN/OUT/INOUT modifier
  if (/^(IN|OUT|INOUT)$/i.test(name) && parts.length > 1) {
    name = parts[1];
    type = parts.slice(2).join(" ");
  }

  // Check for DEFAULT
  const defaultIdx = type.toUpperCase().indexOf(" DEFAULT ");
  if (defaultIdx >= 0) {
    hasDefault = true;
    type = type.substring(0, defaultIdx).trim();
  } else if (type.toUpperCase().indexOf("DEFAULT ") === 0) {
    hasDefault = true;
    type = "";
  }

  return { name, type, hasDefault };
}

/* ---------- Frontend RPC scanner ---------- */

/**
 * Extract balanced braces block starting at the given index.
 * @param {string} content - Source code
 * @param {number} startIdx - Index of the opening `{`
 * @returns {string|null} Content between outermost braces (exclusive), or null if unbalanced.
 */
function extractBalancedBraces(content, startIdx) {
  if (content[startIdx] !== "{") return null;
  let depth = 0;
  for (let i = startIdx; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) return content.substring(startIdx + 1, i);
    }
  }
  return null;
}

/**
 * Extract only top-level object keys from a params block.
 * Tracks brace/paren/bracket depth and string literals to avoid extracting
 * keys from nested objects, ternary expressions, or value sub-expressions.
 * For each comma-separated segment, only the FIRST word:colon pattern is
 * taken as the property key — subsequent colons (ternary operators) are ignored.
 *
 * @param {string} paramsContent - The inner content of the params object literal
 * @returns {string[]} Array of parameter key names
 */
function extractTopLevelKeys(paramsContent) {
  const keys = [];
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let stringChar = "";
  let word = "";
  let foundKey = false; // true after extracting a key in the current comma-segment

  for (let i = 0; i < paramsContent.length; i++) {
    const ch = paramsContent[i];

    // Handle string literals (single, double, and template)
    if (inString) {
      if (ch === stringChar && paramsContent[i - 1] !== "\\") inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      stringChar = ch;
      word = "";
      continue;
    }

    // Track nesting depth
    if (ch === "{") { braceDepth++; word = ""; continue; }
    if (ch === "}") { braceDepth--; word = ""; continue; }
    if (ch === "(") { parenDepth++; word = ""; continue; }
    if (ch === ")") { parenDepth--; word = ""; continue; }
    if (ch === "[") { bracketDepth++; word = ""; continue; }
    if (ch === "]") { bracketDepth--; word = ""; continue; }

    const atTopLevel = braceDepth === 0 && parenDepth === 0 && bracketDepth === 0;

    if (atTopLevel) {
      // Comma starts a new property segment
      if (ch === ",") {
        foundKey = false;
        word = "";
        continue;
      }

      // Only take the first word:colon in each segment (skip ternary colons)
      if (!foundKey && ch === ":" && word) {
        keys.push(word);
        foundKey = true;
        word = "";
      } else if (/[a-zA-Z_$0-9]/.test(ch)) {
        word += ch;
      } else {
        word = "";
      }
    } else {
      word = "";
    }
  }
  return keys;
}

/**
 * Recursively scan .ts/.tsx files for supabase.rpc() calls.
 */
function scanFrontendRpcCalls(dir, results = []) {
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      // Skip test files
      if (entry.name === "tests" || entry.name === "__tests__") continue;
      scanFrontendRpcCalls(full, results);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.") && !entry.name.includes(".spec.")) {
      const content = readFileSync(full, "utf-8");
      const relPath = path.relative(ROOT, full);

      // Step 1: Find .rpc("function_name" — then look for optional params block
      const rpcStartRegex = /\.rpc\(\s*["'](\w+)["']\s*/g;
      let match;
      while ((match = rpcStartRegex.exec(content)) !== null) {
        const funcName = match[1];
        const afterName = match.index + match[0].length;

        let paramNames = [];
        let endIdx = afterName;

        // Check if there's a comma + params block, or just closing paren
        const rest = content.substring(afterName);
        if (rest.startsWith(",")) {
          // Find the opening brace of the params object
          const braceIdx = content.indexOf("{", afterName);
          if (braceIdx !== -1 && braceIdx - afterName < 20) {
            const paramsContent = extractBalancedBraces(content, braceIdx);
            if (paramsContent !== null) {
              paramNames = extractTopLevelKeys(paramsContent);
              endIdx = braceIdx + paramsContent.length + 2; // past closing }
            }
          }
        }

        // Advance regex past the full match to avoid re-matching
        rpcStartRegex.lastIndex = endIdx;

        // Find line number
        const linesBefore = content.substring(0, match.index).split("\n");
        const line = linesBefore.length;

        results.push({
          file: relPath,
          line,
          function: funcName,
          params: paramNames,
        });
      }
    }
  }
  return results;
}

/* ---------- Analysis ---------- */

function analyze(isCli = false) {
  console.log("🔍 Source of Truth Analyzer\n");

  // 1. Parse all SQL functions
  const sqlFunctions = new Map();
  if (existsSync(SQL_DIR)) {
    const files = readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql"));
    console.log(`  📄 Found ${files.length} SQL function files`);
    for (const file of files) {
      const func = parseSqlFunction(path.join(SQL_DIR, file));
      sqlFunctions.set(func.name, func);
    }
  } else {
    console.warn("  ⚠️  SQL functions directory not found");
  }

  // 2. Scan frontend RPC calls
  const rpcCalls = scanFrontendRpcCalls(SRC_DIR);
  console.log(`  🔗 Found ${rpcCalls.length} frontend RPC calls`);

  // 3. Compare and find issues
  const details = [];

  for (const call of rpcCalls) {
    const func = sqlFunctions.get(call.function);

    if (!func) {
      // Function doesn't exist in source of truth — might be in migrations only
      continue;
    }

    // Check parameter names
    const sqlParamNames = func.params
      .filter((p) => !p.name.startsWith("OUT"))
      .map((p) => p.name);

    for (const frontendParam of call.params) {
      if (!sqlParamNames.includes(frontendParam)) {
        details.push({
          type: "WRONG_PARAM",
          severity: "error",
          function: call.function,
          location: call.file,
          line: call.line,
          parameter: frontendParam,
          expected: sqlParamNames,
          message: `Frontend passes "${frontendParam}" but SQL function "${call.function}" expects [${sqlParamNames.join(", ")}]`,
        });
      }
    }

    // Check required params (non-DEFAULT) are provided
    const requiredParams = func.params
      .filter((p) => !p.hasDefault && !p.name.startsWith("OUT"))
      .map((p) => p.name);

    for (const reqParam of requiredParams) {
      if (call.params.length > 0 && !call.params.includes(reqParam)) {
        details.push({
          type: "MISSING_REQUIRED_PARAM",
          severity: "error",
          function: call.function,
          location: call.file,
          line: call.line,
          parameter: reqParam,
          message: `Required parameter "${reqParam}" not found in frontend call to "${call.function}"`,
        });
      }
    }

    // Check sensitive data consent
    if (func.accessesPhiData && !func.hasConsentCheck && func.isSecurityDefiner) {
      // Only flag if the function accesses OTHER users' data (has a user_id param)
      const hasUserIdParam = func.params.some((p) =>
        /user_id|p_user_id|target_user/i.test(p.name)
      );
      if (hasUserIdParam) {
        details.push({
          type: "PHI_NO_CONSENT_CHECK",
          severity: "warning",
          function: call.function,
          location: call.file,
          line: call.line,
          message: `Function "${call.function}" accesses sensitive data with user_id param but has no consent check`,
        });
      }
    }
  }

  // Deduplicate by function + type
  const seen = new Set();
  const uniqueDetails = details.filter((d) => {
    const key = `${d.type}:${d.function}:${d.parameter || ""}:${d.location}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Summary
  const summary = {
    totalSqlFunctions: sqlFunctions.size,
    totalRpcCalls: rpcCalls.length,
    issues: {
      critical: uniqueDetails.filter((d) => d.severity === "critical").length,
      errors: uniqueDetails.filter((d) => d.severity === "error").length,
      warnings: uniqueDetails.filter((d) => d.severity === "warning").length,
    },
  };

  const report = {
    generatedAt: new Date().toISOString(),
    analyzer: "db-mgr:source",
    version: "1.0.0",
    summary,
    details: uniqueDetails,
  };

  // Write report
  if (!existsSync(REPORT_DIR)) {
    mkdirSync(REPORT_DIR, { recursive: true });
  }
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf-8");

  // Console output
  console.log(`\n📊 Results:`);
  console.log(`  SQL functions: ${summary.totalSqlFunctions}`);
  console.log(`  Frontend RPC calls: ${summary.totalRpcCalls}`);
  console.log(`  Errors: ${summary.issues.errors}`);
  console.log(`  Warnings: ${summary.issues.warnings}`);
  console.log(`\n📝 Report: ${path.relative(ROOT, REPORT_PATH)}`);

  // Exit with error only on critical issues (only when run as CLI)
  if (isCli) {
    if (summary.issues.critical > 0) {
      process.exit(2);
    }
    if (summary.issues.errors > 0) {
      process.exit(1);
    }
    process.exit(0);
  }

  return report;
}

/* ---------- Exports for programmatic use ---------- */
export {
  parseSqlFunction,
  parseParam,
  extractBalancedBraces,
  extractTopLevelKeys,
  scanFrontendRpcCalls,
  analyze,
};

/* ---------- CLI entry ---------- */
const isCli =
  process.argv[1] &&
  (process.argv[1].endsWith("source.mjs") ||
   process.argv[1].endsWith("source"));

if (isCli) {
  analyze(true);
}
