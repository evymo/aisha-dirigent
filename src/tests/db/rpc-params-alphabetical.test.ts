/**
 * @file RPC Parameters Alphabetical Order Validation
 * @description Validates that ALL RPC calls use parameters in alphabetical order.
 * 
 * WHY THIS MATTERS:
 * - TypeScript types are generated in alphabetical order from DB
 * - If function signature in DB has different order, RPC calls fail with "function not found"
 * - This caused 96+ Sentry errors on iOS (PLATFORMBYRTN-IOS-5, PLATFORMBYRTN-IOS-M)
 * 
 * PRINCIPLE: All RPC parameters must be in alphabetical order, everywhere.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");

interface RpcCall {
  file: string;
  line: number;
  functionName: string;
  params: string[];
  context: string;
}

interface ValidationError {
  file: string;
  line: number;
  functionName: string;
  issue: string;
  found: string[];
  expected: string[];
  context: string;
}

/**
 * Extract RPC calls from TypeScript/JavaScript file content
 */
function extractRpcCallsFromTs(content: string, filePath: string): RpcCall[] {
  const calls: RpcCall[] = [];
  const lines = content.split("\n");

  // Pattern: .rpc with named function (e.g. "my_func") and params object
  // We need to find multi-line RPC calls
  // Improved regex to avoid matching comment examples
  const rpcStartPattern = /\.rpc\s*\(\s*["'](?!(?:function_name))(\w+)["']\s*,\s*\{/;

  let inRpcCall = false;
  let currentCall: { functionName: string; startLine: number; content: string } | null = null;
  let braceCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inRpcCall) {
      const match = line.match(rpcStartPattern);
      if (match) {
        inRpcCall = true;
        currentCall = {
          functionName: match[1],
          startLine: i + 1,
          content: line,
        };
        // Count braces in this line
        braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

        // Check if call ends on same line
        if (braceCount <= 0) {
          inRpcCall = false;
          if (currentCall) {
            const params = extractParamsFromBlock(currentCall.content);
            if (params.length > 0) {
              calls.push({
                file: filePath,
                line: currentCall.startLine,
                functionName: currentCall.functionName,
                params,
                context: currentCall.content.slice(0, 200),
              });
            }
          }
          currentCall = null;
        }
      }
    } else if (currentCall) {
      currentCall.content += "\n" + line;
      braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

      if (braceCount <= 0) {
        inRpcCall = false;
        const params = extractParamsFromBlock(currentCall.content);
        if (params.length > 0) {
          calls.push({
            file: filePath,
            line: currentCall.startLine,
            functionName: currentCall.functionName,
            params,
            context: currentCall.content.slice(0, 200),
          });
        }
        currentCall = null;
      }
    }
  }

  return calls;
}

/**
 * Extract parameter names from RPC call block (TypeScript format: key: value)
 * Only extracts top-level p_* parameters from the params object
 */
function extractParamsFromBlock(block: string): string[] {
  const params: string[] = [];

  // Find the params object content (between first { after function name and matching })
  const rpcMatch = block.match(/\.rpc\s*\(\s*["'`]\w+["'`]\s*,\s*\{([\s\S]*)\}\s*\)/);
  if (!rpcMatch) {
    // Fallback for simpler pattern
    const objMatch = block.match(/\{([\s\S]*)\}/);
    if (!objMatch) return params;
    return extractTopLevelParams(objMatch[1]);
  }

  return extractTopLevelParams(rpcMatch[1]);
}

/**
 * Extract top-level p_* params from object content
 */
function extractTopLevelParams(objContent: string): string[] {
  const params: string[] = [];

  // Track depth to only get top-level params
  let depth = 0;
  let lineStart = 0;

  for (let i = 0; i < objContent.length; i++) {
    const char = objContent[i];

    if (char === '{' || char === '[' || char === '(') {
      depth++;
    } else if (char === '}' || char === ']' || char === ')') {
      depth--;
    } else if ((char === ',' || char === '\n') && depth === 0) {
      // Check segment for param
      const segment = objContent.slice(lineStart, i);
      const match = segment.match(/^\s*(p_\w+)\s*:/);
      if (match && !params.includes(match[1])) {
        params.push(match[1]);
      }
      lineStart = i + 1;
    }
  }

  // Check last segment
  const lastSegment = objContent.slice(lineStart);
  const lastMatch = lastSegment.match(/^\s*(p_\w+)\s*:/);
  if (lastMatch && !params.includes(lastMatch[1])) {
    params.push(lastMatch[1]);
  }

  return params;
}

/**
 * Extract RPC calls from SQL file content (PERFORM function(...) or SELECT function(...))
 */
function extractRpcCallsFromSql(content: string, filePath: string): RpcCall[] {
  const calls: RpcCall[] = [];
  const lines = content.split("\n");

  // Pattern: PERFORM function_name( or SELECT function_name(
  const rpcStartPattern = /(?:PERFORM|SELECT)\s+(?:public\.)?(\w+)\s*\(/i;

  let inRpcCall = false;
  let currentCall: { functionName: string; startLine: number; content: string } | null = null;
  let parenCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inRpcCall) {
      const match = line.match(rpcStartPattern);
      if (match) {
        // Skip built-in functions
        const funcName = match[1].toLowerCase();
        if (["jsonb_build_object", "coalesce", "now", "gen_random_uuid", "auth", "row_to_json"].includes(funcName)) {
          continue;
        }

        inRpcCall = true;
        currentCall = {
          functionName: match[1],
          startLine: i + 1,
          content: line,
        };
        parenCount = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;

        if (parenCount <= 0) {
          inRpcCall = false;
          if (currentCall) {
            const params = extractSqlParams(currentCall.content);
            if (params.length > 0) {
              calls.push({
                file: filePath,
                line: currentCall.startLine,
                functionName: currentCall.functionName,
                params,
                context: currentCall.content.slice(0, 200),
              });
            }
          }
          currentCall = null;
        }
      }
    } else if (currentCall) {
      currentCall.content += "\n" + line;
      parenCount += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;

      if (parenCount <= 0) {
        inRpcCall = false;
        const params = extractSqlParams(currentCall.content);
        if (params.length > 0) {
          calls.push({
            file: filePath,
            line: currentCall.startLine,
            functionName: currentCall.functionName,
            params,
            context: currentCall.content.slice(0, 200),
          });
        }
        currentCall = null;
      }
    }
  }

  return calls;
}

/**
 * Extract parameter names from SQL call (p_name := value format)
 */
function extractSqlParams(block: string): string[] {
  const params: string[] = [];
  const paramPattern = /(p_\w+)\s*:=/g;

  let match;
  while ((match = paramPattern.exec(block)) !== null) {
    if (!params.includes(match[1])) {
      params.push(match[1]);
    }
  }

  return params;
}

/**
 * Validate that parameters are in alphabetical order
 */
function validateAlphabeticalOrder(calls: RpcCall[]): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const call of calls) {
    if (call.params.length < 2) continue; // Nothing to sort with < 2 params

    const sorted = [...call.params].sort((a, b) => a.localeCompare(b, "en"));

    if (JSON.stringify(call.params) !== JSON.stringify(sorted)) {
      errors.push({
        file: call.file,
        line: call.line,
        functionName: call.functionName,
        issue: "Parameters not in alphabetical order",
        found: call.params,
        expected: sorted,
        context: call.context,
      });
    }
  }

  return errors;
}

/**
 * Recursively find files matching pattern
 */
function findFiles(dir: string, pattern: RegExp, exclude: RegExp[] = []): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (exclude.some(ex => ex.test(fullPath))) continue;

    if (entry.isDirectory()) {
      files.push(...findFiles(fullPath, pattern, exclude));
    } else if (pattern.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("RPC Parameters Alphabetical Order", () => {

  it("Frontend hooks must use RPC parameters in alphabetical order", () => {
    const hooksDir = path.join(ROOT, "src/hooks");
    const files = findFiles(hooksDir, /\.tsx?$/, [/\.test\./]);

    const allCalls: RpcCall[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      if (!content.includes(".rpc(")) continue;

      const calls = extractRpcCallsFromTs(content, path.relative(ROOT, file));
      allCalls.push(...calls);
    }

    const errors = validateAlphabeticalOrder(allCalls);

    if (errors.length > 0) {
      const errorReport = errors
        .map(e => `  ${e.file}:${e.line} (${e.functionName})\n    Found: [${e.found.join(", ")}]\n    Expected: [${e.expected.join(", ")}]`)
        .join("\n\n");

      expect.fail(
        `Found ${errors.length} RPC call(s) with incorrect parameter order in hooks:\n\n${errorReport}\n\n` +
        `All RPC parameters must be in alphabetical order.`
      );
    }
  });

  it("Frontend lib must use RPC parameters in alphabetical order", () => {
    const libDir = path.join(ROOT, "src/lib");
    const files = findFiles(libDir, /\.tsx?$/, [/\.test\./]);

    const allCalls: RpcCall[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      if (!content.includes(".rpc(")) continue;

      const calls = extractRpcCallsFromTs(content, path.relative(ROOT, file));
      allCalls.push(...calls);
    }

    const errors = validateAlphabeticalOrder(allCalls);

    if (errors.length > 0) {
      const errorReport = errors
        .map(e => `  ${e.file}:${e.line} (${e.functionName})\n    Found: [${e.found.join(", ")}]\n    Expected: [${e.expected.join(", ")}]`)
        .join("\n\n");

      expect.fail(
        `Found ${errors.length} RPC call(s) with incorrect parameter order in lib:\n\n${errorReport}\n\n` +
        `All RPC parameters must be in alphabetical order.`
      );
    }
  });

  it("Edge Functions must use RPC parameters in alphabetical order", () => {
    const functionsDir = path.join(ROOT, "trash/legacy-archive/edge-functions-reference");
    const files = findFiles(functionsDir, /\.ts$/, [/\.test\./, /_shared/]);

    const allCalls: RpcCall[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      if (!content.includes(".rpc(")) continue;

      const calls = extractRpcCallsFromTs(content, path.relative(ROOT, file));
      allCalls.push(...calls);
    }

    const errors = validateAlphabeticalOrder(allCalls);

    if (errors.length > 0) {
      const errorReport = errors
        .map(e => `  ${e.file}:${e.line} (${e.functionName})\n    Found: [${e.found.join(", ")}]\n    Expected: [${e.expected.join(", ")}]`)
        .join("\n\n");

      expect.fail(
        `Found ${errors.length} RPC call(s) with incorrect parameter order in Edge Functions:\n\n${errorReport}\n\n` +
        `All RPC parameters must be in alphabetical order.`
      );
    }
  });

  it("SQL functions calling other functions must use named parameters in alphabetical order", () => {
    const sqlDir = path.join(ROOT, "aisha/db/sql/functions");
    const files = findFiles(sqlDir, /\.sql$/);

    const allCalls: RpcCall[] = [];

    // Known internal functions that call other functions with params
    const internalFunctions = [
      "write_audit_journal",
      "award_tokens",
      "update_user_streak",
      "process_token_reward",
    ];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");

      // Check if this file calls any of our internal functions
      for (const funcName of internalFunctions) {
        if (content.includes(`${funcName}(`)) {
          const calls = extractRpcCallsFromSql(content, path.relative(ROOT, file));
          // Filter to only calls to our internal functions
          const relevantCalls = calls.filter(c => internalFunctions.includes(c.functionName));
          allCalls.push(...relevantCalls);
        }
      }
    }

    const errors = validateAlphabeticalOrder(allCalls);

    if (errors.length > 0) {
      const errorReport = errors
        .map(e => `  ${e.file}:${e.line} (${e.functionName})\n    Found: [${e.found.join(", ")}]\n    Expected: [${e.expected.join(", ")}]`)
        .join("\n\n");

      expect.fail(
        `Found ${errors.length} SQL function call(s) with incorrect parameter order:\n\n${errorReport}\n\n` +
        `All named parameters must be in alphabetical order.`
      );
    }
  });

  it("Mobile app must use RPC parameters in alphabetical order", () => {
    const mobileDir = path.join(ROOT, "mobile-app/src");

    if (!fs.existsSync(mobileDir)) {
      // Mobile app not present, skip
      return;
    }

    const files = findFiles(mobileDir, /\.tsx?$/, [/\.test\./, /node_modules/]);

    const allCalls: RpcCall[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      if (!content.includes(".rpc(")) continue;

      const calls = extractRpcCallsFromTs(content, path.relative(ROOT, file));
      allCalls.push(...calls);
    }

    const errors = validateAlphabeticalOrder(allCalls);

    if (errors.length > 0) {
      const errorReport = errors
        .map(e => `  ${e.file}:${e.line} (${e.functionName})\n    Found: [${e.found.join(", ")}]\n    Expected: [${e.expected.join(", ")}]`)
        .join("\n\n");

      expect.fail(
        `Found ${errors.length} RPC call(s) with incorrect parameter order in mobile app:\n\n${errorReport}\n\n` +
        `All RPC parameters must be in alphabetical order.`
      );
    }
  });

  it("reports RPC call statistics", () => {
    const stats = {
      hooks: 0,
      lib: 0,
      edgeFunctions: 0,
      mobile: 0,
      sql: 0,
    };

    // Count hooks
    const hooksDir = path.join(ROOT, "src/hooks");
    for (const file of findFiles(hooksDir, /\.tsx?$/, [/\.test\./])) {
      const content = fs.readFileSync(file, "utf-8");
      stats.hooks += (content.match(/\.rpc\s*\(/g) || []).length;
    }

    // Count lib
    const libDir = path.join(ROOT, "src/lib");
    for (const file of findFiles(libDir, /\.tsx?$/, [/\.test\./])) {
      const content = fs.readFileSync(file, "utf-8");
      stats.lib += (content.match(/\.rpc\s*\(/g) || []).length;
    }

    // Count Edge Functions
    const functionsDir = path.join(ROOT, "trash/legacy-archive/edge-functions-reference");
    for (const file of findFiles(functionsDir, /\.ts$/, [/\.test\./, /_shared/])) {
      const content = fs.readFileSync(file, "utf-8");
      stats.edgeFunctions += (content.match(/\.rpc\s*\(/g) || []).length;
    }

    // Count mobile
    const mobileDir = path.join(ROOT, "mobile-app/src");
    if (fs.existsSync(mobileDir)) {
      for (const file of findFiles(mobileDir, /\.tsx?$/, [/\.test\./, /node_modules/])) {
        const content = fs.readFileSync(file, "utf-8");
        stats.mobile += (content.match(/\.rpc\s*\(/g) || []).length;
      }
    }

    console.log("\n📊 RPC Call Statistics:");
    console.log(`   Hooks: ${stats.hooks}`);
    console.log(`   Lib: ${stats.lib}`);
    console.log(`   Edge Functions: ${stats.edgeFunctions}`);
    console.log(`   Mobile App: ${stats.mobile}`);
    console.log(`   Total: ${stats.hooks + stats.lib + stats.edgeFunctions + stats.mobile}`);
  });
});

// =============================================================================
// RPC Parameter Name Validation (Code ↔ SQL)
// =============================================================================

/**
 * Parse SQL function signature to extract parameter names
 */
function parseSqlFunctionParams(content: string): { name: string; params: { name: string; hasDefault: boolean }[] } | null {
  // Handle both multiline and single-line function definitions
  // Pattern: CREATE OR REPLACE FUNCTION name(params) RETURNS ...
  const funcMatch = content.match(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\)\s*(?:RETURNS|LANGUAGE)/is
  );

  if (!funcMatch) return null;

  const name = funcMatch[1];
  const paramsStr = funcMatch[2].trim();

  if (!paramsStr) return { name, params: [] };

  // For single-line params like: p_id uuid, p_name text DEFAULT NULL::text
  // Split by comma but respect parentheses (for type casts)
  const params: { name: string; hasDefault: boolean }[] = [];

  let depth = 0;
  let current = '';

  for (const char of paramsStr) {
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === ',' && depth === 0) {
      const parsed = parseParamString(current.trim());
      if (parsed) params.push(parsed);
      current = '';
      continue;
    }
    current += char;
  }

  // Don't forget the last param
  if (current.trim()) {
    const parsed = parseParamString(current.trim());
    if (parsed) params.push(parsed);
  }

  return { name, params };
}

function parseParamString(param: string): { name: string; hasDefault: boolean } | null {
  if (!param) return null;

  // Handle lines that start with comments (e.g., after trailing comma comment)
  // Remove leading comment lines and find actual parameter
  let cleaned = param;

  // Remove lines that are pure comments
  const lines = cleaned.split('\n');
  const nonCommentLines = lines.filter(line => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('--');
  });

  if (nonCommentLines.length === 0) return null;

  // Join remaining lines and strip inline comments
  cleaned = nonCommentLines.join(' ').replace(/--.*$/g, '').trim();

  if (!cleaned) return null;

  // Format: p_name type [DEFAULT value]
  // Match the parameter name (first word, typically p_something)
  const match = cleaned.match(/^(p_\w+|\w+)\s+/);
  if (!match) return null;

  return {
    name: match[1],
    hasDefault: /\bDEFAULT\b/i.test(cleaned),
  };
}

/**
 * Get all SQL function signatures
 */
function getAllSqlFunctionSignatures(): Map<string, { params: { name: string; hasDefault: boolean }[]; file: string }> {
  const result = new Map<string, { params: { name: string; hasDefault: boolean }[]; file: string }>();
  const sqlDir = path.join(ROOT, "aisha/db/sql/functions");

  if (!fs.existsSync(sqlDir)) return result;

  const files = fs.readdirSync(sqlDir).filter(f => f.endsWith(".sql"));

  for (const file of files) {
    const content = fs.readFileSync(path.join(sqlDir, file), "utf-8");
    const parsed = parseSqlFunctionParams(content);

    if (parsed) {
      result.set(parsed.name, { params: parsed.params, file });
    }
  }

  return result;
}

describe("RPC Parameter Names Match SQL Definitions", () => {

  it("all RPC calls use only parameters defined in SQL functions", () => {
    const sqlSignatures = getAllSqlFunctionSignatures();
    const errors: { file: string; line: number; func: string; issue: string }[] = [];

    // Scan hooks
    const hooksDir = path.join(ROOT, "src/hooks");
    for (const file of findFiles(hooksDir, /\.tsx?$/, [/\.test\./])) {
      const content = fs.readFileSync(file, "utf-8");
      const relPath = path.relative(ROOT, file);
      const calls = extractRpcCallsFromTs(content, relPath);

      for (const call of calls) {
        const sqlDef = sqlSignatures.get(call.functionName);
        if (!sqlDef) continue; // Skip if function not found (covered by other test)

        const sqlParamNames = sqlDef.params.map(p => p.name);

        // Check for unknown params in call
        for (const calledParam of call.params) {
          if (!sqlParamNames.includes(calledParam)) {
            errors.push({
              file: call.file,
              line: call.line,
              func: call.functionName,
              issue: `Unknown parameter "${calledParam}" - SQL function only has: [${sqlParamNames.join(", ")}]`,
            });
          }
        }

        // Check for missing required params
        const requiredParams = sqlDef.params.filter(p => !p.hasDefault).map(p => p.name);
        for (const required of requiredParams) {
          if (!call.params.includes(required)) {
            errors.push({
              file: call.file,
              line: call.line,
              func: call.functionName,
              issue: `Missing required parameter "${required}" (no DEFAULT in SQL)`,
            });
          }
        }
      }
    }

    // Scan Edge Functions
    const functionsDir = path.join(ROOT, "trash/legacy-archive/edge-functions-reference");
    for (const file of findFiles(functionsDir, /\.ts$/, [/\.test\./, /_shared/])) {
      const content = fs.readFileSync(file, "utf-8");
      const relPath = path.relative(ROOT, file);
      const calls = extractRpcCallsFromTs(content, relPath);

      for (const call of calls) {
        const sqlDef = sqlSignatures.get(call.functionName);
        if (!sqlDef) continue;

        const sqlParamNames = sqlDef.params.map(p => p.name);

        for (const calledParam of call.params) {
          if (!sqlParamNames.includes(calledParam)) {
            errors.push({
              file: call.file,
              line: call.line,
              func: call.functionName,
              issue: `Unknown parameter "${calledParam}" - SQL function only has: [${sqlParamNames.join(", ")}]`,
            });
          }
        }

        const requiredParams = sqlDef.params.filter(p => !p.hasDefault).map(p => p.name);
        for (const required of requiredParams) {
          if (!call.params.includes(required)) {
            errors.push({
              file: call.file,
              line: call.line,
              func: call.functionName,
              issue: `Missing required parameter "${required}" (no DEFAULT in SQL)`,
            });
          }
        }
      }
    }

    if (errors.length > 0) {
      const errorReport = errors
        .slice(0, 20) // Limit output
        .map(e => `  ${e.file}:${e.line} (${e.func})\n    ${e.issue}`)
        .join("\n\n");

      const suffix = errors.length > 20 ? `\n\n  ... and ${errors.length - 20} more` : "";

      expect.fail(
        `Found ${errors.length} RPC parameter mismatch(es):\n\n${errorReport}${suffix}`
      );
    }
  });
});

/**
 * Comprehensive test for write_audit_journal calls in SQL source of truth
 */
describe("write_audit_journal Calls Validation", () => {

  // Expected parameter order for write_audit_journal
  const AUDIT_PARAMS_ORDER = [
    "p_action_type",
    "p_area",
    "p_details",
    "p_entity_id",
    "p_entity_type",
    "p_new_values",
    "p_old_values",
    "p_severity",
    "p_summary",
    "p_tags",
    "p_user_id"
  ];

  /**
   * Extract all write_audit_journal calls from SQL content
   */
  function extractAuditCalls(content: string, filePath: string): { line: number; params: string[]; raw: string }[] {
    const calls: { line: number; params: string[]; raw: string }[] = [];

    // Pattern to find PERFORM write_audit_journal( ... );
    const pattern = /PERFORM\s+(?:public\.)?write_audit_journal\s*\(([\s\S]*?)\);/gi;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const callText = match[1];
      const startPos = match.index;
      const lineNum = content.slice(0, startPos).split('\n').length;

      // Extract p_* parameters
      const params: string[] = [];
      const paramPattern = /(p_\w+)\s*:=/g;
      let paramMatch;
      while ((paramMatch = paramPattern.exec(callText)) !== null) {
        params.push(paramMatch[1]);
      }

      calls.push({
        line: lineNum,
        params,
        raw: callText.slice(0, 300)
      });
    }

    return calls;
  }

  it("all write_audit_journal calls use named parameters (not positional)", () => {
    const sqlDir = path.join(ROOT, "aisha/db/sql/functions");
    if (!fs.existsSync(sqlDir)) return;

    const errors: { file: string; line: number; issue: string }[] = [];

    for (const filename of fs.readdirSync(sqlDir).filter(f => f.endsWith('.sql'))) {
      const filepath = path.join(sqlDir, filename);
      const content = fs.readFileSync(filepath, 'utf-8');

      if (!content.includes('write_audit_journal')) continue;

      const calls = extractAuditCalls(content, filename);

      for (const call of calls) {
        if (call.params.length === 0) {
          // Positional call - old style, must be converted
          errors.push({
            file: filename,
            line: call.line,
            issue: `Positional call detected - must use named parameters (p_xxx :=)`
          });
        }
      }
    }

    if (errors.length > 0) {
      const report = errors.map(e => `  ${e.file}:${e.line} - ${e.issue}`).join('\n');
      expect.fail(`Found ${errors.length} write_audit_journal call(s) without named parameters:\n\n${report}`);
    }
  });

  it("all write_audit_journal calls have parameters in alphabetical order", () => {
    const sqlDir = path.join(ROOT, "aisha/db/sql/functions");
    if (!fs.existsSync(sqlDir)) return;

    const errors: { file: string; line: number; found: string[]; expected: string[] }[] = [];

    for (const filename of fs.readdirSync(sqlDir).filter(f => f.endsWith('.sql'))) {
      const filepath = path.join(sqlDir, filename);
      const content = fs.readFileSync(filepath, 'utf-8');

      if (!content.includes('write_audit_journal')) continue;

      const calls = extractAuditCalls(content, filename);

      for (const call of calls) {
        if (call.params.length === 0) continue; // Handled by other test

        // Check order against known order
        const knownParams = call.params.filter(p => AUDIT_PARAMS_ORDER.includes(p));
        const expectedOrder = [...knownParams].sort((a, b) =>
          AUDIT_PARAMS_ORDER.indexOf(a) - AUDIT_PARAMS_ORDER.indexOf(b)
        );

        const isCorrectOrder = knownParams.every((p, i) => p === expectedOrder[i]);

        if (!isCorrectOrder) {
          errors.push({
            file: filename,
            line: call.line,
            found: knownParams,
            expected: expectedOrder
          });
        }
      }
    }

    if (errors.length > 0) {
      const report = errors
        .slice(0, 30)
        .map(e => `  ${e.file}:${e.line}\n    Found:    [${e.found.join(', ')}]\n    Expected: [${e.expected.join(', ')}]`)
        .join('\n\n');
      const suffix = errors.length > 30 ? `\n\n  ... and ${errors.length - 30} more` : '';
      expect.fail(`Found ${errors.length} write_audit_journal call(s) with wrong parameter order:\n\n${report}${suffix}`);
    }
  });

  it("reports write_audit_journal calls without explicit p_user_id (info only)", () => {
    const sqlDir = path.join(ROOT, "aisha/db/sql/functions");
    if (!fs.existsSync(sqlDir)) return;

    const warnings: { file: string; line: number; params: string[] }[] = [];

    // Functions that intentionally don't have user context
    const EXEMPT_FILES = [
      'bootstrap_default_admin.sql',  // System bootstrap
      'write_audit_journal.sql',       // Self
    ];

    for (const filename of fs.readdirSync(sqlDir).filter(f => f.endsWith('.sql'))) {
      if (EXEMPT_FILES.includes(filename)) continue;

      const filepath = path.join(sqlDir, filename);
      const content = fs.readFileSync(filepath, 'utf-8');

      if (!content.includes('write_audit_journal')) continue;

      const calls = extractAuditCalls(content, filename);

      for (const call of calls) {
        if (call.params.length === 0) continue; // Handled by other test

        if (!call.params.includes('p_user_id')) {
          warnings.push({
            file: filename,
            line: call.line,
            params: call.params
          });
        }
      }
    }

    // This is informational - auth.uid() is used as fallback in write_audit_journal
    // so missing p_user_id is not critical, but explicit is better
    console.log(`\n📋 write_audit_journal calls without explicit p_user_id: ${warnings.length}`);
    console.log(`   (auth.uid() is used as fallback, so this is not critical)`);

    if (warnings.length > 0 && warnings.length <= 10) {
      // Only show details if there are few
      for (const w of warnings) {
        console.log(`   - ${w.file}:${w.line}`);
      }
    }
  });

  it("reports write_audit_journal statistics", () => {
    const sqlDir = path.join(ROOT, "aisha/db/sql/functions");
    if (!fs.existsSync(sqlDir)) return;

    let totalCalls = 0;
    let filesWithCalls = 0;

    for (const filename of fs.readdirSync(sqlDir).filter(f => f.endsWith('.sql'))) {
      const filepath = path.join(sqlDir, filename);
      const content = fs.readFileSync(filepath, 'utf-8');

      if (!content.includes('write_audit_journal')) continue;

      const calls = extractAuditCalls(content, filename);
      if (calls.length > 0) {
        filesWithCalls++;
        totalCalls += calls.length;
      }
    }

    console.log(`\n📊 write_audit_journal Statistics:`);
    console.log(`   Files with audit calls: ${filesWithCalls}`);
    console.log(`   Total audit calls: ${totalCalls}`);
  });
});
